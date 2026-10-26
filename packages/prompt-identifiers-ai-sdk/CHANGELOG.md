# prompt-identifiers-ai-sdk

## 0.4.0

### Minor Changes

- 7e0c6f0: Restore identifiers in the result of a tool the provider ran itself. A provider-executed tool (web search, a code interpreter, an MCP server the provider calls) receives the encoded arguments and echoes the placeholders back in its result, which reached the caller raw on both the generated and the streamed path. The result is now walked and decoded in its keys as well as its strings, and the decode warning scan reads it under a new `tool_result` source.
- 201562b: Add a single `instruction` option, and append it on every call rather than only on calls whose prompt carried an ID.

  Injecting only when an ID appeared changed the system message mid-conversation, which costs a full prompt-cache rewrite of the system block at the provider. It goes in on every call now. Every `{format}` in the text is replaced with an example placeholder when the middleware is built, not on each call.

  `instruction` takes the text you want, or `false` to send none and leave the system message alone. Omitted, it is the text the package shipped before, so a caller who set nothing keeps the instruction they were getting.

  `injectInstruction` and `customInstruction` still work and are deprecated. `injectInstruction: false` sends none, `customInstruction` supplies the text, and `instruction` wins over both where they are given together. An instruction is ignored under the `Passthrough` output format, which encodes nothing.

- 430f260: The middleware reports an `unknown_placeholder` decode warning for each placeholder in the output that is not in the mapping, in text and in tool call arguments. Until now, an invented placeholder such as `~053~` leaked into the output without any warning. Every warning from a tool call now also carries the `toolName`, so a `stripped_delimiter` or `unknown_placeholder` points at the tool that received it. `prompt-identifiers-ai-sdk` now needs `prompt-identifiers` 0.2.0 or later, which a `^0.1.x` range does not accept, so a consumer holding one has to widen it.

### Patch Changes

- b659e04: Encode the reason a caller gave for approving or denying a provider-run tool. A `tool-approval-response` part carries the user's own words about whatever the tool was about to act on, and they reached the model with every identifier in them spelled out. The sibling `execution-denied` output carries the same field and was already encoded. The `approvalId` is untouched, because it is what matches the response to the request the provider issued.
- 7e0c6f0: Escape an identifier written back into tool call input. Tool input is serialised JSON rewritten as text rather than parsed, so an identifier carrying a quote, a backslash or a control character, which a custom input format can match, left the SDK unable to parse the arguments the tool was called with. Identifiers a built-in format matches are unaffected.
- 7e0c6f0: Escape an identifier written back into streamed tool input as well. The assembled `tool-call` chunk was escaped and the `tool-input-delta` chunks of the same answer were not, so a consumer reading partial tool input got text `JSON.parse` rejects while the value the tool was finally called with parsed cleanly.
- 7583cba: Serialise a tool payload the way the provider will. A `toJSON` now speaks for its slot once: what it returns is walked as it stands, a boxed string or number it returns is unwrapped, and a function it leaves on the result is dropped rather than handed to the provider, which would otherwise call it after encoding and write an identifier the encoder never saw.
- 7583cba: Identifiers in a tool call's arguments and in a JSON tool result are found wherever they sit. Both payloads were serialised, encoded as one string, then parsed back, which ran the identifier patterns over JSON's own escapes. `JSON.stringify` writes a newline as a backslash and an `n`, and both patterns open on a word boundary, so an identifier written straight after a newline, tab, carriage return, form feed or vertical tab was never matched and travelled to the model uncompressed with no warning. A newline-separated list of five identifiers in a JSON tool result compressed one of them; the same string in a text part compressed all five.

  Encoding now walks the payload and encodes each string it carries, keys included, in the form the provider will serialise. `JSON.stringify` asks a value for its JSON form before writing it, so a `Date` is encoded as the string it becomes and an identifier returned by a `toJSON` method is encoded rather than reaching the model untouched. A payload that refers to itself reports a circular structure instead of exhausting the stack.

  An output format whose placeholder carries a double quote, a backslash or a control character is refused when the middleware is built, naming the character. A tool payload reaches the model as JSON and comes back as JSON text the decoder reads without parsing it, so a placeholder JSON has to escape is written one way and read another. `{ template: '"{i:03}"' }` used to throw a bare `SyntaxError` out of `transformParams`, and `\u004{i:03}` minted the key `@00`, which JSON read as `@` followed by `00`, so the model was sent `@00` and the identifier was neither in the prompt nor recoverable from the mapping. Every built-in format is unaffected.

  A custom input format written to match JSON's own syntax rather than an identifier no longer matches. A `RegExp` such as `/true/`, `/null/`, `/","/` or `/\\n/` used to match the serialised document and replace part of it, which turned a boolean into a string, renamed a key, destroyed a real newline or merged two array elements into one. Those replacements corrupted the payload every time they succeeded, and an input format describes an identifier, not the document that carries it.

