/**
 * prompt-identifiers-ai-sdk - Vercel AI SDK middleware for automatic ID encoding/decoding
 *
 * Automatically encodes IDs in prompts before LLM calls and decodes them in responses.
 */

import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4Middleware,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import {
  createEncodeState,
  createFormatter,
  decode,
  encode,
  EncodeConfig,
  EncodeState,
  findPlaceholders,
} from "prompt-identifiers";

// =============================================================================
// Types
// =============================================================================

/** Debug data included in onEncode callback when debug is true */
export interface EncodeDebugData {
  /** Number of unique IDs encoded */
  encodedCount: number;
  /** Original prompt messages before encoding */
  input: LanguageModelV4Prompt;
  /** Encoded prompt messages */
  output: LanguageModelV4Prompt;
  /** Time spent encoding in milliseconds */
  durationMs: number;
}

/** Debug data included in onDecode callback when debug is true */
export interface DecodeDebugData {
  /** Number of placeholders decoded */
  decodedCount: number;
  /** Encoded text from LLM */
  input: string;
  /** Decoded text with original IDs restored */
  output: string;
  /** Time spent decoding in milliseconds */
  durationMs: number;
}

/** Configuration options for the middleware */
export interface PromptIdentifiersMiddlewareOptions {
  /** Encoding configuration (inputFormat and outputFormat) */
  config: EncodeConfig;

  /**
   * Enable debug mode to populate debugData in callbacks with
   * input/output snapshots, counts, and timing information.
   */
  debug?: boolean;

  /**
   * Instruction appended to the system message, telling the model to preserve encoded identifiers
   * exactly as-is. `{format}` becomes an example token in the active output format, e.g. `~000~`
   * for SafeNumeric. Pass `false` to send none and leave the prompt's own messages alone.
   *
   * It goes in on every call, including calls whose prompt carries no ID: a system message that
   * changes mid-conversation costs a full prompt-cache rewrite of the system block.
   *
   * Without an instruction most models strip the delimiters out of tool call arguments, so the
   * choice is required rather than defaulted.
   */
  instruction: string | false;

  /**
   * Optional callback fired after encoding IDs in the prompt.
   * Receives the placeholder→ID mapping. When debug is true,
   * also receives debugData with input, output, counts, and timing.
   */
  onEncode?: (result: { mapping: Record<string, string>; debugData?: EncodeDebugData }) => void;

  /**
   * Optional callback fired after decoding IDs in the response.
   * Always receives the decoded output text, the placeholder->ID mapping,
   * and any warnings about decode anomalies (e.g., stripped delimiters).
   * When debug is true, also receives debugData with input, output, counts, and timing.
   */
  onDecode?: (result: {
    output: string;
    mapping: Record<string, string>;
    warnings?: DecodeWarning[];
    debugData?: DecodeDebugData;
  }) => void;
}

/** Warning about a decode anomaly */
export interface DecodeWarning {
  type: "surviving_placeholder" | "stripped_delimiter" | "unknown_placeholder";
  /** The problematic value found in the output */
  value: string;
  /** Where it was found */
  source: "text" | "tool_call";
  /** The tool whose call arguments contained the value, when source is "tool_call" */
  toolName?: string;
}

/** A tool call's arguments after decoding, kept for the warning scan */
interface DecodedToolCall {
  toolName: string;
  input: string;
}

// =============================================================================
// Decode Warnings
// =============================================================================

/** Stand-in for a restored ID while scanning decoded output for anomalies. */
const ID_MASK = "\u0001";

/**
 * Detect decode anomalies in the decoded output.
 *
 * 1. Surviving placeholders: encoded placeholders (e.g., ~000~) that remain
 *    in the decoded text, meaning decode missed them.
 * 2. Stripped delimiters: bare placeholder indices (e.g., 000) that appear
 *    as standalone values, suggesting the LLM stripped the delimiter characters.
 * 3. Unknown placeholders: placeholder-shaped tokens that are not in the mapping,
 *    such as one the model invented. Only delimited formats can report these.
 */
