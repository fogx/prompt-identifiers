---
"prompt-identifiers-baml": minor
---

Wrap what the generated BAML client actually returns. `b.stream.<Fn>(input)` hands back a `BamlStream`, which is async iterable and delivers its final value through `getFinalResponse()`, not an `AsyncGenerator`, so `wrapBamlStreamingFunction` threw `generator.next is not a function` on the first iteration of the documented example. It now accepts either shape and mirrors it back, so the call site is the same as unwrapped BAML.