- c049b8f: Keep a placeholder that spells a member of `Object.prototype`. An output format is free to write one, and `{ template: '__prot{i:base62}__' }` writes `__proto__` at index 50, where assigning it into the mapping reached the inherited setter instead of adding a key: the identifier left for the model with nothing to bring it back, and the model echoing it was reported as an invention it never made. The mapping and the escaped copy the tool input decoder reads both define their entries now.
- c049b8f: Refuse a placeholder JSON would rewrite. A tool payload reaches the model as JSON and comes back as JSON text the decoder scans without parsing, so a placeholder carrying a quote, a backslash, a control character or a surrogate standing on its own is written one way and read another, and the identifier never comes back. The guard asked the format for index 0 alone, so a format unsafe anywhere else was accepted and lost an identifier out of a tool call's arguments. It now reads the same spread of indices the affixes are derived from, which catches a format unsafe wherever it is read before any call is made, and every placeholder is checked again as it is minted, which catches the rest: indices are minted densely from zero, and no fixed set of probes covers a lookup table that is safe at zero and unsafe at one. A formatter that refuses a high index is still accepted.
- 7e0c6f0: Refuse a `prompt-identifiers` too old to serve the middleware, where the middleware is built. A peer range is a warning rather than a wall, and a CJS `require` of a core without `findPlaceholders` reads it as `undefined` instead of failing to link, so a consumer with no `onDecode` listener ran a whole billed turn on a core that lowercases every identifier.
- 3c7136c: Refuse two tool payload keys that encode to one placeholder. One identifier written in two cases, or a key already spelled like a placeholder the call mints, left a single entry standing for both and lost the other silently. A call whose payload holds such a pair now throws where it used to complete, which under `Numeric` or `IdToken` reaches an ordinary key spelled like a bare index, since their placeholders are bare tokens. An encoded key is defined rather than assigned, so a payload key named `__proto__`, which is what `JSON.parse` produces, stays an own key instead of replacing the payload's prototype.
- 3c7136c: Refuse two tool result keys that decode to one identifier, the mirror of the refusal the encode half already carries. A provider-run tool that returns a placeholder this call minted alongside the identifier it stands for had one of the two entries dropped from the result the caller was handed, with nothing said. A decoded key is defined rather than assigned, so a decoded `__proto__` stays an own key.
- 3c7136c: Report an invented placeholder that spells a member of `Object.prototype`. The warning scan decided whether the model's token was one this call minted by reading it off the mapping, so under a format whose literals supply the letters, such as `{ template: '__prot{i:base62}__' }`, a token of `__proto__` found the inherited value, was taken for a minted placeholder, and its `unknown_placeholder` warning was dropped.
- c049b8f: Match a placeholder body rather than compile it. The stripped-delimiter scan built its pattern from the body the format writes, so a formatter that writes its index twice around a literal, such as one returning `id(0)-0`, threw a `SyntaxError` out of `wrapGenerate` after the turn was paid for, and one writing a `.` widened the pattern into a warning about ordinary text.
- 7e0c6f0: Scan the last result of each provider-run tool call rather than every preview frame. A preliminary result is replaced by the next one for the same call, so scanning all of them reported one warning per frame, and skipping them lost the warning entirely when a stream died before its final result arrived.
- 7e0c6f0: Serialise a provider-run tool result only when a listener will read it. A web search or a code interpreter returns whole documents, and the string was built on every response to feed a decode warning scan that does not run without `onDecode`.
- 7583cba: Each streaming text and reasoning block gets its own buffer, keyed by the id the provider sends, the way tool inputs already did. One buffer was shared across every text block, so a provider running two at once fed one block's text into the other's held tail: a placeholder split across one block's chunks came back raw, with the other block's text spliced into the middle of it. A tail held when a block ends is now flushed onto that block rather than onto whichever block spoke last.

  A tool input whose `tool-input-start` never arrived is buffered instead of decoded chunk by chunk, so a placeholder split across its deltas no longer reaches the caller raw. A repeated `tool-input-start` for the same id keeps the buffer it already had rather than replacing it and dropping what it held.

  The decode warning scan only runs when an `onDecode` callback is registered to receive it. It masks every ID across the whole answer, which is the dominant cost of a large response, and nothing could read the result.

  A mapping above roughly 120,000 placeholders no longer throws `RangeError: Maximum call stack size exceeded` when a stream starts. The longest placeholder was measured by spreading every length into `Math.max`.

