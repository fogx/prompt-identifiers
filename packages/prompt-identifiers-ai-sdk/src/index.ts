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
  source: "text" | "tool_call" | "tool_result";
  /** The tool the value came from, when source is "tool_call" or "tool_result" */
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
 * Indices spread far enough apart that a format's padding differs across them, so what they share
 * is its literals. The widest is 16 digits, and a format padded wider keeps some of its padding in
 * the shared prefix.
 */
const PROBE_INDICES = [0, 123456789, 987654321, Number.MAX_SAFE_INTEGER];

/**
 * The bodies of a call's placeholders: each one with the format's fixed prefix and suffix removed.
 *
 * The affixes are read off the format rather than guessed, by writing a placeholder at several
 * spread-out indices and keeping only what all of them share at each end, so a literal carrying
 * its own digits (`v1_{i:03}`) contributes nothing and neither does padding up to the width of the
 * widest probe, which one index alone cannot tell from a delimiter. A format with nothing fixed at
 * either end has no delimiters for a model to strip, which is the case the warning cannot report.
 */
function placeholderBodies(
  placeholders: string[],
  outputFormat: EncodeConfig["outputFormat"]
): Set<string> {
  const bodies = new Set<string>();
  if (outputFormat === "Passthrough") return bodies;

  // A template says where its index sits, so its literals are the affixes exactly, at any pad
  // width. Only a bare FormatterFn has to be probed.
  if (typeof outputFormat === "object" && typeof outputFormat.template === "string") {
    const slot = outputFormat.template.match(/\{i(?::[^}]+)?\}/);
    if (slot) {
      return bodiesFrom(
        placeholders,
        slot.index!,
        outputFormat.template.length - slot.index! - slot[0].length,
        bodies
      );
    }
  }

  let probes: string[];
  try {
    const formatter = createFormatter(outputFormat);
    probes = PROBE_INDICES.map(formatter);
  } catch {
    // A formatter that refuses an index cannot be probed, so report nothing rather than guess
    return bodies;
  }
  if (!probes.every((probe) => typeof probe === "string" && probe.length > 0)) return bodies;

  const [low] = probes;
  const shortest = Math.min(...probes.map((probe) => probe.length));

  let prefix = 0;
  while (prefix < shortest && probes.every((probe) => probe[prefix] === low[prefix])) prefix++;

  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    probes.every((probe) => probe[probe.length - 1 - suffix] === low[low.length - 1 - suffix])
  ) {
    suffix++;
  }

  return bodiesFrom(placeholders, prefix, suffix, bodies);
}

/** Each placeholder with the format's fixed prefix and suffix cut off. */
function bodiesFrom(
  placeholders: string[],
  prefix: number,
  suffix: number,
  bodies: Set<string>
): Set<string> {
  if (prefix === 0 && suffix === 0) return bodies;

  for (const placeholder of placeholders) {
    const body = placeholder.slice(prefix, placeholder.length - suffix);
    if (body) bodies.add(body);
  }
  return bodies;
}

/** Finish reasons that stop the model partway through what it was writing. */
const CUT_SHORT = new Set(["length", "content-filter", "error"]);

/**
 * Detect decode anomalies in the decoded output.
 *
 * 1. Surviving placeholders: encoded placeholders (e.g., ~000~) that remain
 *    in the decoded text, meaning decode missed them.
 * 2. Stripped delimiters: bare placeholder indices (e.g., 000) that appear
 *    as standalone values, suggesting the LLM stripped the delimiter characters.
 * 3. Unknown placeholders: placeholder-shaped tokens that are not in the mapping,
 *    such as one the model invented. Only delimited formats can report these, and a truncated
 *    answer's trailing token is spared when a placeholder this call minted starts with it.
 */
