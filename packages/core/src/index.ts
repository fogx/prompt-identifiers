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
export type InputFormat = 'UUID' | 'ULID' | RegExp;

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
 * - 'SafeNumeric' → collision-safe: <000>, <001>, ... (angle bracket-wrapped)
 *
 * Custom formats:
 * - { template: string } → template with {i} placeholder (use for custom delimiters)
 * - (index) => string    → custom formatter function
 */
export type OutputFormat =
  | 'Numeric'
  | 'IdToken'
  | 'Passthrough'
  | 'SafeNumeric'
  | TemplateFormat
  | FormatterFn;

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

// =============================================================================
// Placeholder Generation
// =============================================================================

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Pre-computed base62 values for 0-61 (single character lookups)
const BASE62_CACHE = BASE62_ALPHABET.split('');

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
  let result = '';
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
  return s.padStart(width, '0');
}

/**
 * Parse and apply a format specifier to an index.
 * Supports: {i}, {i:02}, {i:03}, {i:base62}, {i:zeroFilled}, etc.
 */
function applyFormatSpecifier(index: number, specifier: string | undefined): string {
  if (!specifier) {
    return index.toString();
  }

  if (specifier === 'base62') {
    return base62(index);
  }

  // Smart triplet expansion: 000-999, 001000-999999, etc.
  if (specifier === 'zeroFilled') {
    return zeroFilled(index);
  }

  // Check for zero-pad format: 02, 03, 04, etc.
  const padMatch = specifier.match(/^(\d+)$/);
  if (padMatch) {
    const width = parseInt(padMatch[1], 10);
    return index.toString().padStart(width, '0');
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
function createFormatter(format: OutputFormat): FormatterFn {
  // Custom function
  if (typeof format === 'function') return format;

  // Template format
  if (typeof format === 'object') return parseTemplate(format.template);

  // Built-in string formats
  switch (format) {
    case 'Numeric':
      return zeroFilled;
    case 'IdToken':
      return base62;
    case 'SafeNumeric':
      return (n: number) => `<${zeroFilled(n)}>`;
    case 'Passthrough':
      throw new Error('Passthrough should not create formatter');
  }
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
    // Ensure global flag is set, preserve other flags
    const flags = inputFormat.flags.includes('g') ? inputFormat.flags : inputFormat.flags + 'g';
    return new RegExp(inputFormat.source, flags);
  }

  // Built-in formats - return new instance to reset lastIndex
  if (inputFormat === 'UUID') {
    return new RegExp(UUID_V4_REGEX.source, UUID_V4_REGEX.flags);
  }

  if (inputFormat === 'ULID') {
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
export function encode(text: string, config: EncodeConfig): EncodeResult {
  // Passthrough mode - return original text with empty mapping
  if (config.outputFormat === 'Passthrough') {
    return { encoded: text, mapping: {} };
  }

  const pattern = getPattern(config.inputFormat);
  const formatter = createFormatter(config.outputFormat);
  const idToPlaceholder = new Map<string, string>();
  const mapping: Record<string, string> = {};

  const encoded = text.replace(pattern, (match) => {
    // Normalize to lowercase for consistent deduplication
    const id = match.toLowerCase();

    // Reuse existing placeholder for duplicate IDs
    if (idToPlaceholder.has(id)) {
      return idToPlaceholder.get(id)!;
    }

    const placeholder = formatter(idToPlaceholder.size);
    idToPlaceholder.set(id, placeholder);
    mapping[placeholder] = id;
    return placeholder;
  });

  return { encoded, mapping };
}

// Cache for decode regex patterns - WeakMap allows GC when mapping is no longer referenced
const decodeRegexCache = new WeakMap<Record<string, string>, RegExp>();

/**
 * Decode placeholders back to original IDs.
 *
 * Optimization: The regex pattern is cached per mapping object using WeakMap.
 * Repeated calls with the same mapping skip regex compilation entirely.
 *
 * @param text - Text containing placeholders
 * @param mapping - Mapping from placeholders to original IDs (from encode)
 * @returns Text with original IDs restored
 */
export function decode(text: string, mapping: Record<string, string>): string {
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) return text;

  // Check cache for pre-compiled pattern
  let pattern = decodeRegexCache.get(mapping);
  if (!pattern) {
    // Sort by length descending to prevent partial matches (e.g., "0010" before "001")
    placeholders.sort((a, b) => b.length - a.length);

    // Build a single regex matching all placeholders - O(n) single pass
    pattern = new RegExp(
      placeholders.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g'
    );

    decodeRegexCache.set(mapping, pattern);
  }

  // Reset lastIndex for global regex reuse
  pattern.lastIndex = 0;

  return text.replace(pattern, (match) => mapping[match]);
}
