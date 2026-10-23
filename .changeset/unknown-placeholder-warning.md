---
"prompt-identifiers-ai-sdk": minor
---

The middleware reports an `unknown_placeholder` decode warning for each placeholder in the output that is not in the mapping, in text and in tool call arguments. Until now, an invented placeholder such as `~053~` leaked into the output without any warning. Every warning from a tool call now also carries the `toolName`, so a `stripped_delimiter` or `unknown_placeholder` points at the tool that received it. `prompt-identifiers-ai-sdk` now needs `prompt-identifiers` 0.2.0 or later, which a `^0.1.x` range does not accept, so a consumer holding one has to widen it.