function detectDecodeWarnings(
  decodedText: string,
  decodedToolCalls: DecodedToolCall[],
  decodedToolResults: DecodedToolCall[],
  mapping: Record<string, string>,
  config: EncodeConfig,
  isTruncated: boolean
): DecodeWarning[] {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) return [];

  const ids = Object.values(mapping);
  const warnings: DecodeWarning[] = [];
  // What a cut leaves behind is the start of a placeholder this call minted. A token that starts
  // none of them is the model's own, however the answer ended.
  const startsAPlaceholder = (token: string) =>
    placeholders.some((p) => p.length > token.length && p.startsWith(token));

  // What a placeholder looks like with the format's own prefix and suffix stripped off
  const bareIndices = placeholderBodies(placeholders, config.outputFormat);

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
      if (mapping[token] !== undefined) continue;

      // A cut leaves half a placeholder behind, and an answer carrying several blocks has one per
      // block, so position says nothing about which of them the cut made
      if (isTruncated && startsAPlaceholder(token)) continue;

      warnings.push({ type: "unknown_placeholder", value: token, ...source });
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
  for (const { toolName, input } of decodedToolResults) {
    check(input, { source: "tool_result", toolName });
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

  if (
    (typedOutput.type === "json" || typedOutput.type === "error-json") &&
    typedOutput.value !== undefined
  ) {
    return { ...typedOutput, value: encodeJsonValue(typedOutput.value, config, state) };
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
 * Encode IDs in every string a JSON payload carries, keys included.
 *
 * Encoding the serialised document instead would run the ID patterns over JSON's own escapes.
 * A newline is written as a backslash and an `n`, and both ID patterns open on a word boundary,
 * so an ID written straight after one is never matched and silently travels uncompressed.
 */
function encodeJsonValue(
  value: unknown,
  config: EncodeConfig,
  state: EncodeState,
  key = "",
  open: Set<object> = new Set()
): unknown {
  const resolved = jsonFormOf(value, key);

  if (typeof resolved === "string") return encode(resolved, config, state).encoded;

  if (typeof resolved !== "object" || resolved === null) return resolved;

  // Serialising the payload is the provider's job and it would report this; the walk reaches it
  // first and would otherwise run out of stack with nothing to point at
  if (open.has(resolved)) {
    throw new TypeError("Converting circular structure to JSON in a tool payload.");
  }
  open.add(resolved);
  try {
    if (Array.isArray(resolved)) {
      return resolved.map((item, index) =>
        encodeJsonValue(item, config, state, String(index), open)
      );
    }

    const encoded: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(resolved)) {
      // A function is not JSON, and carrying one through would hand the provider a `toJSON` that
      // runs on the encoded payload and writes an identifier the encoder never saw
      if (typeof item === "function") continue;

      const encodedName = encode(name, config, state).encoded;
      // One identifier written two ways, or a key already spelled like a placeholder this call
      // mints, would otherwise leave one entry standing for two
      if (Object.prototype.hasOwnProperty.call(encoded, encodedName)) {
        throw new Error(
          `Two keys in a tool payload encode to the same placeholder ${JSON.stringify(encodedName)}, ` +
            `so one of them would be lost. Give the object one key per identifier, or choose an ` +
            `output format whose placeholders an ordinary key cannot spell.`
        );
      }
      // Defining the property keeps a key of `__proto__`, which JSON.parse produces as an own
      // key, off the prototype setter that would drop the field and reshape the payload
      Object.defineProperty(encoded, encodedName, {
        value: encodeJsonValue(item, config, state, name, open),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return encoded;
  } finally {
    open.delete(resolved);
  }
}

/**
 * Restore every identifier inside a parsed JSON value, in its keys as well as its strings.
 *
 * A provider that runs a tool itself is handed the encoded arguments, so the result it sends back
 * carries the same placeholders, and a model grouping its answer can put one in a key position.
 */
function decodeJsonValue(
  value: unknown,
  mapping: Record<string, string>,
  open: Set<object> = new Set()
): unknown {
  if (typeof value === "string") return decode(value, mapping);
  if (typeof value !== "object" || value === null) return value;

  // The walk reaches a self-reference before the stack runs out, which is the only place that can
  // say which side of the exchange the payload came from
  if (open.has(value)) {
    throw new TypeError("Converting circular structure to JSON in a tool result.");
  }
  open.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => decodeJsonValue(item, mapping, open));

    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        decode(name, mapping),
        decodeJsonValue(item, mapping, open),
      ])
    );
  } finally {
    open.delete(value);
  }
}