function detectDecodeWarnings(
  decodedText: string,
  decodedToolCalls: DecodedToolCall[],
  mapping: Record<string, string>,
  config: EncodeConfig
): DecodeWarning[] {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) return [];

  const ids = Object.values(mapping);
  const warnings: DecodeWarning[] = [];

  // Extract bare indices from placeholders (e.g., "~000~" -> "000")
  const bareIndices = new Set<string>();
  for (const placeholder of placeholders) {
    const match = placeholder.match(/^[^\d]*(\d+)[^\d]*$/);
    if (match) bareIndices.add(match[1]);
  }

  function check(text: string, source: Pick<DecodeWarning, "source" | "toolName">) {
    // Mask out the restored IDs first. Non-delimited placeholders are bare digits
    // ("000", "0") and a restored UUID contains those by construction, so an
    // unmasked scan reports a surviving placeholder on every successful decode.
    // It also keeps findPlaceholders off a restored ID that carries the format's
    // own delimiters, such as a "-{i}-" template against a UUID's hyphens.
    const masked = ids.reduce((acc, id) => acc.split(id).join(ID_MASK), text);

    // Masking leaves nothing for this to find while decode replaces every key it is given, so it
    // reports a regression in one of the two rather than anything a model can write
    for (const placeholder of placeholders) {
      if (masked.includes(placeholder)) {
        warnings.push({ type: "surviving_placeholder", value: placeholder, ...source });
      }
    }

    for (const token of findPlaceholders(masked, config.outputFormat)) {
      if (mapping[token] === undefined) {
        warnings.push({ type: "unknown_placeholder", value: token, ...source });
      }
    }

    // Check for stripped delimiters: bare indices appearing as standalone JSON string values
    // Match "000" or similar as a JSON value (surrounded by quotes)
    for (const bare of bareIndices) {
      const pattern = new RegExp(`"${bare}"`, "g");
      if (pattern.test(masked)) {
        warnings.push({ type: "stripped_delimiter", value: bare, ...source });
      }
    }
  }

  if (decodedText) check(decodedText, { source: "text" });
  for (const { toolName, input } of decodedToolCalls) {
    check(input, { source: "tool_call", toolName });
  }

  return warnings;
}

// =============================================================================
// Instruction Injection
// =============================================================================

/**
 * Append instruction text to the last system message in the prompt.
 * If no system message exists, prepends one.
 */
function injectInstructionIntoPrompt(
  prompt: LanguageModelV4Prompt,
  instruction: string
): LanguageModelV4Prompt {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (msg.role !== "system") continue;
    const updated = [...prompt];
    // Spread the message so providerOptions, such as a cache breakpoint, survive
    updated[i] = { ...msg, content: msg.content + "\n\n" + instruction };
    return updated;
  }

  return [{ role: "system", content: instruction }, ...prompt];
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** The inline-text variant of a file part's tagged data union. */
interface InlineTextFileData {
  type: "text";
  text: string;
}

function isInlineTextFileData(data: unknown): data is InlineTextFileData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "text" &&
    typeof (data as { text?: unknown }).text === "string"
  );
}

/**
 * Encode IDs in tool result output.
 * Handles the text, json, error-text, error-json, content and execution-denied output types.
 */
function encodeToolResultOutput(
  output: unknown,
  config: EncodeConfig,
  state: EncodeState
): unknown {
  if (typeof output !== "object" || output === null) {
    return output;
  }

  const typedOutput = output as { type?: string; value?: unknown; reason?: unknown };

  // For text output, encode the string value directly
  if (
    (typedOutput.type === "text" || typedOutput.type === "error-text") &&
    typeof typedOutput.value === "string"
  ) {
    const result = encode(typedOutput.value, config, state);
    return { ...typedOutput, value: result.encoded };
  }

  // For json output, stringify → encode → parse
  if (
    (typedOutput.type === "json" || typedOutput.type === "error-json") &&
    typedOutput.value !== undefined
  ) {
    const stringified = JSON.stringify(typedOutput.value);
    const result = encode(stringified, config, state);
    return { ...typedOutput, value: JSON.parse(result.encoded) };
  }

  // For content output, the value is an array of the same text and file parts
  // that appear in message content
  if (typedOutput.type === "content" && Array.isArray(typedOutput.value)) {
    return { ...typedOutput, value: encodeMessageContent(typedOutput.value, config, state) };
  }

  // For execution-denied output, the only payload is a free-text reason
  if (typedOutput.type === "execution-denied" && typeof typedOutput.reason === "string") {
    const result = encode(typedOutput.reason, config, state);
    return { ...typedOutput, reason: result.encoded };
  }

  return output;
}

