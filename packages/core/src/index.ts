/**
 * prompt-identifiers - Efficient, reversible ID compression for LLM prompts
 *
 * Zero runtime dependencies, pure JavaScript/TypeScript implementation.
 */

// =============================================================================
// Patterns - Pre-compiled regex patterns for ID detection
// =============================================================================

/**
 * UUID pattern - RFC 4122 compliant
 * Matches: 123e4567-e89b-42d3-a456-426655440000
 */
const UUID_V4_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * ULID pattern - Crockford Base32, 26 characters
 * Excludes I, L, O, U to avoid confusion
 * Matches: 01ARZ3NDEKTSV4RRFFQ69G5FAV
 */
const ULID_REGEX = /\b[0-9A-HJKMNP-TV-Z]{26}\b/gi;

// =============================================================================
// Types
// =============================================================================

/** Input format: built-in name or custom RegExp */
export type InputFormat = "UUID" | "ULID" | RegExp;

/** Template-based output format */
export interface TemplateFormat {
  /**
   * Template string with {i} placeholder and optional format specifier.
   *
   * Format specifiers:
   * - {i}         → plain numeric: 0, 1, 2, ...
   * - {i:02}      → zero-padded to 2 digits: 00, 01, 02, ...
   * - {i:03}      → zero-padded to 3 digits: 000, 001, 002, ...
   * - {i:zeroFilled} → smart triplet expansion: 000, 001, ..., 999, 001000, ...
   * - {i:base62}  → base62 encoding: 0, 1, ..., 9, A, B, ..., z, 10, ...
   *
   * @example
   * { template: '<id:{i}>' }        // <id:0>, <id:1>, ...
   * { template: 'ID_{i:04}' }       // ID_0000, ID_0001, ...
   * { template: '[[{i:zeroFilled}]]' } // [[000]], [[001]], ..., [[001000]], ...
   * { template: '[{i:base62}]' }    // [0], [A], [z], [10], ...
   */
  template: string;
}

/** Custom formatter function */
export type FormatterFn = (index: number) => string;

/**
 * Output format for placeholder generation.
 *
 * Built-in formats:
 * - 'Numeric'     → smart triplet: 000, 001, ..., 999, 001000, ...
 * - 'IdToken'     → base62: 0, 1, ..., 9, A, ..., Z, a, ..., z, 10, ...
 * - 'Passthrough' → no replacement (returns original text)
 * - 'SafeNumeric' → collision-safe: ~000~, ~001~, ... (tilde-wrapped, URI-safe)
 *
 * Custom formats:
 * - { template: string } → template with {i} placeholder (use for custom delimiters)
 * - (index) => string    → custom formatter function
 */
export type OutputFormat =
  "Numeric" | "IdToken" | "Passthrough" | "SafeNumeric" | TemplateFormat | FormatterFn;

/** Encoding configuration */
export interface EncodeConfig {
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
}

/** Result of encoding operation */
export interface EncodeResult {
  /** Text with IDs replaced by placeholders */
  encoded: string;
  /** Mapping from placeholders to original IDs */
  mapping: Record<string, string>;
}

/**
 * Shared encoding state for consistent placeholder assignment across multiple encode() calls.
 *
 * Pass the same state object to sequential encode() calls to ensure each unique ID always gets
 * the same placeholder, regardless of which call encounters it first.
 *
 * @example
 * const state = createEncodeState();
 * const r1 = encode("User abc-...", config, state);
 * const r2 = encode("Found def-... and abc-...", config, state);
 * // abc-... gets ~000~ in both r1 and r2
 * // def-... gets ~001~ in r2 (counter continues from r1)
 */
export interface EncodeState {
  /** Bidirectional lookup: original ID → placeholder */
  idToPlaceholder: Map<string, string>;
  /** Bidirectional lookup: placeholder → original ID */
  mapping: Record<string, string>;
}

/** Creates a fresh encoding state for use across multiple encode() calls. */
export function createEncodeState(): EncodeState {
  return { idToPlaceholder: new Map(), mapping: {} };
}

// =============================================================================
// Placeholder Generation
// =============================================================================

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Pre-computed base62 values for 0-61 (single character lookups)
const BASE62_CACHE = BASE62_ALPHABET.split("");

