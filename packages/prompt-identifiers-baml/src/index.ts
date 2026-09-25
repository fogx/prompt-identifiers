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
  /** Number of fields and keys whose placeholders were decoded */
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
   * Encode identifiers sitting in object keys, for an input keyed by identifier such as a BAML
   * `map<string, T>`. Off by default: nothing at runtime tells such a key from a class's own field
   * name, so a custom input format that matches a field name would rewrite the class's shape.
   * Ignored when `encodeFields` is given, because a field path names a value.
   */
  encodeKeys?: boolean;

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
   * Optional callback fired after decoding IDs in the output. A stream fires it once, where its
   * consumption ends: the end of the loop, or `getFinalResponse()` for a consumer that calls it
   * without iterating. Its counts cover the partials and the final together.
   * When debug is true, receives debugData with input, output, counts, and timing.
   */
  onDecode?: (result: { debugData?: DecodeDebugData }) => void;
}

/** A BAML function type (sync or async) */
export type BamlFunction<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/** What `b.stream.<Fn>(input)` returns: async iterable partials, final response on demand */
export interface BamlStream<TPartial, TFinal> extends AsyncIterable<TPartial> {
  getFinalResponse(): Promise<TFinal>;
}

/**
 * What the wrapper hands back. `toStreamable` is the Next.js path, and the wrapper always carries
 * one, including for a client old enough not to have had it.
 */
export interface WrappedBamlStream<TPartial, TFinal> extends BamlStream<TPartial, TFinal> {
  toStreamable(): ReadableStream<Uint8Array>;
}

/** A BAML streaming function type */
export type BamlStreamingFunction<TInput, TPartial, TFinal> = (
  input: TInput
) => AsyncGenerator<TPartial, TFinal, unknown>;

/** A streaming function as the generated BAML client writes it */
export type BamlStreamFunction<TInput, TPartial, TFinal> = (
  input: TInput
) => BamlStream<TPartial, TFinal>;

/**
 * Refuse a `prompt-identifiers` older than the one that writes an identifier back in the case it
 * was written in.
 *
 * A peer range is a warning rather than a wall, and every export this package uses exists on the
 * older versions too, so nothing fails to link and nothing reads undefined. What changed is
 * behaviour, so the probe is behavioural: an uppercase ULID that comes back lowercased is a core
 * that would hand the caller an identifier no case-sensitive lookup finds.
 */