/**
 * Encode IDs in tool call input (args).
 * Input is an arbitrary object in prompt messages — stringify → encode → parse.
 */
function encodeToolCallInput(input: unknown, config: EncodeConfig, state: EncodeState): unknown {
  if (input == null) return input;

  const stringified = JSON.stringify(input);
  const result = encode(stringified, config, state);
  return JSON.parse(result.encoded);
}

/**
 * Encode IDs in message content.
 * Handles plain string content, multi-part content arrays (TextPart, ToolResultPart, etc.).
 */
function encodeMessageContent(content: unknown, config: EncodeConfig, state: EncodeState): unknown {
  if (typeof content === "string") {
    const result = encode(content, config, state);
    return result.encoded;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part !== "object" || part === null) {
        return part;
      }

      const typedPart = part as Record<string, unknown>;

      // Handle TextPart: { type: 'text', text: string }
      if ("text" in typedPart && typeof typedPart.text === "string") {
        return {
          ...typedPart,
          text: encodeMessageContent(typedPart.text, config, state),
        };
      }

      // Handle FilePart data: a tagged union where only the inline-text variant
      // carries encodable content; binary, URL and reference data pass through
      if (isInlineTextFileData(typedPart.data)) {
        return {
          ...typedPart,
          data: {
            ...typedPart.data,
            text: encode(typedPart.data.text, config, state).encoded,
          },
        };
      }

      // Handle ToolCallPart: { type: 'tool-call', input: unknown }
      if (typedPart.type === "tool-call" && "input" in typedPart) {
        return {
          ...typedPart,
          input: encodeToolCallInput(typedPart.input, config, state),
        };
      }

      // Handle ToolResultPart: { type: 'tool-result', output: { type, value } }
      if (typedPart.type === "tool-result" && "output" in typedPart) {
        return {
          ...typedPart,
          output: encodeToolResultOutput(typedPart.output, config, state),
        };
      }

      return part;
    });
  }

  return content;
}

/**
 * Encode IDs in all messages of the params.
 *
 * Uses a single shared EncodeState across all messages so that the same UUID always gets
 * the same placeholder, regardless of which message it first appears in.
 */
function encodePromptMessages(
  prompt: LanguageModelV4Prompt,
  config: EncodeConfig
): { encodedPrompt: LanguageModelV4Prompt; mapping: Record<string, string> } {
  const state = createEncodeState();

  const encodedPrompt = prompt.map((message) => ({
    ...message,
    content: encodeMessageContent(message.content, config, state),
  })) as LanguageModelV4Prompt;

  return { encodedPrompt, mapping: state.mapping };
}

/**
 * Count the placeholders a decode replaced. One pass per placeholder, so it costs more than the
 * decode itself on a large mapping and only debugData reports it.
 */
function countPlaceholders(text: string, mapping: Record<string, string>): number {
  return Object.keys(mapping).reduce((acc, placeholder) => {
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    return acc + (text.match(regex)?.length ?? 0);
  }, 0);
}

/**
 * Decode IDs in tool call input string.
 * The input is always a stringified JSON in tool calls.
 */
function decodeToolInputString(input: string, mapping: Record<string, string>): string {
  return decode(input, mapping);
}

// =============================================================================
// Streaming Buffer
// =============================================================================

/**
 * Creates a streaming buffer that holds back a chunk tail that could still grow into a
 * placeholder, so one split across chunks ("~00" | "0~") is decoded as a whole.
 *
 * Only a placeholder in the mapping can be decoded, so the tails worth holding are exactly the
 * proper prefixes of those, whatever an output format writes. A tail may begin where a match
 * begins, since that match can still grow into a longer placeholder, but never partway through
 * one, because the text on either side of it was already decoded around it.
 */