/**
 * Convert a number to base-62 representation.
 * Uses alphabet: 0-9A-Za-z
 *
 * Optimization: Values 0-61 use a pre-computed cache to avoid
 * string concatenation in the loop.
 *
 * @example
 * base62(0)  // "0"
 * base62(10) // "A"
 * base62(61) // "z"
 * base62(62) // "10"
 */
function base62(n: number): string {
  // Fast path: single character (0-61)
  if (n < 62) return BASE62_CACHE[n];

  // Multi-character: loop for n >= 62
  let result = "";
  while (n > 0) {
    result = BASE62_ALPHABET[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

/**
 * Generate a zero-filled numeric string with smart triplet expansion.
 *
 * Automatically expands width to maintain triplet alignment:
 * - 0-999: 3 digits ("000"-"999")
 * - 1000-999999: 6 digits ("001000"-"999999")
 * - 1M+: 9 digits, etc.
 *
 * @example
 * zeroFilled(5)       // "005"
 * zeroFilled(999)     // "999"
 * zeroFilled(1000)    // "001000"
 * zeroFilled(1000000) // "001000000"
 */
function zeroFilled(n: number): string {
  const s = n.toString();
  const width = Math.max(3, Math.ceil(s.length / 3) * 3);
  return s.padStart(width, "0");
}

/**
 * Parse and apply a format specifier to an index.
 * Supports: {i}, {i:02}, {i:03}, {i:base62}, {i:zeroFilled}, etc.
 */
function applyFormatSpecifier(index: number, specifier: string | undefined): string {
  if (!specifier) {
    return index.toString();
  }

  if (specifier === "base62") {
    return base62(index);
  }

  // Smart triplet expansion: 000-999, 001000-999999, etc.
  if (specifier === "zeroFilled") {
    return zeroFilled(index);
  }

  // Check for zero-pad format: 02, 03, 04, etc.
  const padMatch = specifier.match(/^(\d+)$/);
  if (padMatch) {
    const width = parseInt(padMatch[1], 10);
    return index.toString().padStart(width, "0");
  }

  // Unknown specifier - just use plain numeric
  return index.toString();
}

/**
 * Parse a template and create a formatter function.
 * Template format: "prefix{i}suffix" or "prefix{i:specifier}suffix"
 */
function parseTemplate(template: string): FormatterFn {
  // Match {i} or {i:specifier}
  const match = template.match(/\{i(?::([^}]+))?\}/);
  if (!match) {
    throw new Error(`Invalid template "${template}": must contain {i} or {i:specifier}`);
  }

  const specifier = match[1]; // undefined if just {i}
  const placeholder = match[0];

  return (index: number) => {
    const formatted = applyFormatSpecifier(index, specifier);
    return template.replace(placeholder, formatted);
  };
}

/**
 * Create a formatter function from the output format.
 */
export function createFormatter(format: OutputFormat): FormatterFn {
  // Custom function
  if (typeof format === "function") return format;

  // Template format
  if (typeof format === "object") return parseTemplate(format.template);

  // Built-in string formats
  switch (format) {
    case "Numeric":
      return zeroFilled;
    case "IdToken":
      return base62;
    case "SafeNumeric":
      return (n: number) => `~${zeroFilled(n)}~`;
    case "Passthrough":
      throw new Error("Passthrough should not create formatter");
  }
}

// These differ from each other in their first and last character, in decimal and in base62, so
// whatever every formatted placeholder shares is delimiter. The widest of them is 16 digits, so a
// format padded wider than that still holds some of its padding across all four and reads it as
// part of the prefix.
const PLACEHOLDER_PROBE_INDICES = [0, 123456789, 987654321, Number.MAX_SAFE_INTEGER];

const builtInShapeCache = new Map<string, PlaceholderShape | undefined>();
const customShapeCache = new WeakMap<object, PlaceholderShape | undefined>();

/** What an output format's placeholders look like: its delimiters and the characters between. */
interface PlaceholderShape {
  pattern: RegExp;
  prefix: string;
  suffix: string;
}

/**
 * The placeholder shape for an output format, or undefined when the format has no delimiters:
 * Numeric and IdToken produce plain numbers and words, which no pattern can find in prose.
 *
 * @example
 * getPlaceholderShape("SafeNumeric")?.pattern // /~\d+~/g
 */
function getPlaceholderShape(format: OutputFormat): PlaceholderShape | undefined {
  if (typeof format === "string") {
    if (!builtInShapeCache.has(format)) {
      builtInShapeCache.set(format, buildPlaceholderShape(format));
    }
    return builtInShapeCache.get(format);
  }
  // Only an object or a function can key the cache, and anything else is a format with no shape
  if (format === null || (typeof format !== "object" && typeof format !== "function")) {
    return undefined;
  }
  if (!customShapeCache.has(format)) {
    customShapeCache.set(format, buildPlaceholderShape(format));
  }
  return customShapeCache.get(format);
}

function buildPlaceholderShape(format: OutputFormat): PlaceholderShape | undefined {
  if (format === "Passthrough") return undefined;

  // A template says where its index sits, so its literals are the affixes exactly, at any pad
  // width. Only a bare FormatterFn has to be probed.
  let template: unknown;
  try {
    template = typeof format === "object" ? format.template : undefined;
  } catch {
    // A format whose own accessor throws says nothing about its shape, and the caller asked
    // which tokens look like placeholders, not for the accessor's error
    return undefined;
  }

  if (typeof template === "string") {
    const slot = template.match(/\{i(?::([^}]+))?\}/);
    if (slot) {
      const prefix = template.slice(0, slot.index);
      const suffix = template.slice(slot.index! + slot[0].length);
      if (prefix || suffix) {
        const body = slot[1] === "base62" ? "[0-9A-Za-z]+" : "\\d+";
        return {
          pattern: new RegExp(escapeRegExp(prefix) + body + escapeRegExp(suffix), "g"),
          prefix,
          suffix,
        };
      }
      return undefined;
    }
  }

  let probes: string[];
  try {
    probes = PLACEHOLDER_PROBE_INDICES.map(createFormatter(format));
  } catch {
    // A template without {i}, or a custom formatter that only covers the indices it expects
    return undefined;
  }
  // A custom formatter can still hand back a non-string for an index it does not cover
  if (!probes.every((p) => typeof p === "string")) return undefined;

  // Running off the end of the probe stops the loop, so a formatter that returns the same string
  // for every index does not grow the prefix forever
  let prefixLength = 0;
  while (
    probes[0][prefixLength] &&
    probes.every((p) => p[prefixLength] === probes[0][prefixLength])
  ) {
    prefixLength++;
  }
  const maxSuffixLength = Math.min(...probes.map((p) => p.length)) - prefixLength;
  let suffixLength = 0;
  while (
    suffixLength < maxSuffixLength &&
    probes.every(
      (p) => p[p.length - 1 - suffixLength] === probes[0][probes[0].length - 1 - suffixLength]
    )
  ) {
    suffixLength++;
  }
  if (prefixLength === 0 && suffixLength === 0) return undefined;

  const bodies = probes.map((p) => p.slice(prefixLength, p.length - suffixLength));
  let body: string;
  if (bodies.every((b) => /^\d+$/.test(b))) {
    body = "\\d+";
  } else if (bodies.every((b) => /^[0-9A-Za-z]+$/.test(b))) {
    body = "[0-9A-Za-z]+";
  } else {
    return undefined;
  }

  const prefix = probes[0].slice(0, prefixLength);
  const suffix = probes[0].slice(probes[0].length - suffixLength);
  return {
    // No lookarounds: they would hide the second of two placeholders that touch. A doubled
    // delimiter is ruled out per match instead.
    pattern: new RegExp(escapeRegExp(prefix) + body + escapeRegExp(suffix), "g"),
    prefix,
    suffix,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Core API
// =============================================================================

/**
 * Get the regex pattern for the specified input format.
 */
function getPattern(inputFormat: InputFormat): RegExp {
  // Custom RegExp
  if (inputFormat instanceof RegExp) {
    // The global flag goes on and the sticky flag comes off, for the same reason: this RegExp
    // describes an identifier to look for anywhere in the text, and sticky anchors every match at
    // lastIndex, which finds at most the run starting where the last one ended.
    const kept = inputFormat.flags.replace(/y/g, "");
    return new RegExp(inputFormat.source, kept.includes("g") ? kept : kept + "g");
  }

  // Built-in formats - return new instance to reset lastIndex
  if (inputFormat === "UUID") {
    return new RegExp(UUID_V4_REGEX.source, UUID_V4_REGEX.flags);
  }

  if (inputFormat === "ULID") {
    return new RegExp(ULID_REGEX.source, ULID_REGEX.flags);
  }

  // Exhaustive check - TypeScript will error if a case is missed
  const _exhaustive: never = inputFormat;
  throw new Error(`Unknown input format: ${_exhaustive}`);
}

/**
 * Encode IDs in the text to short placeholders.
 *
 * @param text - Input text containing IDs to replace
 * @param config - Configuration specifying input and output formats
 * @param state - Optional shared state for consistent placeholders across multiple calls.
 *               When provided, the same ID always gets the same placeholder and the counter
 *               continues from previous calls. The state is mutated in place.
 * @returns Object with encoded text and mapping from placeholders to original IDs
 *
 * @example
 * // Built-in formats
 * encode("User 123e4567-e89b-42d3-a456-426655440000", {
 *   inputFormat: 'UUID',
 *   outputFormat: 'Numeric'
 * });
 * // → { encoded: "User 000", mapping: { "000": "123e4567-..." } }
 *
 * @example
 * // Shared state across multiple calls
 * const state = createEncodeState();
 * const r1 = encode("User 123e4567-...", config, state);  // → ~000~
 * const r2 = encode("New 987fcdeb-... and 123e4567-...", config, state);
 * // 987fcdeb gets ~001~ (not ~000~), 123e4567 stays ~000~
 *
 * @example
 * // Custom regex input
 * encode("User user-123456 logged in", {
 *   inputFormat: /user-\d{6}/gi,
 *   outputFormat: 'Numeric'
 * });
 *
 * @example
 * // Template with format specifier
 * encode("User 123e4567-e89b-42d3-a456-426655440000", {
 *   inputFormat: 'UUID',
 *   outputFormat: { template: '<id:{i:03}>' }
 * });
 * // → { encoded: "User <id:000>", mapping: { "<id:000>": "123e4567-..." } }
 *
 * @example
 * // Custom formatter function
 * encode("User 123e4567-e89b-42d3-a456-426655440000", {
 *   inputFormat: 'UUID',
 *   outputFormat: (i) => `[[ID_${i}]]`
 * });
 * // → { encoded: "User [[ID_0]]", mapping: { "[[ID_0]]": "123e4567-..." } }
 */
export function encode(text: string, config: EncodeConfig, state?: EncodeState): EncodeResult {
  // Passthrough mode - return original text with empty mapping
  if (config.outputFormat === "Passthrough") {
    return { encoded: text, mapping: {} };
  }

  const pattern = getPattern(config.inputFormat);
  const formatter = createFormatter(config.outputFormat);
  const idToPlaceholder = state?.idToPlaceholder ?? new Map<string, string>();
  const mapping = state?.mapping ?? {};

  const encoded = text.replace(pattern, (match) => {
    // An input format able to match the empty string matches between every pair of characters,
    // which mints a placeholder standing for nothing and writes it into every gap in the prompt
    if (match.length === 0) {
      throw new Error(
        `The input format ${String(config.inputFormat)} matched the empty string. An input ` +
          `format has to match at least one character.`
      );
    }

    // One identifier written in two cases is one identifier, so deduplication ignores case. What
    // goes in the mapping is the text as it was written, because decode puts it back into the
    // caller's hands and a ULID that comes back lowercased misses a case-sensitive lookup.
    const id = match.toLowerCase();

    // Reuse existing placeholder for duplicate IDs
    if (idToPlaceholder.has(id)) {
      return idToPlaceholder.get(id)!;
    }

    const placeholder = formatter(idToPlaceholder.size);
    // An empty or missing placeholder drops the ID out of the prompt and leaves a mapping key
    // that matches everywhere, so the output format has to be told rather than worked around
    if (typeof placeholder !== "string" || placeholder.length === 0) {
      throw new Error(
        `The output format returned ${JSON.stringify(placeholder)} for index ` +
          `${idToPlaceholder.size}. A placeholder must be a non-empty string.`
      );
    }
    idToPlaceholder.set(id, placeholder);
    mapping[placeholder] = match;
    return placeholder;
  });

  return { encoded, mapping };
}

/**
 * Return the distinct tokens in a text that carry the output format's delimiters, in order of
 * first appearance. Compare them against a mapping to find the ones a model invented.
 *
 * A body the format would have written differently still counts: "~5~" where SafeNumeric pads to
 * "~005~" is how a model invents an identifier, not a reason to skip it. Delimiters that also
 * occur in ordinary text, such as a bracket template against a markdown link, match text that was
 * never a placeholder. Numeric, IdToken and Passthrough always return an empty list, and so does
 * a formatter that throws on the indices this probes.
 *
 * A template is read for the literals around its index, so its affixes are exact at any pad width.
 * A formatter function cannot be read, so it is probed at four spread indices, the widest 16
 * digits. One padded wider counts its own leading zeros into the prefix, so it still finds a token
 * that starts with them and misses one whose index is long enough not to.
 *
 * @example
 * findPlaceholders("See creator://~053~ and ~~120~~ and ~5~", "SafeNumeric") // ["~053~", "~5~"]
 */
export function findPlaceholders(text: string, format: OutputFormat): string[] {
  const shape = getPlaceholderShape(format);
  if (!shape) return [];

  const { pattern, prefix, suffix } = shape;
  const matches = [...text.matchAll(pattern)];
  const found = new Set<string>();

  for (const [position, match] of matches.entries()) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;

    // A delimiter on both sides is other syntax, such as ~~strikethrough~~. A neighbouring
    // placeholder shares the delimiter between them, so its side does not count.
    const previous = matches[position - 1];
    const openerIsShared = previous !== undefined && previous.index + previous[0].length === start;
    const closerIsShared = matches[position + 1]?.index === end;
    if (
      prefix &&
      suffix &&
      !openerIsShared &&
      !closerIsShared &&
      start >= prefix.length &&
      text.startsWith(prefix, start - prefix.length) &&
      text.startsWith(suffix, end)
    ) {
      continue;
    }

    found.add(token);
  }
  return [...found];
}

// Cache for decode regex patterns - WeakMap allows GC when mapping is no longer referenced.
// encode() adds to a shared state's mapping in place and a caller may prune it, so the entry
// carries the keys it was built from and is rebuilt whenever they change.
const decodeRegexCache = new WeakMap<Record<string, string>, { keys: string[]; pattern: RegExp }>();

/** Whether two key lists hold the same names in the same order. */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decode placeholders back to original IDs.
 *
 * Optimization: The regex pattern is cached per mapping object using WeakMap, and rebuilt when
 * that mapping's keys change, so repeated calls over an unchanged mapping skip compilation.
 *
 * @param text - Text containing placeholders
 * @param mapping - Mapping from placeholders to original IDs (from encode)
 * @returns Text with original IDs restored
 */
export function decode(text: string, mapping: Record<string, string>): string {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) return text;

  // An empty key matches at every position, so it would insert its ID throughout the text.
  // encode refuses to mint one, and a mapping that carries one is built by hand.
  if (placeholders.includes("")) {
    throw new Error("The mapping has an empty placeholder key, which matches at every position.");
  }

  // A cached pattern matches the keys the mapping held when it was built. encode() adds to the
  // mapping it returns, and a caller may prune it, so a stale pattern misses keys and reports a
  // key it no longer holds.
  const cached = decodeRegexCache.get(mapping);
  let pattern = cached && sameKeys(cached.keys, placeholders) ? cached.pattern : undefined;
  if (!pattern) {
    const keys = placeholders.slice();

    // Sort by length descending to prevent partial matches (e.g., "0010" before "001")
    placeholders.sort((a, b) => b.length - a.length);

    // Build a single regex matching all placeholders - O(n) single pass
    pattern = new RegExp(
      placeholders.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "g"
    );

    decodeRegexCache.set(mapping, { keys, pattern });
  }

  // Reset lastIndex for global regex reuse
  pattern.lastIndex = 0;

  return text.replace(pattern, (match) => mapping[match]);
}
