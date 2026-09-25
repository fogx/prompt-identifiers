---
"prompt-identifiers-baml": minor
---

Wrap what the generated BAML client actually returns. `b.stream.<Fn>(input)` hands back a `BamlStream`, which is async iterable and delivers its final value through `getFinalResponse()`, not an `AsyncGenerator`, so `wrapBamlStreamingFunction` threw `generator.next is not a function` on the first iteration of the documented example. It now accepts either shape and mirrors it back, including `toStreamable()`, which writes the same newline-delimited JSON over the decoded partials and the decoded final. `getFinalResponse()` decodes once however often it is called, and `onDecode` fires once for a consumer that only iterates, where before it fired only for one that asked for the final.