function createStreamingDecoder(mapping: Record<string, string>) {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) {
    return {
      process: (text: string) => text,
      flush: () => "",
    };
  }

  const growable = new Set<string>();
  for (const placeholder of placeholders) {
    for (let length = 1; length < placeholder.length; length++) {
      growable.add(placeholder.slice(0, length));
    }
  }
  const longestTail = Math.max(...placeholders.map((p) => p.length)) - 1;

  // Matches what decode matches, longest placeholder first, so both agree on where one ends
  const pattern = new RegExp(
    [...placeholders]
      .sort((a, b) => b.length - a.length)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g"
  );

  let buffer = "";

  return {
    process: (text: string): string => {
      const pending = buffer + text;

      // Only a match reaching into the last longestTail characters can contain a candidate tail
      pattern.lastIndex = 0;
      const tailStart = Math.max(0, pending.length - longestTail);
      const reachingTail: [start: number, end: number][] = [];
      for (let match = pattern.exec(pending); match; match = pattern.exec(pending)) {
        if (pattern.lastIndex > tailStart) reachingTail.push([match.index, pattern.lastIndex]);
      }

      let hold = 0;
      for (let length = Math.min(longestTail, pending.length); length > 0; length--) {
        const cut = pending.length - length;
        if (!growable.has(pending.slice(cut))) continue;
        // Holding a whole match back is fine, it may still grow. Cutting one in half is not,
        // since the text before the cut was already decoded around it.
        if (reachingTail.some(([start, end]) => start < cut && cut < end)) continue;
        hold = length;
        break;
      }

      buffer = pending.slice(pending.length - hold);
      return decode(pending.slice(0, pending.length - hold), mapping);
    },

    flush: (): string => {
      const result = decode(buffer, mapping);
      buffer = "";
      return result;
    },
  };
}

// =============================================================================
// Middleware Factory
// =============================================================================

// Symbol to attach mapping to params object - survives SDK transformations
const MAPPING_SYMBOL = Symbol("promptIdentifiersMapping");

interface ParamsWithMapping {
  [MAPPING_SYMBOL]?: Record<string, string>;
}

/**
 * Creates a Vercel AI SDK middleware that automatically encodes IDs in prompts
 * and decodes them in responses.
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapLanguageModel, generateText } from 'ai';
 * import { promptIdentifiersMiddleware } from 'prompt-identifiers-ai-sdk';
 *
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4o'),
 *   middleware: promptIdentifiersMiddleware({
 *     config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
 *     instruction: 'IDs have been replaced with short identifiers like {format}. Pass them verbatim.',
 *     onEncode: (result) => console.log(`Encoded ${Object.keys(result.mapping).length} IDs`),
 *   })
 * });
 *
 * // Use normally - IDs are auto-encoded/decoded
 * const result = await generateText({
 *   model,
 *   prompt: 'Summarize activity for user 123e4567-e89b-42d3-a456-426655440000'
 * });
 * ```
 */
