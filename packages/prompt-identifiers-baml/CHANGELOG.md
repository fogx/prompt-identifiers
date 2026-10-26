# prompt-identifiers-baml

## 0.2.0

### Minor Changes

- 7e0c6f0: Encode an identifier sitting in an object key when the caller asks for it with `encodeKeys: true`. A `map<string, T>` input keyed by identifier sent every id to the model in full, which is the one thing the package exists to prevent, while the decode side reads keys either way. It is off by default because nothing at runtime tells a map key from a class's own field name, so a custom input format matching a field name would rewrite the class's shape. Two keys that encode to one placeholder are refused rather than collapsed into one entry. With it on, the object the wrapped function is called with has different keys from the one the caller passed.
- 7e0c6f0: Decode a placeholder sitting in an object key. This changes the shape of a returned object: a key that used to arrive as a placeholder now arrives as the identifier. A model asked to group its answer by identifier returns a `map<string, T>` whose keys are placeholders, and `deepDecode` walked only values, so those keys came back raw while a sibling text field decoded. Keys are now decoded too, counted in the debug total, and defined as own properties so a decoded `__proto__` cannot reach the prototype.

  Close the wrapped generator when a consumer stops reading. Breaking out of a `for await` over `wrapBamlStreamingFunction`, or throwing inside it, left the underlying BAML stream open.

- 3c7136c: Walk a value only when its state is in its own enumerable keys. Every object was rebuilt from its entries, so a BAML media argument, which is a native handle with no own enumerable keys, arrived as `{}` and the runtime refused the call with `Invalid media source`. A `Date`, a `Map`, a `Set`, a `RegExp`, a `Promise` and an `Error` were flattened the same way, and so was any of them carrying an own field, which came back with its prototype and none of its state. All of them are now handed through by identity, on the way out and on the way back, recognised by their own `Object.prototype.toString` tag, as is a typed array. Anything else is walked and rebuilt on its own prototype, so the identifiers in a class instance or in a record built with no prototype are encoded and its methods and its type survive.
- 3c7136c: Wrap what the generated BAML client actually returns. `b.stream.<Fn>(input)` hands back a `BamlStream`, which is async iterable and delivers its final value through `getFinalResponse()`, not an `AsyncGenerator`, so `wrapBamlStreamingFunction` threw `generator.next is not a function` on the first iteration of the documented example. It now accepts either shape and mirrors it back, including `toStreamable()`, which writes the same newline-delimited JSON over the decoded partials and the decoded final. `getFinalResponse()` decodes once however often it is called, and `onDecode` fires once for a consumer that only iterates, where before it fired only for one that asked for the final. A wrapped function that returns anything other than a stream or an async generator, such as an `async` wrapper handing back a promise, is refused where the call is made rather than on the first iteration.

### Patch Changes

- 7e0c6f0: Raise the `prompt-identifiers` peer floor to 0.2.0, the version that writes an identifier back in the case it was written in. Below it a ULID returned by a wrapped function comes back lowercased.
- 7e0c6f0: Define each encoded key as an own property. A key of `__proto__`, which `JSON.parse` produces as an own key, reached the prototype setter instead: the field never went to the model and the encoded object got a new prototype. The decode half already defined its keys.
- 7e0c6f0: Use real UUIDs in the `encodeObject`, `decodeObject` and streaming examples. The placeholders and mapping they showed cannot come from the inputs they showed, because "uuid-here" is not a UUID and nothing encodes it.
- 3c7136c: Refuse a `prompt-identifiers` older than 0.2.0 where the wrapper is built. Every export this package uses exists on the older versions, so nothing failed to link and nothing read `undefined`, and a consumer whose peer range went unmet ran a whole call on a core that hands back a lowercased ULID. The probe is behavioural, since the change that matters is behaviour rather than an export.
- c049b8f: Decode the text a failed generation carries. A BAML validation error holds the prompt the model was sent and the raw output it wrote back, so both are full of this call's placeholders, and the message quotes them. Only the NDJSON frame `toStreamable` writes was decoded, so the same failure reached a consumer with the identifiers restored or with `~000~` in their place depending on which door it came out of. All four other doors decode now: a rejecting call, a stream that dies mid-iteration, a rejecting `getFinalResponse` and the async-generator branch. The strings are written back onto the error itself, so a consumer testing `instanceof` still finds its class, and an error that cannot be written keeps the text it has rather than becoming a `TypeError`.
- c049b8f: Name a value that refers back to itself. The walk had no cycle guard on either half, so an ORM entity with a parent backreference, which is walked since class instances started being walked, died with `RangeError: Maximum call stack size exceeded` and nothing said which payload it came from. Both halves now throw a `TypeError` naming the BAML argument or the BAML answer, the way the ai-sdk package already does for a tool payload and a tool result, and both guard the array walk as well as the object walk, so a cycle that closes through an array is named too. The same value reachable under two keys is not a cycle and still encodes and decodes as it did.
- 3c7136c: Refuse two keys that decode to one identifier, the mirror of the refusal the encode half already carries. A model asked to group its answer can hand back the identifier in one key and the placeholder it was given in another, and one of the two values was dropped with nothing said. `decodeObject` is a public export, so the message names the identifier the caller has to fix.
- 7e0c6f0: Refuse a key collision whichever key caused it. The check skipped a key that encodes to itself, so an object holding both an identifier and that identifier's own placeholder as keys still lost one of them, while the same pair in the other order was refused.
- 3c7136c: Report a generation that dies part way through. The BAML client raises a validation error, a timeout and an abort from inside its own iterator, and a consumer already holding decoded partials was told nothing at all, on both return shapes. `onDecode` now fires where the consumption that finishes first ends, including the error that ends it, and a consumer that breaks out of its loop early is still not reported to. `durationMs` on a stream is the decode time summed over the partials rather than the wall clock around them, which carried the model's latency and read about 1400 times too high.
- c049b8f: Let the consumer that is reading the partials answer for a stream whose final rejects. Asking for the final before the loop and awaiting it after is an ordinary shape, and the rejection landing mid-loop took the report with nothing to say, so the partials the consumer had already read went uncounted.

## 0.1.3

### Patch Changes

- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.
- 9e00ea1: Build with tsdown instead of tsup. The CommonJS entry is now `dist/index.cjs` with types in `dist/index.d.cts`, and `main`, `types` and the `require` export point at them. Imports of the package root are unchanged.

## 0.1.2

### Patch Changes

- Refactor to use core's `encode()` + `EncodeState` instead of duplicated internal encoding logic (~100 lines removed)
- Updated dependencies
  - prompt-identifiers@0.1.2
