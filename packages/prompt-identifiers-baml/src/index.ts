/**
 * prompt-identifiers-baml - BAML wrapper for automatic ID encoding/decoding
 *
 * Wraps BAML-generated TypeScript functions to automatically encode IDs
 * in inputs and decode them in outputs.
 */

import { createEncodeState, decode, encode, EncodeConfig, EncodeState } from "prompt-identifiers";

// =============================================================================
// Types
// =============================================================================

/** Debug data included in onEncode callback when debug is true */
export interface EncodeDebugData {
  /** Number of unique IDs encoded */
  encodedCount: number;
  /** Original input object before encoding */
  input: unknown;
  /** Encoded input object */
  output: unknown;
  /** Time spent encoding in milliseconds */
  durationMs: number;
}

/** Debug data included in onDecode callback when debug is true */
export interface DecodeDebugData {
  /** Number of fields containing decoded placeholders */
  decodedCount: number;
  /** Raw output from LLM (encoded) */
  input: unknown;
  /** Decoded output with original IDs restored */
  output: unknown;
  /** Time spent decoding in milliseconds */
  durationMs: number;
}

/** Configuration options for the BAML wrapper */
export interface WrapBamlFunctionOptions {
  /** Encoding configuration (inputFormat and outputFormat) */
  config: EncodeConfig;

  /**
   * Optional: specific field paths to encode.
   * If not provided, all string fields matching the input pattern are encoded.
   *
   * Supports dot notation and array wildcards:
   * - 'user_id' - top-level field
   * - 'data.user_id' - nested field
   * - 'items[].id' - all 'id' fields in 'items' array
   * - 'data.users[].profile.id' - deeply nested array field
   *
   * @example
   * encodeFields: ['user_id', 'items[].id', 'metadata.owner_id']
   */
  encodeFields?: string[];

  /**
   * Enable debug mode to populate debugData in callbacks with
   * input/output snapshots, counts, and timing information.
   */
  debug?: boolean;

  /**
   * Optional callback fired after encoding IDs in the input.
   * Receives the placeholder→ID mapping. When debug is true,
   * also receives debugData with input, output, counts, and timing.
   */
  onEncode?: (result: { mapping: Record<string, string>; debugData?: EncodeDebugData }) => void;

  /**
   * Optional callback fired after decoding IDs in the output.
   * When debug is true, receives debugData with input, output, counts, and timing.
   */
  onDecode?: (result: { debugData?: DecodeDebugData }) => void;
}

/** A BAML function type (sync or async) */
export type BamlFunction<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/** A BAML streaming function type */
export type BamlStreamingFunction<TInput, TPartial, TFinal> = (
  input: TInput
) => AsyncGenerator<TPartial, TFinal, unknown>;

// =============================================================================
// Field Path Matching
// =============================================================================

/**
 * Parse a field path into segments.
 * 'items[].id' -> ['items', '[]', 'id']
 */
function parseFieldPath(path: string): string[] {
  const segments: string[] = [];
  let current = "";

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === ".") {
      if (current) {
        segments.push(current);
        current = "";
      }
    } else if (char === "[" && path[i + 1] === "]") {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push("[]");
      i++; // skip ']'
    } else {
      current += char;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

/**
 * Check if a value at the given path should be encoded.
 */
function matchesFieldPath(currentPath: string[], targetSegments: string[]): boolean {
  if (currentPath.length !== targetSegments.length) {
    return false;
  }

  for (let i = 0; i < targetSegments.length; i++) {
    const target = targetSegments[i];
    const current = currentPath[i];

    // '[]' matches any array index
    if (target === "[]") {
      if (!/^\d+$/.test(current)) {
        return false;
      }
    } else if (target !== current) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Deep Object Traversal
// =============================================================================

/**
 * Context for encoding operations - tracks state across recursive calls.
 * Delegates to core's encode() with shared EncodeState for consistent placeholder assignment.
 */
interface EncodeContext {
  config: EncodeConfig;
  fieldPaths: string[][] | null; // null means auto-detect mode
  state: EncodeState;
}

/**
 * Deep traverse and encode IDs in an object.
 * Returns a new object with IDs replaced by placeholders.
 */
function deepEncode<T>(value: T, ctx: EncodeContext, path: string[] = []): T {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings - the primary encoding target
  if (typeof value === "string") {
    // Check if this field should be encoded
    const shouldEncode =
      ctx.fieldPaths === null || ctx.fieldPaths.some((fp) => matchesFieldPath(path, fp));

    if (!shouldEncode) {
      return value;
    }

    // Encode the string using core's encode() with shared state
    return encode(value, ctx.config, ctx.state).encoded as T;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item, index) => deepEncode(item, ctx, [...path, String(index)])) as T;
  }

  // Handle objects
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      result[key] = deepEncode(val, ctx, [...path, key]);
    }

    return result as T;
  }

  // Primitives (numbers, booleans) - return as-is
  return value;
}

/**
 * Deep traverse and decode placeholders in an object.
 * Returns a new object with placeholders replaced by original IDs.
 */
function deepDecode<T>(value: T, mapping: Record<string, string>, countRef: { count: number }): T {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings
  if (typeof value === "string") {
    const decoded = decode(value, mapping);
    // Count replacements
    if (decoded !== value) {
      countRef.count++;
    }
    return decoded as T;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => deepDecode(item, mapping, countRef)) as T;
  }

  // Handle objects
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      result[key] = deepDecode(val, mapping, countRef);
    }

    return result as T;
  }

  // Primitives - return as-is
  return value;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Wrap a BAML function to automatically encode IDs in inputs and decode them in outputs.
 *
 * @example
 * ```typescript
 * import { wrapBamlFunction } from 'prompt-identifiers-baml';
 * import { b } from './baml_client';
 *
 * const analyzeUser = wrapBamlFunction(b.AnalyzeUser, {
 *   config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
 *   encodeFields: ['user_id', 'items[].id'],  // Optional: specific fields
 * });
 *
 * // Use normally - IDs are auto-encoded/decoded
 * const result = await analyzeUser({
 *   user_id: '123e4567-e89b-42d3-a456-426655440000',
 *   items: [{ id: '987fcdeb-51a2-43f7-8d9c-0123456789ab', name: 'test' }]
 * });
 * ```
 */