function requireCurrentCore() {
  const probe = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const { mapping } = encode(probe, { inputFormat: "ULID", outputFormat: "SafeNumeric" });
  if (!Object.values(mapping).includes(probe)) {
    throw new Error(
      "prompt-identifiers-baml needs prompt-identifiers 0.2.0 or later. The installed copy " +
        "lowercases identifiers, so a ULID does not survive a round trip."
    );
  }
}

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
  encodeKeys: boolean;
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
    // A value is rebuildable from its own enumerable keys only when its state is in those keys. A
    // Date, a Map, a Set, a RegExp, a Promise, an Error and a typed array keep theirs in internal
    // slots that no rebuild can copy, and each of them says so through its own tag, whether or
    // not it also carries a field. A BAML media argument is a native handle with no tag and no
    // keys. Everything else is walked, prototype and all, so a class instance and a record built
    // with no prototype reach the function encoded and intact.
    if (
      Object.prototype.toString.call(value) !== "[object Object]" ||
      Object.keys(value).length === 0
    ) {
      return value;
    }

    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(value));

    for (const [key, val] of Object.entries(value)) {
      // A key is only a candidate when the caller says the object is keyed by identifier. Nothing
      // at runtime tells a map key from a class's own field name, and rewriting a field name calls
      // the BAML function with an object its class does not describe.
      const encodeThisKey = ctx.encodeKeys && ctx.fieldPaths === null;
      const encodedKey = encodeThisKey ? encode(key, ctx.config, ctx.state).encoded : key;
      // Two keys holding one identifier in different cases, or a key already shaped like the
      // placeholder, would otherwise leave one entry standing for both
      if (encodeThisKey && Object.prototype.hasOwnProperty.call(result, encodedKey)) {
        throw new Error(
          `Two keys encode to the same placeholder ${JSON.stringify(encodedKey)}, so one of them ` +
            `would be lost. Give the object one key per identifier, or choose an output format ` +
            `whose placeholders an ordinary key cannot spell.`
        );
      }
      // Defining the property keeps a key of `__proto__`, which JSON.parse produces as an own
      // key, off the prototype setter that would drop the field and reshape the object
      Object.defineProperty(result, encodedKey, {
        value: deepEncode(val, ctx, [...path, key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
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
    // The same rule the encode side walks by: a value the function returned that carries its own
    // tag holds state a rebuild cannot copy, a media handle has neither tag nor keys, and
    // anything else is rebuilt on its own prototype
    if (
      Object.prototype.toString.call(value) !== "[object Object]" ||
      Object.keys(value).length === 0
    ) {
      return value;
    }

    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(value));

    for (const [key, val] of Object.entries(value)) {
      // A model asked to group its answer puts an identifier in the key position, so a key
      // carries a placeholder as readily as a string does
      const decodedKey = decode(key, mapping);
      if (decodedKey !== key) {
        countRef.count++;
      }
      // Defining the property keeps a decoded key of `__proto__` off the prototype
      Object.defineProperty(result, decodedKey, {
        value: deepDecode(val, mapping, countRef),
        writable: true,
        enumerable: true,
        configurable: true,
      });
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
  requireCurrentCore();
  const { config, encodeFields, encodeKeys = false, onEncode, onDecode, debug } = options;

  // Pre-parse field paths if provided
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  return async (input: TInput): Promise<TOutput> => {
    // Encode input
    const ctx: EncodeContext = {
      config,
      fieldPaths,
      encodeKeys,
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
 * const stream = streamAnalysis({ user_id: '123e4567-e89b-42d3-a456-426655440000' });
 *
 * for await (const partial of stream) {
 *   console.log(partial); // IDs decoded in real-time
 * }
 *
 * const final = await stream.getFinalResponse();
 * ```
 */
export function wrapBamlStreamingFunction<TInput, TPartial, TFinal>(
  fn: BamlStreamFunction<TInput, TPartial, TFinal>,
  options: WrapBamlFunctionOptions
): (input: TInput) => WrappedBamlStream<TPartial, TFinal>;
export function wrapBamlStreamingFunction<TInput, TPartial, TFinal>(
  fn: BamlStreamingFunction<TInput, TPartial, TFinal>,
  options: WrapBamlFunctionOptions
): BamlStreamingFunction<TInput, TPartial, TFinal>;
export function wrapBamlStreamingFunction<TInput, TPartial, TFinal>(
  fn:
    BamlStreamFunction<TInput, TPartial, TFinal> | BamlStreamingFunction<TInput, TPartial, TFinal>,
  options: WrapBamlFunctionOptions
): (
  input: TInput
) => WrappedBamlStream<TPartial, TFinal> | AsyncGenerator<TPartial, TFinal, unknown> {
  requireCurrentCore();
  const { config, encodeFields, encodeKeys = false, onEncode, onDecode, debug } = options;

  // Pre-parse field paths if provided
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  function encodeInput(input: TInput) {
    const ctx: EncodeContext = {
      config,
      fieldPaths,
      encodeKeys,
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

    return { ctx, encodedInput };
  }

  return function (input: TInput) {
    const { ctx, encodedInput } = encodeInput(input);
    const source = fn(encodedInput);

    // A stream and a generator are both objects and neither is thenable. A consumer who puts a
    // step in front of the call hands back a promise, which would reach the generator branch and
    // die on the first iteration with the error this wrapper exists to stop
    if (
      source === null ||
      typeof source !== "object" ||
      typeof (source as { then?: unknown }).then === "function"
    ) {
      throw new TypeError(
        "wrapBamlStreamingFunction needs a function that returns the stream itself, as " +
          "`b.stream.<Fn>` does. A promise, or anything that is not a stream or an async " +
          "generator, cannot be decoded as it arrives."
      );
    }
    let totalDecoded = 0;
    const startDecode = debug ? performance.now() : 0;

    function decodePart<T>(value: T): T {
      const countRef = { count: 0 };
      const decoded = deepDecode(value, ctx.state.mapping, countRef);
      totalDecoded += countRef.count;
      return decoded;
    }

    function reportFinal(input: unknown, output: unknown) {
      onDecode?.({
        ...(debug && {
          debugData: {
            decodedCount: totalDecoded,
            input,
            output,
            durationMs: performance.now() - startDecode,
          },
        }),
      });
    }

    // The generated BAML client hands back a stream rather than a generator: it iterates, and its
    // final response is a separate call the consumer makes when it wants one
    if (isBamlStream<TPartial, TFinal>(source)) {
      const bamlSource = source;
      // The real stream memoises the task it drives, so asking it twice is one run. Decoding
      // twice would count the same placeholders twice and report the answer twice, so the
      // wrapper memoises its side as well
      let decodedFinal: Promise<TFinal> | undefined;
      function finalOnce() {
        decodedFinal ??= (async () => {
          const final = await bamlSource.getFinalResponse();
          const decoded = decodePart(final);
          reportFinal(final, decoded);
          return decoded;
        })();
        return decodedFinal;
      }

      const stream: WrappedBamlStream<TPartial, TFinal> = {
        async *[Symbol.asyncIterator](): AsyncGenerator<TPartial, void, unknown> {
          for await (const partial of bamlSource) {
            yield decodePart(partial);
          }
          // The generator branch reports where its loop ends, because that is where the final
          // value arrives. Here the final is a second call, and a consumer that only iterates
          // never makes it, so the end of the loop makes it once on their behalf. A final that
          // throws belongs to the consumer that asked for it, and this one did not
          await finalOnce().catch(() => {});
        },
        getFinalResponse: finalOnce,
        toStreamable(): ReadableStream<Uint8Array> {
          // Forwarding the source's own would serialise the partials and the final as the model
          // wrote them, placeholders and all, because it drives the stream it was defined on
          const encoder = new TextEncoder();
          const line = (message: unknown) => encoder.encode(JSON.stringify(message) + "\n");

          return new ReadableStream({
            async start(controller) {
              try {
                for await (const partial of stream) controller.enqueue(line({ partial }));
                controller.enqueue(line({ final: await stream.getFinalResponse() }));
              } catch (error) {
                // The last line the reader gets, the way the client writes it, except that the
                // message travels: a BamlError carries its text where JSON.stringify cannot see it
                controller.enqueue(
                  line({
                    error: {
                      type: "StreamError",
                      message:
                        error instanceof Error ? error.message : "Error in stream processing",
                      prompt: "",
                      raw_output: "",
                    },
                  })
                );
              }
              controller.close();
            },
          });
        },
      };

      return stream;
    }

    const generator = source;
    return (async function* (): AsyncGenerator<TPartial, TFinal, unknown> {
      // A consumer that breaks out of its loop, or throws inside it, returns this generator and
      // nothing else tells the wrapped one to stop, which would leave the stream open
      try {
        while (true) {
          const { value, done } = await generator.next();

          if (done) {
            const decodedValue = decodePart(value);
            reportFinal(value, decodedValue);
            return decodedValue;
          }

          yield decodePart(value);
        }
      } finally {
        await generator.return?.(undefined as TFinal);
      }
    })();
  };
}

function isBamlStream<TPartial, TFinal>(
  source: AsyncGenerator<TPartial, TFinal, unknown> | BamlStream<TPartial, TFinal>
): source is BamlStream<TPartial, TFinal> {
  return typeof (source as BamlStream<TPartial, TFinal>).getFinalResponse === "function";
}

/**
 * Utility function to encode a plain object (useful for manual encoding).
 *
 * `encodeKeys` encodes identifiers sitting in object keys, for an object keyed by identifier. It
 * is off by default because nothing at runtime tells such a key from a class's own field name, and
 * it is ignored when `encodeFields` is given, because a field path names a value.
 *
 * @example
 * ```typescript
 * const { encoded, mapping } = encodeObject(
 *   { user_id: '123e4567-e89b-42d3-a456-426655440000', data: { owner: '987fcdeb-51a2-43f7-8d9c-0123456789ab' } },
 *   { inputFormat: 'UUID', outputFormat: 'SafeNumeric' }
 * );
 * ```
 */
export function encodeObject<T>(
  obj: T,
  config: EncodeConfig,
  encodeFields?: string[],
  encodeKeys = false
): { encoded: T; mapping: Record<string, string> } {
  requireCurrentCore();
  const fieldPaths = encodeFields ? encodeFields.map(parseFieldPath) : null;

  const ctx: EncodeContext = {
    config,
    fieldPaths,
    encodeKeys,
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
 *   { user_id: '~000~', summary: 'User ~000~ is active' },
 *   { '~000~': '123e4567-e89b-42d3-a456-426655440000' }
 * );
 * ```
 */
export function decodeObject<T>(obj: T, mapping: Record<string, string>): T {
  const countRef = { count: 0 };
  return deepDecode(obj, mapping, countRef);
}
