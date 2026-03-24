/**
 * prompt-identifiers-ai-sdk - Vercel AI SDK middleware for automatic ID encoding/decoding
 *
 * Automatically encodes IDs in prompts before LLM calls and decodes them in responses.
 */

import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Middleware,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import {
  createEncodeState,
  createFormatter,
  decode,
  encode,
  EncodeConfig,
  EncodeState,
} from "prompt-identifiers";

// =============================================================================
// Types
// =============================================================================

/** Debug data included in onEncode callback when debug is true */
export interface EncodeDebugData {
  /** Number of unique IDs encoded */
  encodedCount: number;
  /** Original prompt messages before encoding */
  input: LanguageModelV3Prompt;
  /** Encoded prompt messages */
  output: LanguageModelV3Prompt;
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
   * Inject a short instruction into the system message telling the model
   * to preserve encoded identifiers exactly as-is.
   *
   * - `true` (default): appends the default instruction
   * - `false`: no injection
   *
   * Only injected when at least one ID was encoded.
   */
  injectInstruction?: boolean;

  /**
   * Custom instruction text to inject instead of the default.
   * Use `{format}` as a placeholder for an example token in the
   * active output format (e.g. `~000~` for SafeNumeric).
   *
   * Only used when `injectInstruction` is true.
   */
  customInstruction?: string;

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
  type: "surviving_placeholder" | "stripped_delimiter";
  /** The problematic value found in the output */
  value: string;
  /** Where it was found */
  source: "text" | "tool_call";
}

// =============================================================================
// Decode Warnings
// =============================================================================

/**
 * Detect decode anomalies in the decoded output.
 *
 * 1. Surviving placeholders: encoded placeholders (e.g., ~000~) that remain
 *    in the decoded text, meaning decode missed them.
 * 2. Stripped delimiters: bare placeholder indices (e.g., 000) that appear
 *    as standalone values, suggesting the LLM stripped the delimiter characters.
 */
function detectDecodeWarnings(
  decodedText: string,
  decodedToolCallInputs: string[],
  mapping: Record<string, string>
): DecodeWarning[] {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) return [];

  const warnings: DecodeWarning[] = [];

  // Extract bare indices from placeholders (e.g., "~000~" -> "000")
  const bareIndices = new Set<string>();
  for (const placeholder of placeholders) {
    const match = placeholder.match(/^[^\d]*(\d+)[^\d]*$/);
    if (match) bareIndices.add(match[1]);
  }

  function check(text: string, source: "text" | "tool_call") {
    // Check for surviving placeholders
    for (const placeholder of placeholders) {
      if (text.includes(placeholder)) {
        warnings.push({ type: "surviving_placeholder", value: placeholder, source });
      }
    }

    // Check for stripped delimiters: bare indices appearing as standalone JSON string values
    // Match "000" or similar as a JSON value (surrounded by quotes)
    for (const bare of bareIndices) {
      const pattern = new RegExp(`"${bare}"`, "g");
      if (pattern.test(text)) {
        warnings.push({ type: "stripped_delimiter", value: bare, source });
      }
    }
  }

  if (decodedText) check(decodedText, "text");
  for (const input of decodedToolCallInputs) {
    check(input, "tool_call");
  }

  return warnings;
}

// =============================================================================
// Instruction Injection
// =============================================================================

const DEFAULT_INSTRUCTION =
  "UUIDs have been replaced with short identifiers like {format}. Always pass these identifiers verbatim";

/**
 * Generate an example placeholder token for the active output format.
 * e.g. SafeNumeric -> "~000~", Numeric -> "000", IdToken -> "0"
 */
function getExampleToken(config: EncodeConfig): string {
  if (config.outputFormat === "Passthrough") return "";
  return createFormatter(config.outputFormat)(0);
}

/**
 * Build the instruction string, replacing {format} with the example token.
 */
function buildInstruction(config: EncodeConfig, customInstruction?: string): string {
  const token = getExampleToken(config);
  const template = customInstruction ?? DEFAULT_INSTRUCTION;
  return template.replace("{format}", token);
}

/**
 * Append instruction text to the last system message in the prompt.
 * If no system message exists, prepends one.
 */
function injectInstructionIntoPrompt(
  prompt: LanguageModelV3Prompt,
  instruction: string
): LanguageModelV3Prompt {
  // Find last system message
  let lastSystemIndex = -1;
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === "system") {
      lastSystemIndex = i;
      break;
    }
  }

  if (lastSystemIndex >= 0) {
    const msg = prompt[lastSystemIndex];
    // System messages have string content
    const content = typeof msg.content === "string" ? msg.content : "";
    const updatedMsg: LanguageModelV3Message = {
      role: "system",
      content: content + "\n\n" + instruction,
      ...(msg.providerOptions && { providerOptions: msg.providerOptions }),
    };
    const updated = [...prompt];
    updated[lastSystemIndex] = updatedMsg;
    return updated;
  }

  // No system message - prepend one
  const systemMsg: LanguageModelV3Message = { role: "system", content: instruction };
  return [systemMsg, ...prompt];
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Encode IDs in tool result output.
 * Handles both text and json output types.
 */