export function wrapBamlFunction<TInput, TOutput>(
  fn: BamlFunction<TInput, TOutput>,
  options: WrapBamlFunctionOptions
): BamlFunction<TInput, TOutput> {
  const { config, encodeFields, onEncode, onDecode, debug } = options;

  // Pre-parse field paths if provided
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  return async (input: TInput): Promise<TOutput> => {
    // Encode input
    const ctx: EncodeContext = {
      config,
      fieldPaths,
      state: createEncodeState(),
    };

    const startEncode = debug ? performance.now() : 0;
    const encodedInput = deepEncode(input, ctx);
    const encodeDurationMs = debug ? performance.now() - startEncode : 0;

    onEncode?.({
      mapping: ctx.state.mapping,
      ...(debug && {
        debugData: {
          encodedCount: Object.keys(ctx.state.mapping).length,
          input,
          output: encodedInput,
          durationMs: encodeDurationMs,
        },
      }),
    });

    // Call the original function
    const output = await fn(encodedInput);

    // Decode output
    const countRef = { count: 0 };
    const startDecode = debug ? performance.now() : 0;
    const decodedOutput = deepDecode(output, ctx.state.mapping, countRef);
    const decodeDurationMs = debug ? performance.now() - startDecode : 0;

    onDecode?.({
      ...(debug && {
        debugData: {
          decodedCount: countRef.count,
          input: output,
          output: decodedOutput,
          durationMs: decodeDurationMs,
        },
      }),
    });

    return decodedOutput;
  };
}

/**
 * Wrap a BAML streaming function to automatically encode IDs in inputs
 * and decode them in outputs (both partial and final).
 *
 * @example
 * ```typescript
 * import { wrapBamlStreamingFunction } from 'prompt-identifiers-baml';
 * import { b } from './baml_client';
 *
 * const streamAnalysis = wrapBamlStreamingFunction(b.stream.AnalyzeUser, {
 *   config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
 * });
 *
 * for await (const partial of streamAnalysis({ user_id: 'uuid-here' })) {
 *   console.log(partial); // IDs decoded in real-time
 * }
 * ```
 */
export function wrapBamlStreamingFunction<TInput, TPartial, TFinal>(
  fn: BamlStreamingFunction<TInput, TPartial, TFinal>,
  options: WrapBamlFunctionOptions
): BamlStreamingFunction<TInput, TPartial, TFinal> {
  const { config, encodeFields, onEncode, onDecode, debug } = options;

  // Pre-parse field paths if provided
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  return async function* (input: TInput): AsyncGenerator<TPartial, TFinal, unknown> {
    // Encode input
    const ctx: EncodeContext = {
      config,
      fieldPaths,
      state: createEncodeState(),
    };

    const startEncode = debug ? performance.now() : 0;
    const encodedInput = deepEncode(input, ctx);
    const encodeDurationMs = debug ? performance.now() - startEncode : 0;

    onEncode?.({
      mapping: ctx.state.mapping,
      ...(debug && {
        debugData: {
          encodedCount: Object.keys(ctx.state.mapping).length,
          input,
          output: encodedInput,
          durationMs: encodeDurationMs,
        },
      }),
    });

    // Call the original streaming function
    const generator = fn(encodedInput);
    let totalDecoded = 0;
    const startDecode = debug ? performance.now() : 0;

    while (true) {
      const { value, done } = await generator.next();

      if (done) {
        // Final value
        const countRef = { count: 0 };
        const decodedValue = deepDecode(value, ctx.state.mapping, countRef);
        totalDecoded += countRef.count;
        const decodeDurationMs = debug ? performance.now() - startDecode : 0;

        onDecode?.({
          ...(debug && {
            debugData: {
              decodedCount: totalDecoded,
              input: value,
              output: decodedValue,
              durationMs: decodeDurationMs,
            },
          }),
        });
        return decodedValue;
      }

      // Partial value
      const countRef = { count: 0 };
      const decodedValue = deepDecode(value, ctx.state.mapping, countRef);
      totalDecoded += countRef.count;
      yield decodedValue;
    }
  };
}

/**
 * Utility function to encode a plain object (useful for manual encoding).
 *
 * @example
 * ```typescript
 * const { encoded, mapping } = encodeObject(
 *   { user_id: 'uuid-here', data: { owner: 'other-uuid' } },
 *   { inputFormat: 'UUID', outputFormat: 'SafeNumeric' }
 * );
 * ```
 */
export function encodeObject<T>(
  obj: T,
  config: EncodeConfig,
  encodeFields?: string[]
): { encoded: T; mapping: Record<string, string> } {
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  const ctx: EncodeContext = {
    config,
    fieldPaths,
    state: createEncodeState(),
  };

  const encoded = deepEncode(obj, ctx);

  return { encoded, mapping: ctx.state.mapping };
}

/**
 * Utility function to decode a plain object (useful for manual decoding).
 *
 * @example
 * ```typescript
 * const decoded = decodeObject(
 *   { user_id: '«000»', summary: 'User «000» is active' },
 *   { '«000»': 'uuid-here' }
 * );
 * ```
 */
export function decodeObject<T>(obj: T, mapping: Record<string, string>): T {
  const countRef = { count: 0 };
  return deepDecode(obj, mapping, countRef);
}