- 7583cba: The streaming buffer holds back a chunk tail that could still grow into one of this call's placeholders, instead of deriving delimiters from the first placeholder and assuming the body is digits. A placeholder split across chunks now decodes whatever the output format writes, so `{ template: '[{i:base62}]' }` no longer delivers `[A]` verbatim, a formatter function returning letters works the same way, and `Numeric` and `IdToken` reassemble a split placeholder instead of passing it through.

  A whole match can go back into the buffer, since it may still grow into a longer placeholder, so a format whose placeholder widths jump (`Numeric` past 1000 ids, `ID1` against `ID11`) decodes the one the model wrote rather than the shorter one inside it. A tail never starts partway through a match, so an ID the buffer just restored is not read back as the start of another one. That holds for a placeholder sitting inside another one at an offset, which a custom formatter can produce: streaming `XABY` against the set `{AB, XABY}` used to restore the ID of `AB` and a stray `X`.

  A streaming tool input whose buffer still holds a tail gets it back on the closing `finish` chunk, not only on `tool-input-end`. A provider that ends a stream without the per-block end chunk used to drop it, while an identically shaped text stream kept it.

- c049b8f: Report `debugData.durationMs` on a stream as the time spent decoding rather than the generation's wall clock. It stamped the clock at the first text delta and stopped at the report, so it carried the model's latency: 93ms measured against the 0.1ms the generated path reports for the same decode.
- 7583cba: `onDecode` fires once for a stream that errors or is cancelled, carrying the text decoded up to that point and the warnings found in it. A dying stream reported nothing, so a partial answer's `unknown_placeholder` and `stripped_delimiter` warnings went with it. A stream that ends normally still reports exactly once.

  `debugData.decodedCount` on the streamed path counts the placeholder occurrences in the encoded text, the way the generated path always did. It reported the size of the mapping instead, so a call holding five identifiers reported five whatever the answer contained.