/**
 * What `JSON.stringify` would serialise in this value's place, asked for exactly once.
 *
 * The provider stringifies the payload after the middleware has encoded it. Walking a value as it
 * stands would encode fields the provider then discards and leave what `toJSON` returns untouched,
 * so a `Date` reaches the model as `{}` and an identifier behind a `toJSON` reaches it raw.
 */
function jsonFormOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return value;

  const withToJson = value as { toJSON?: (key: string) => unknown };
  // `toJSON` speaks for the slot once. What it hands back is serialised as it stands, so a `toJSON`
  // on the result is an ordinary property from here on and never a second conversion
  const resolved = typeof withToJson.toJSON === "function" ? withToJson.toJSON(key) : value;
  if (resolved === null || typeof resolved !== "object") return resolved;

  // valueOf, not the wrapper's own conversion: Boolean(new Boolean(false)) is true, because the
  // box is an object before it is a false
  if (resolved instanceof String) return resolved.valueOf();
  if (resolved instanceof Number) return resolved.valueOf();
  if (resolved instanceof Boolean) return resolved.valueOf();

  return resolved;
}

/**
 * Encode IDs in tool call input (args), which is an arbitrary JSON value.
 */
function encodeToolCallInput(input: unknown, config: EncodeConfig, state: EncodeState): unknown {
  if (input == null) return input;

  return encodeJsonValue(input, config, state);
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
  return decode(input, jsonSafeMapping(mapping));
}

/**
 * Escaped mappings, keyed on the mapping they came from so decode keeps its compiled pattern. The
 * key list is stored alongside, because a mapping grows in place as a call mints placeholders and
 * an entry added after the first lookup would otherwise never be escaped.
 */
const jsonSafeMappings = new WeakMap<
  Record<string, string>,
  { keys: string[]; escaped: Record<string, string> }
>();

/**
 * The same mapping with every identifier written the way JSON would write it inside a string.
 *
 * Tool input is serialised JSON rewritten as text rather than parsed, so an identifier carrying a
 * quote, a backslash or a control character has to arrive escaped or the SDK can no longer parse
 * what the tool is called with. A built-in format matches none of those, and the mapping itself is
 * returned when nothing needs escaping, which keeps decode on its cached pattern.
 */
