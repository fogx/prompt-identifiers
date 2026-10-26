# prompt-identifiers

## 0.2.0

### Minor Changes

- 7e0c6f0: Write an identifier back in the case it was written in. `encode` stored every match lowercased, so a ULID, whose Crockford base32 alphabet is upper case, came back from `decode` in a form that misses a case-sensitive lookup, and no round trip of an uppercase identifier returned its input. Deduplication still ignores case, so one identifier written two ways is still one placeholder, and the casing of its first occurrence is what `decode` writes. A reverse map built from `Object.values(mapping)` has to lowercase its key on the way in rather than on the way out.

### Patch Changes

- 7e0c6f0: Bring the published API reference up to the code. It now carries `createEncodeState` and `EncodeState`, `encode`'s `state` parameter, and the three refusals the library makes: an input format that matches the empty string, an output format that returns an empty placeholder, and a mapping with an empty key.
- 7583cba: `decode` rebuilds its pattern whenever the mapping's keys change. The pattern was cached against the mapping object alone, and `encode` adds to that same object, so a decode between two encode calls froze the pattern at the keys the mapping held then and every identifier minted afterwards came back as its raw placeholder. A caller who prunes a mapping met the same staleness from the other side: a key replaced by another one decoded to the literal string `undefined`. Encoding a whole conversation before decoding any of it was unaffected, which is what the AI SDK and BAML packages both do.
- 7e0c6f0: Say in the docs what `findPlaceholders` can read. A template is read for the literals around its index, so its affixes are exact at any pad width, while a formatter function is probed at four indices and one padded wider than sixteen digits counts its own leading zeros into the prefix. It then finds a token that starts with that padding and misses one whose index is long enough not to. The two spellings of one format were documented as equivalent.
- 7e0c6f0: Keep `findPlaceholders` total for a caller with no types. A format that is `null`, a number, a boolean, an object whose `template` is not a string, or an object whose `template` accessor throws, threw out of a function whose contract is to answer which tokens look like placeholders, where it should report the format as shapeless and return an empty list.
- 63479e8: `findPlaceholders(text, format)` returns the tokens in a text that carry an output format's delimiters, so a caller can tell which ones the model invented. A body the format would have written differently counts too, since `~5~` where it pads to `~005~` is one of the ways a model invents an identifier. It returns nothing for `Numeric`, `IdToken` and `Passthrough`, whose placeholders look like ordinary text. A format whose delimiters occur in ordinary text, such as a bracket template against a markdown link, still matches text that was never a placeholder, and counting an unpadded body widens that: a `-{i}-` template reports `-01-` out of the date `2024-01-15`.
- c049b8f: Keep a placeholder that spells a member of `Object.prototype`. An output format is free to write one, and `{ template: '__prot{i:base62}__' }` writes `__proto__` at index 50, where assigning it into the mapping reached the inherited setter instead of adding a key: the identifier left for the model with nothing to bring it back, and the model echoing it was reported as an invention it never made. The mapping and the escaped copy the tool input decoder reads both define their entries now.
- 7e0c6f0: Refuse an input format that can match the empty string. `/\d*/g` matches between every pair of characters, so `encode` minted a placeholder standing for nothing and wrote it into every gap in the prompt. The round trip still succeeded, which left the token bill as the only symptom.
- 7583cba: `decode` throws when the mapping carries an empty key. An empty key matches at every position, before the first character and after the last included, so it inserted its ID throughout the text: `decode("hello", { "": "X" })` returned `"XhXeXlXlXoX"`. `encode` already refuses to mint an empty placeholder, so a mapping that holds one was built by hand.
- 7583cba: `encode` throws when an output format returns an empty string or a non-string for an index, naming the index. A lookup-table formatter that runs out of entries used to drop the ID out of the prompt and put a mapping key in that matches at every position, which decoded a whole answer into repeated IDs and hung the AI SDK middleware's streaming decoder with no error.

  A formatter returning a number now throws too. It used to be coerced, so `(i) => i` encoded to bare digits that matched inside every restored ID. `FormatterFn` has always been typed to return a string.

- 7583cba: A custom input format carrying the sticky flag finds every identifier instead of at most one. `encode` adds the global flag to a `RegExp` a caller passes, and a regex that is both sticky and global anchors each match where the last one ended, so `/user-\d{6}/y` encoded only a run starting at position 0 and usually nothing at all. The sticky flag now comes off for the same reason the global flag goes on: the pattern describes an identifier to find anywhere in the text, not a cursor into it. Every other flag is passed through untouched.
- 7e0c6f0: Read a template's affixes from the template. It says where its index sits, so its literals are the prefix and suffix exactly, at any pad width, and no probe has to outgrow the padding. A bare formatter function is still probed, because nothing can be read off it. A formatter function is probed at four spread indices rather than three, so a padded one has to be wider than sixteen digits before its padding is read as an affix.

## 0.1.4

### Patch Changes

- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.
- 9e00ea1: Build with tsdown instead of tsup. The CommonJS entry is now `dist/index.cjs` with types in `dist/index.d.cts`, and `main`, `types` and the `require` export point at them. Imports of the package root are unchanged.

## 0.1.3

### Patch Changes

- Add instruction injection to prevent LLMs from stripping delimiter characters in tool call arguments. The middleware now appends a format-preservation instruction to the system message by default. Added decode warnings to detect stripped delimiters and surviving placeholders.

## 0.1.2

### Patch Changes

- Add `EncodeState` interface and `createEncodeState()` for shared placeholder assignment across multiple `encode()` calls
- Add optional `state` parameter to `encode()` for cross-call consistency