- 7583cba: The `stripped_delimiter` warning works for every delimited output format, not only those whose placeholder is one run of digits between two literals. The bare index was extracted with a pattern that required the whole placeholder to be `<non-digits><digits><non-digits>`, so `v1_{i:03}`, `ID2_{i:03}`, `{i:03}_v2` and `<1:{i:03}:2>` produced no index at all and the check was silently inert for them while both READMEs documented the warning without qualification. The format's fixed prefix and suffix are now read off the format itself, by writing two placeholders far apart and keeping what they share at each end, so a literal carrying its own digits still contributes nothing and the body between the affixes is found wherever it sits. `Numeric` and `IdToken` have nothing fixed at either end and still report nothing, which is what the docs already say about them.
- 7e0c6f0: Read a template's affixes from the template rather than probing it, so the `stripped_delimiter` warning reports the whole body at any pad width. A formatter function is probed at four spread indices rather than two.
- 7e0c6f0: Handle the shapes a provider-executed tool result arrives in. A part carrying `result` as an explicit `undefined` crashed the decode warning scan on both paths; a preliminary result and the final one replacing it reported the same anomaly once per preview frame; and a result that references itself exhausted the stack instead of naming the payload, which its encode-side sibling has always done.
- 7583cba: An answer the model did not finish no longer reports its last placeholder as one the model invented. Under a format that opens a placeholder without closing it, such as `{ template: 'ID_{i:04}' }`, the cut lands mid-token and leaves `ID_000`. Nothing closes a placeholder in that format, so the scan reads the shortened digit run as a whole one and `unknown_placeholder` fired on every truncated answer, even though the format never writes a body that short. A token is now left alone when the model was stopped partway through, which means a finish reason of `length`, `content-filter` or `error`, a stream that was cancelled, or a stream that ended without reporting one at all, and a placeholder this call actually minted starts with it, which is what a cut leaves behind. A generated result missing its finish reason is read as complete rather than cut, because `doGenerate` returning at all means the answer finished; only a stream can end without saying so. Position is not part of the test, because an answer carrying several content blocks has one half-written placeholder per block. A token that starts none of them, such as an invented `ID_9999`, is still reported, and a format that closes its placeholders is unaffected either way because half of one is not a placeholder at all.

  An example placeholder carrying `$` reaches the instruction intact. `{format}` was substituted with a string replacement, which reads `$$` as an escape, so `{ template: '$${i:03}$$' }` told the model to expect `$000$` while the prompt carried `$$000$$`.

- 7e0c6f0: Unbox a wrapped primitive in a tool payload with `valueOf`. `Boolean(new Boolean(false))` is `true`, because the box is an object before it is a false, so a boxed `false` reached the model as `true`.

## 0.3.0

### Minor Changes

- 9e00ea1: **Breaking:** Support AI SDK v7. The middleware now implements `LanguageModelV4Middleware` (`specificationVersion: "v4"`) and requires `ai@>=7` and `@ai-sdk/provider@>=4`. Stay on 0.2.x for AI SDK v6.

### Patch Changes

- 0c71cae: The middleware was walking past several V4 content shapes. It now encodes inline text carried by a file part and the `error-text`, `error-json`, `content` and `execution-denied` tool result outputs, and decodes reasoning text on the way back out of both generate and stream results. Streaming also holds together better: the buffered tail is emitted while the text block is still open rather than after the stream has finished, where the AI SDK dropped it from the assembled message; a streaming tool input buffers the way the text stream does, so a placeholder split across two deltas no longer arrives raw; and a clean decode with a non-delimited output format no longer reports a surviving placeholder that is really just part of the restored UUID.
- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.

## 0.2.0

### Minor Changes

- Add instruction injection to prevent LLMs from stripping delimiter characters in tool call arguments. The middleware now appends a format-preservation instruction to the system message by default. Added decode warnings to detect stripped delimiters and surviving placeholders.

### Patch Changes

- Updated dependencies
  - prompt-identifiers@0.1.3

## 0.1.2

### Patch Changes

- Fix cross-message placeholder consistency — same UUID now always gets the same placeholder across all messages in a prompt
- Fix streaming decoder for overlapping delimiters (e.g. `~ID000~` where CLOSE `~` is a prefix of OPEN `~ID`)
- Encode tool-call args (`ToolCallPart.input`) in prompt messages — prevents LLM from seeing raw UUIDs alongside placeholders in agentic flows
- Add `output` and `mapping` fields to `onDecode` callback (always available, not just in debug mode)
- **Breaking:** `onDecode` callback now receives `{ output, mapping, debugData? }` instead of `{ debugData? }`
- Refactor encoding internals to use core's `EncodeState`, remove `mergeMapping()` helper
- Updated dependencies
  - prompt-identifiers@0.1.2