function jsonSafeMapping(mapping: Record<string, string>): Record<string, string> {
  const keys = Object.keys(mapping);
  const known = jsonSafeMappings.get(mapping);
  if (known && sameKeys(known.keys, keys)) return known.escaped;

  const escaped: Record<string, string> = {};
  let changed = false;
  for (const placeholder of keys) {
    const id = mapping[placeholder];
    const safe = JSON.stringify(id).slice(1, -1);
    if (safe !== id) changed = true;
    escaped[placeholder] = safe;
  }

  const result = changed ? escaped : mapping;
  jsonSafeMappings.set(mapping, { keys, escaped: result });
  return result;
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((key, index) => key === b[index]);
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
  // Spreading the lengths into Math.max overflows the call stack past roughly 120,000 placeholders
  let longest = 0;
  for (const placeholder of placeholders) {
    if (placeholder.length > longest) longest = placeholder.length;
  }
  const longestTail = longest - 1;

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
  // A peer range is a warning rather than a wall, and a CJS require of a core too old to export
  // this reads it as undefined, so a stale pair would otherwise run a whole billed turn before
  // the decode path touched it
  if (typeof findPlaceholders !== "function") {
    throw new Error(
      "promptIdentifiersMiddleware needs prompt-identifiers 0.2.0 or later. The installed copy " +
        "does not export findPlaceholders."
    );
  }

  // A tool payload reaches the model as JSON and comes back as JSON text the decoder scans without
  // parsing, so a placeholder JSON has to escape is written one way and read another
  const example =
    config.outputFormat === "Passthrough" ? "" : createFormatter(config.outputFormat)(0);
  const unsafe = example.match(/["\\\u0000-\u001f]/);
  if (unsafe) {
    throw new Error(
      `promptIdentifiersMiddleware: the output format writes ${JSON.stringify(example)}, which ` +
        `carries ${JSON.stringify(unsafe[0])}. JSON escapes that character, so the placeholder ` +
        `would not survive a tool call. Choose a format without it.`
    );
  }

  // Passthrough encodes nothing, so there is no format to name and nothing to instruct about
  const builtInstruction =
    instruction === false || config.outputFormat === "Passthrough"
      ? undefined
      : instruction.replace(/\{format\}/g, () => createFormatter(config.outputFormat)(0));

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
      // Keyed by tool call, because a preliminary result is replaced by the next one for that
      // call and only the last of them is the content the answer was built from
      const decodedToolResults = new Map<string, DecodedToolCall>();
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
        if (item.type === "tool-result" && item.result !== undefined) {
          const decodedResult = decodeJsonValue(item.result, mapping);
          // Serialising is the warning scan's own cost and a provider-run tool returns whole
          // documents, so nothing pays it unheard
          if (onDecode) {
            decodedToolResults.set(item.toolCallId, {
              toolName: item.toolName,
              input: JSON.stringify(decodedResult),
            });
          }
          return { ...item, result: decodedResult as typeof item.result };
        }
        return item;
      });

      const durationMs = debug ? performance.now() - startTime : 0;
      const warnings = onDecode
        ? detectDecodeWarnings(
            decodedText,
            decodedToolCalls,
            [...decodedToolResults.values()],
            mapping,
            config,
            // The opposite default to the streamed path, deliberately: doGenerate returning at
            // all means the answer is complete, so a result with no finishReason is a
            // malformed complete answer rather than a cut one
            CUT_SHORT.has(result.finishReason?.unified ?? "")
          )
        : [];

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

      // A provider can run several text, reasoning and tool input blocks at once, and a placeholder
      // split across one block's chunks must not be completed by another block's text
      const textDecoders = new Map<string, ReturnType<typeof createStreamingDecoder>>();
      const reasoningDecoders = new Map<string, ReturnType<typeof createStreamingDecoder>>();
      const toolInputDecoders = new Map<string, ReturnType<typeof createStreamingDecoder>>();

      let accDecodedText = "";
      const accDecodedToolCalls: DecodedToolCall[] = [];
      // Keyed by tool call, because a preliminary result is replaced by the next one for that
      // call and only the last of them is the content the answer was built from
      const accDecodedToolResults = new Map<string, DecodedToolCall>();

      // Debug-only accumulation state
      let streamStartTime = 0;
      let accEncodedText = "";
      let streamStarted = false;

      // A stream that never reports one was cut off, the same as one that ran out of room
      let streamFinishReason: string | undefined;

      let reported = false;
      function report() {
        if (reported) return;
        reported = true;

        // A stream that ended without a closing chunk leaves the buffer unflushed;
        // it is too late to emit it, but the callback should still see it.
        for (const decoder of textDecoders.values()) accDecodedText += decoder.flush();
        textDecoders.clear();

        const durationMs = debug && streamStarted ? performance.now() - streamStartTime : 0;
        const warnings = onDecode
          ? detectDecodeWarnings(
              accDecodedText,
              accDecodedToolCalls,
              [...accDecodedToolResults.values()],
              mapping,
              config,
              // A stream that never reported one did not finish, which is a cut the generate
              // path cannot have
              streamFinishReason === undefined || CUT_SHORT.has(streamFinishReason)
            )
          : [];

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
      // A provider may skip the opening chunk or repeat it, and either way the id needs the one
      // decoder that holds this block's tail
      type Decoders = Map<string, ReturnType<typeof createStreamingDecoder>>;
      function decoderFor(decoders: Decoders, id: string) {
        let decoder = decoders.get(id);
        if (!decoder) {
          // Tool input arrives as serialised JSON rewritten in place, the same as the assembled
          // tool call, so its identifiers have to go back escaped or the deltas stop parsing
          const forBlock = decoders === toolInputDecoders ? jsonSafeMapping(mapping) : mapping;
          decoder = createStreamingDecoder(forBlock);
          decoders.set(id, decoder);
        }
        return decoder;
      }

      // Drains every block still holding a tail, each onto its own block
      function flushAll(
        decoders: Decoders,
        type: "text-delta" | "reasoning-delta",
        emit: (part: LanguageModelV4StreamPart) => void
      ) {
        for (const [id, decoder] of decoders) {
          const remaining = decoder.flush();
          if (remaining) {
            if (type === "text-delta") accDecodedText += remaining;
            emit({ type, id, delta: remaining } as LanguageModelV4StreamPart);
          }
        }
        decoders.clear();
      }

      const transformedStream = new TransformStream<
        LanguageModelV4StreamPart,
        LanguageModelV4StreamPart
      >({
        transform(chunk, controller) {
          // A closing chunk is the last chance to emit what a decoder still holds:
          // anything enqueued from flush() arrives after the stream has finished,
          // with no open block to attach to, and is dropped from the assembled message.
          if (chunk.type === "text-end") {
            const remaining = textDecoders.get(chunk.id)?.flush();
            if (remaining) {
              accDecodedText += remaining;
              controller.enqueue({
                type: "text-delta",
                id: chunk.id,
                delta: remaining,
              } as LanguageModelV4StreamPart);
            }
            textDecoders.delete(chunk.id);
          }

          if (chunk.type === "reasoning-end") {
            const remaining = reasoningDecoders.get(chunk.id)?.flush();
            if (remaining) {
              controller.enqueue({
                type: "reasoning-delta",
                id: chunk.id,
                delta: remaining,
              } as LanguageModelV4StreamPart);
            }
            reasoningDecoders.delete(chunk.id);
          }

          if (chunk.type === "finish") {
            flushAll(textDecoders, "text-delta", (part) => controller.enqueue(part));
            flushAll(reasoningDecoders, "reasoning-delta", (part) => controller.enqueue(part));
          }

          if (chunk.type === "finish") {
            streamFinishReason = chunk.finishReason?.unified;

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
            if (debug) {
              if (!streamStarted) {
                streamStartTime = performance.now();
                streamStarted = true;
              }
              accEncodedText += chunk.delta;
            }
            const decoded = decoderFor(textDecoders, chunk.id).process(chunk.delta);
            if (decoded) {
              accDecodedText += decoded;
              controller.enqueue({ ...chunk, delta: decoded });
            }
            return;
          }

          // Decode reasoning deltas
          if (chunk.type === "reasoning-delta" && chunk.delta) {
            const decoded = decoderFor(reasoningDecoders, chunk.id).process(chunk.delta);
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

          if (chunk.type === "tool-result" && chunk.result !== undefined) {
            const decodedResult = decodeJsonValue(chunk.result, mapping);
            // Serialising is the warning scan's own cost and a provider-run tool returns whole
            // documents, so nothing pays it unheard
            if (onDecode) {
              accDecodedToolResults.set(chunk.toolCallId, {
                toolName: chunk.toolName,
                input: JSON.stringify(decodedResult),
              });
            }
            controller.enqueue({ ...chunk, result: decodedResult as typeof chunk.result });
            return;
          }

          if (chunk.type === "tool-input-start") {
            decoderFor(toolInputDecoders, chunk.id);
            controller.enqueue(chunk);
            return;
          }

          // Decode tool input deltas (partial JSON strings)
          if (chunk.type === "tool-input-delta" && "delta" in chunk) {
            const decoder = decoderFor(toolInputDecoders, chunk.id);
            const rawDelta = (chunk as { delta: string }).delta;
            const decodedDelta = decoder.process(rawDelta);
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