function encodeToolResultOutput(
  output: unknown,
  config: EncodeConfig,
  state: EncodeState
): unknown {
  if (typeof output !== "object" || output === null) {
    return output;
  }

  const typedOutput = output as { type?: string; value?: unknown };

  // For text output, encode the string value directly
  if (typedOutput.type === "text" && typeof typedOutput.value === "string") {
    const result = encode(typedOutput.value, config, state);
    return { ...typedOutput, value: result.encoded };
  }

  // For json output, stringify → encode → parse
  if (typedOutput.type === "json" && typedOutput.value !== undefined) {
    const stringified = JSON.stringify(typedOutput.value);
    const result = encode(stringified, config, state);
    return { ...typedOutput, value: JSON.parse(result.encoded) };
  }

  return output;
}

/**
 * Encode IDs in tool call input (args).
 * Input is an arbitrary object in prompt messages — stringify → encode → parse.
 */
function encodeToolCallInput(
  input: unknown,
  config: EncodeConfig,
  state: EncodeState
): unknown {
  if (input == null) return input;

  const stringified = JSON.stringify(input);
  const result = encode(stringified, config, state);
  return JSON.parse(result.encoded);
}

/**
 * Encode IDs in message content.
 * Handles plain string content, multi-part content arrays (TextPart, ToolResultPart, etc.).
 */
function encodeMessageContent(
  content: unknown,
  config: EncodeConfig,
  state: EncodeState
): unknown {
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
  prompt: LanguageModelV3Prompt,
  config: EncodeConfig
): { encodedPrompt: LanguageModelV3Prompt; mapping: Record<string, string> } {
  const state = createEncodeState();

  const encodedPrompt = prompt.map((message) => ({
    ...message,
    content: encodeMessageContent(message.content, config, state),
  })) as LanguageModelV3Prompt;

  return { encodedPrompt, mapping: state.mapping };
}

/**
 * Decode IDs in text content using the mapping.
 */