export function promptIdentifiersMiddleware(
  options: PromptIdentifiersMiddlewareOptions
): LanguageModelV4Middleware {
  const { config, instruction, onEncode, onDecode, debug } = options;
  if (instruction === undefined) {
    throw new Error(
      "promptIdentifiersMiddleware: instruction is required. Pass the text to append to the " +
        "system message, or false to send none."
    );
  }
  // Passthrough encodes nothing, so there is no format to name and nothing to instruct about
  const builtInstruction =
    instruction === false || config.outputFormat === "Passthrough"
      ? undefined
      : instruction.replace(/\{format\}/g, createFormatter(config.outputFormat)(0));

  return {
    specificationVersion: "v4",

    transformParams: async ({ params }) => {
      const startTime = debug ? performance.now() : 0;
      let { encodedPrompt, mapping } = encodePromptMessages(params.prompt, config);
      const durationMs = debug ? performance.now() - startTime : 0;

      // On every call, so the system message stays identical across a conversation and the
      // provider's prompt cache keeps matching it
      if (builtInstruction) {
        encodedPrompt = injectInstructionIntoPrompt(encodedPrompt, builtInstruction);
      }

      onEncode?.({
        mapping,
        ...(debug && {
          debugData: {
            encodedCount: Object.keys(mapping).length,
            input: params.prompt,
            output: encodedPrompt,
            durationMs,
          },
        }),
      });

      // Attach mapping to params using Symbol - survives spread/clone operations
      const transformedParams = {
        ...params,
        prompt: encodedPrompt,
        [MAPPING_SYMBOL]: mapping,
      };

      return transformedParams;
    },

    wrapGenerate: async ({ doGenerate, params }): Promise<LanguageModelV4GenerateResult> => {
      const result = await doGenerate();
      const mapping = (params as ParamsWithMapping)[MAPPING_SYMBOL] ?? {};

      if (Object.keys(mapping).length === 0) {
        return result;
      }

      const startTime = debug ? performance.now() : 0;
      let encodedText = "";
      let decodedText = "";

      // Decode text and tool call inputs in content array
      let totalCount = 0;
      const decodedToolCalls: DecodedToolCall[] = [];
      const decodedContent = result.content.map((item) => {
        if (item.type === "text") {
          const decoded = decode(item.text, mapping);
          decodedText += decoded;
          if (debug) {
            totalCount += countPlaceholders(item.text, mapping);
            encodedText += item.text;
          }
          return { ...item, text: decoded };
        }
        if (item.type === "reasoning") {
          return { ...item, text: decode(item.text, mapping) };
        }
        // Decode tool call inputs (input is stringified JSON)
        if (item.type === "tool-call" && "input" in item && typeof item.input === "string") {
          const decodedInput = decodeToolInputString(item.input, mapping);
          decodedToolCalls.push({ toolName: item.toolName, input: decodedInput });
          return { ...item, input: decodedInput };
        }
        return item;
      });

      const durationMs = debug ? performance.now() - startTime : 0;
      const warnings = detectDecodeWarnings(decodedText, decodedToolCalls, mapping, config);

      onDecode?.({
        output: decodedText,
        mapping,
        ...(warnings.length > 0 && { warnings }),
        ...(debug && {
          debugData: {
            decodedCount: totalCount,
            input: encodedText,
            output: decodedText,
            durationMs,
          },
        }),
      });
      return { ...result, content: decodedContent };
    },

    wrapStream: async ({ doStream, params }): Promise<LanguageModelV4StreamResult> => {
      const { stream, ...rest } = await doStream();
      const mapping = (params as ParamsWithMapping)[MAPPING_SYMBOL] ?? {};

      if (Object.keys(mapping).length === 0) {
        return { stream, ...rest };
      }

      const textDecoder = createStreamingDecoder(mapping);
      // Reasoning arrives as its own delta stream, so it needs a buffer of its own
      const reasoningDecoder = createStreamingDecoder(mapping);
      // Each streaming tool input is a separate JSON document with its own buffer
      const toolInputDecoders = new Map<string, ReturnType<typeof createStreamingDecoder>>();

      let accDecodedText = "";
      const accDecodedToolCalls: DecodedToolCall[] = [];
      let lastTextId = "";
      let lastReasoningId = "";

      // Debug-only accumulation state
      let streamStartTime = 0;
      let accEncodedText = "";
      let streamStarted = false;

      let reported = false;
      function report() {
        if (reported) return;
        reported = true;

        // A stream that ended without a closing chunk leaves the buffer unflushed;
        // it is too late to emit it, but the callback should still see it.
        accDecodedText += textDecoder.flush();

        const durationMs = debug && streamStarted ? performance.now() - streamStartTime : 0;
        const warnings = detectDecodeWarnings(accDecodedText, accDecodedToolCalls, mapping, config);

        onDecode?.({
          output: accDecodedText,
          mapping,
          ...(warnings.length > 0 && { warnings }),
          ...(debug && {
            debugData: {
              decodedCount: countPlaceholders(accEncodedText, mapping),
              input: accEncodedText,
              output: accDecodedText,
              durationMs,
            },
          }),
        });
      }

      // Transform the stream to decode placeholders in text and tool calls
      const transformedStream = new TransformStream<
        LanguageModelV4StreamPart,
        LanguageModelV4StreamPart
      >({
        transform(chunk, controller) {
          // A closing chunk is the last chance to emit what a decoder still holds:
          // anything enqueued from flush() arrives after the stream has finished,
          // with no open block to attach to, and is dropped from the assembled message.
          if (chunk.type === "text-end" || chunk.type === "finish") {
            const remaining = textDecoder.flush();
            if (remaining) {
              accDecodedText += remaining;
              controller.enqueue({
                type: "text-delta",
                id: lastTextId,
                delta: remaining,
              } as LanguageModelV4StreamPart);
            }
          }

          if (chunk.type === "reasoning-end" || chunk.type === "finish") {
            const remaining = reasoningDecoder.flush();
            if (remaining) {
              controller.enqueue({
                type: "reasoning-delta",
                id: lastReasoningId,
                delta: remaining,
              } as LanguageModelV4StreamPart);
            }
          }

          if (chunk.type === "finish") {
            for (const [id, decoder] of toolInputDecoders) {
              const remaining = decoder.flush();
              if (remaining) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id,
                  delta: remaining,
                } as LanguageModelV4StreamPart);
              }
            }
            toolInputDecoders.clear();
          }

          // Decode text deltas
          if (chunk.type === "text-delta" && chunk.delta) {
            lastTextId = chunk.id;
            if (debug) {
              if (!streamStarted) {
                streamStartTime = performance.now();
                streamStarted = true;
              }
              accEncodedText += chunk.delta;
            }
            const decoded = textDecoder.process(chunk.delta);
            if (decoded) {
              accDecodedText += decoded;
              controller.enqueue({ ...chunk, delta: decoded });
            }
            return;
          }

          // Decode reasoning deltas
          if (chunk.type === "reasoning-delta" && chunk.delta) {
            lastReasoningId = chunk.id;
            const decoded = reasoningDecoder.process(chunk.delta);
            if (decoded) {
              controller.enqueue({ ...chunk, delta: decoded });
            }
            return;
          }

          // Decode complete tool calls (input is stringified JSON)
          if (chunk.type === "tool-call" && "input" in chunk && typeof chunk.input === "string") {
            const decodedInput = decodeToolInputString(chunk.input, mapping);
            accDecodedToolCalls.push({ toolName: chunk.toolName, input: decodedInput });
            controller.enqueue({
              ...chunk,
              input: decodedInput,
            });
            return;
          }

          if (chunk.type === "tool-input-start") {
            toolInputDecoders.set(chunk.id, createStreamingDecoder(mapping));
            controller.enqueue(chunk);
            return;
          }

          // Decode tool input deltas (partial JSON strings)
          if (chunk.type === "tool-input-delta" && "delta" in chunk) {
            const decoder = toolInputDecoders.get(chunk.id);
            const rawDelta = (chunk as { delta: string }).delta;
            const decodedDelta = decoder ? decoder.process(rawDelta) : decode(rawDelta, mapping);
            if (decodedDelta) {
              controller.enqueue({ ...chunk, delta: decodedDelta });
            }
            return;
          }

          if (chunk.type === "tool-input-end") {
            const decoder = toolInputDecoders.get(chunk.id);
            if (decoder) {
              const remaining = decoder.flush();
              if (remaining) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: chunk.id,
                  delta: remaining,
                } as LanguageModelV4StreamPart);
              }
              toolInputDecoders.delete(chunk.id);
            }
            controller.enqueue(chunk);
            return;
          }

          controller.enqueue(chunk);
        },

        flush: report,

        // A stream that errors runs neither flush nor the closing chunk, and the consumer
        // is already holding the text decoded so far
        cancel: report,
      });

      return {
        stream: stream.pipeThrough(transformedStream),
        ...rest,
      };
    },
  };
}