function decodeText(
  text: string,
  mapping: Record<string, string>
): { decoded: string; count: number } {
  const decoded = decode(text, mapping);
  // Count how many placeholders were replaced
  const count = Object.keys(mapping).reduce((acc, placeholder) => {
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    return acc + (text.match(regex)?.length ?? 0);
  }, 0);
  return { decoded, count };
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
 * Creates a streaming buffer that handles placeholders split across chunks.
 *
 * For delimited formats like SafeNumeric (<000>, <001>, etc.), placeholders
 * may arrive split across chunks: "<00" | "0>" or "<" | "000" | ">"
 *
 * Strategy: Buffer content when we see an opening delimiter,
 * flush when we see the closing delimiter.
 *
 * For non-delimited formats (Numeric, IdToken), buffering isn't possible
 * so we decode immediately.
 */
function createStreamingDecoder(mapping: Record<string, string>) {
  // Detect delimiter pattern from mapping keys
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) {
    return {
      process: (text: string) => text,
      flush: () => "",
    };
  }

  // Detect delimiter pattern from the first placeholder
  // e.g., "<000>" -> open="<", close=">"
  // e.g., "[[000]]" -> open="[[", close="]]"
  // e.g., "000" -> no delimiters (can't buffer)
  const firstPlaceholder = placeholders[0];
  const match = firstPlaceholder.match(/^([^\d]*)\d+([^\d]*)$/);

  if (!match || (!match[1] && !match[2])) {
    // No delimiters found (e.g., pure "000", "A", "z")
    // Can't reliably buffer, just decode immediately
    return {
      process: (text: string) => decode(text, mapping),
      flush: () => "",
    };
  }

  const OPEN = match[1];
  const CLOSE = match[2];

  if (!OPEN) {
    // No opening delimiter means we can't detect incomplete placeholders
    return {
      process: (text: string) => decode(text, mapping),
      flush: () => "",
    };
  }

  const isSymmetric = OPEN === CLOSE;
  const MAX_PLACEHOLDER_LEN = 15; // safety: flush if buffer tail exceeds this

  /**
   * Check if the buffer ends with a partial prefix of a multi-char delimiter.
   * e.g., buffer "text[" could be the start of "[[" opener.
   * Returns the length of the partial prefix (0 if none).
   */
  function partialDelimiterSuffix(buf: string, delim: string): number {
    if (delim.length <= 1) return 0;
    // Check if buffer ends with a prefix of the delimiter (length 1..delim.length-1)
    for (let len = Math.min(delim.length - 1, buf.length); len >= 1; len--) {
      if (buf.endsWith(delim.substring(0, len))) {
        return len;
      }
    }
    return 0;
  }

  // Buffer incomplete placeholders
  let buffer = "";

  return {
    process: (text: string): string => {
      buffer += text;

      if (!isSymmetric) {
        // Asymmetric path — use regex to find complete placeholders.
        // The old lastIndexOf approach breaks when delimiters share characters
        // (e.g., ~ID000~ where CLOSE ~ is a prefix of OPEN ~ID).
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const completeRe = new RegExp(esc(OPEN) + "\\d+" + esc(CLOSE), "g");

        // Find where the last complete placeholder ends
        let lastCompleteEnd = 0;
        let m;
        while ((m = completeRe.exec(buffer)) !== null) {
          lastCompleteEnd = m.index + m[0].length;
        }

        const tail = buffer.substring(lastCompleteEnd);

        // Check for incomplete placeholder: OPEN + digit(s), no complete CLOSE yet
        const incompleteRe = new RegExp(esc(OPEN) + "\\d");
        const incMatch = incompleteRe.exec(tail);
        if (incMatch) {
          const afterOpen = tail.substring(incMatch.index + OPEN.length);
          if (afterOpen.indexOf(CLOSE) === -1) {
            const dm = afterOpen.match(/^(\d+)([\s\S]*)$/);
            if (dm && (dm[2] === "" || CLOSE.startsWith(dm[2]))) {
              // OPEN + digits + optional partial CLOSE — buffer it
              const splitPoint = lastCompleteEnd + incMatch.index;
              const complete = buffer.substring(0, splitPoint);
              buffer = buffer.substring(splitPoint);
              return decode(complete, mapping);
            }
          }
        }

        // Check for bare OPEN at end of buffer (no digits yet)
        if (tail.endsWith(OPEN)) {
          const complete = buffer.substring(0, buffer.length - OPEN.length);
          buffer = buffer.substring(buffer.length - OPEN.length);
          return decode(complete, mapping);
        }

        // Check for partial multi-char opener at end (e.g., "[" when OPEN="[[")
        const partialLen = partialDelimiterSuffix(tail, OPEN);
        if (partialLen > 0) {
          const complete = buffer.substring(0, buffer.length - partialLen);
          buffer = buffer.substring(buffer.length - partialLen);
          return decode(complete, mapping);
        }

        // All placeholders are complete, decode everything
        const result = decode(buffer, mapping);
        buffer = "";
        return result;
      }

      // Symmetric path (e.g., ~000~) — look-back approach
      const lastDelim = buffer.lastIndexOf(OPEN);
      if (lastDelim >= 0) {
        const afterDelim = buffer.substring(lastDelim + OPEN.length);

        // Case 1: digits after last delimiter (e.g., "~00") → partial placeholder
        if (/^\d+$/.test(afterDelim) && afterDelim.length <= MAX_PLACEHOLDER_LEN) {
          const complete = buffer.substring(0, lastDelim);
          buffer = buffer.substring(lastDelim);
          return decode(complete, mapping);
        }

        // Case 2: delimiter at very end of buffer (e.g., "text~")
        if (afterDelim === "") {
          // Look back: is there OPEN + digits immediately before this delimiter?
          // If yes → this delimiter is a CLOSER, decode everything
          const precedingDelim = buffer.lastIndexOf(OPEN, lastDelim - 1);
          if (precedingDelim >= 0) {
            const between = buffer.substring(precedingDelim + OPEN.length, lastDelim);
            if (/^\d+$/.test(between)) {
              // Confirmed closer (e.g., "~000~") — decode all
              const result = decode(buffer, mapping);
              buffer = "";
              return result;
            }
          }
          // No valid opener found before → this might be an opener, buffer it
          const complete = buffer.substring(0, lastDelim);
          buffer = buffer.substring(lastDelim);
          return decode(complete, mapping);
        }
      }

      // No partial placeholder detected, decode everything
      const result = decode(buffer, mapping);
      buffer = "";
      return result;
    },

    flush: (): string => {
      // Stream ended, decode whatever remains (might be incomplete placeholder)
      const result = decode(buffer, mapping);
      buffer = "";
      return result;
    },
  };
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Creates a Vercel AI SDK middleware that automatically encodes IDs in prompts
 * and decodes them in responses.
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapLanguageModel } from 'ai';
 * import { promptIdentifiersMiddleware } from 'prompt-identifiers-ai-sdk';
 *
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4o'),
 *   middleware: promptIdentifiersMiddleware({
 *     config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
 *     onEncode: (result) => console.log(`Encoded ${result.encodedCount} IDs`),
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
// Symbol to attach mapping to params object - survives SDK transformations
const MAPPING_SYMBOL = Symbol("promptIdentifiersMapping");

interface ParamsWithMapping {
  [MAPPING_SYMBOL]?: Record<string, string>;
}

export function promptIdentifiersMiddleware(
  options: PromptIdentifiersMiddlewareOptions
): LanguageModelV3Middleware {
  const { config, onEncode, onDecode, debug } = options;
  const shouldInjectInstruction = options.injectInstruction ?? true;

  return {
    specificationVersion: "v3",

    transformParams: async ({ params }) => {
      const startTime = debug ? performance.now() : 0;
      let { encodedPrompt, mapping } = encodePromptMessages(params.prompt, config);
      const durationMs = debug ? performance.now() - startTime : 0;

      // Inject instruction into the system message when IDs were encoded
      if (shouldInjectInstruction && Object.keys(mapping).length > 0) {
        const instruction = buildInstruction(config, options.customInstruction);
        encodedPrompt = injectInstructionIntoPrompt(encodedPrompt, instruction);
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

    wrapGenerate: async ({ doGenerate, params }): Promise<LanguageModelV3GenerateResult> => {
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
      const decodedToolCallInputs: string[] = [];
      const decodedContent = result.content.map((item) => {
        if (item.type === "text") {
          const { decoded, count } = decodeText(item.text, mapping);
          totalCount += count;
          decodedText += decoded;
          if (debug) {
            encodedText += item.text;
          }
          return { ...item, text: decoded };
        }
        // Decode tool call inputs (input is stringified JSON)
        if (item.type === "tool-call" && "input" in item && typeof item.input === "string") {
          const decodedInput = decodeToolInputString(item.input, mapping);
          decodedToolCallInputs.push(decodedInput);
          return { ...item, input: decodedInput };
        }
        return item;
      });

      const durationMs = debug ? performance.now() - startTime : 0;
      const warnings = detectDecodeWarnings(decodedText, decodedToolCallInputs, mapping);

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

    wrapStream: async ({ doStream, params }): Promise<LanguageModelV3StreamResult> => {
      const { stream, ...rest } = await doStream();
      const mapping = (params as ParamsWithMapping)[MAPPING_SYMBOL] ?? {};

      if (Object.keys(mapping).length === 0) {
        return { stream, ...rest };
      }

      const textDecoder = createStreamingDecoder(mapping);

      let accDecodedText = "";
      const accDecodedToolCallInputs: string[] = [];

      // Debug-only accumulation state
      let streamStartTime = 0;
      let accEncodedText = "";
      let streamStarted = false;

      // Transform the stream to decode placeholders in text and tool calls
      const transformedStream = new TransformStream<
        LanguageModelV3StreamPart,
        LanguageModelV3StreamPart
      >({
        transform(chunk, controller) {
          // Decode text deltas
          if (chunk.type === "text-delta" && chunk.delta) {
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

          // Decode complete tool calls (input is stringified JSON)
          if (chunk.type === "tool-call" && "input" in chunk && typeof chunk.input === "string") {
            const decodedInput = decodeToolInputString(chunk.input, mapping);
            accDecodedToolCallInputs.push(decodedInput);
            controller.enqueue({
              ...chunk,
              input: decodedInput,
            });
            return;
          }

          // Decode tool input deltas (partial JSON strings)
          if (chunk.type === "tool-input-delta" && "delta" in chunk) {
            const decodedDelta = decode((chunk as { delta: string }).delta, mapping);
            controller.enqueue({ ...chunk, delta: decodedDelta });
            return;
          }

          controller.enqueue(chunk);
        },

        flush(controller) {
          const remaining = textDecoder.flush();
          if (remaining) {
            accDecodedText += remaining;
            controller.enqueue({
              type: "text-delta",
              id: "",
              delta: remaining,
            } as LanguageModelV3StreamPart);
          }

          const durationMs = debug && streamStarted ? performance.now() - streamStartTime : 0;
          const warnings = detectDecodeWarnings(
            accDecodedText,
            accDecodedToolCallInputs,
            mapping
          );

          onDecode?.({
            output: accDecodedText,
            mapping,
            ...(warnings.length > 0 && { warnings }),
            ...(debug && {
              debugData: {
                decodedCount: Object.keys(mapping).length,
                input: accEncodedText,
                output: accDecodedText,
                durationMs,
              },
            }),
          });
        },
      });

      return {
        stream: stream.pipeThrough(transformedStream),
        ...rest,
      };
    },
  };
}
