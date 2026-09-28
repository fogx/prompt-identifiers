---
"prompt-identifiers-baml": patch
---

Decode the text a failed generation carries. A BAML validation error holds the prompt the model was sent and the raw output it wrote back, so both are full of this call's placeholders, and the message quotes them. Only the NDJSON frame `toStreamable` writes was decoded, so the same failure reached a consumer with the identifiers restored or with `~000~` in their place depending on which door it came out of. All four other doors decode now: a rejecting call, a stream that dies mid-iteration, a rejecting `getFinalResponse` and the async-generator branch. The strings are written back onto the error itself, so a consumer testing `instanceof` still finds its class, and an error that cannot be written keeps the text it has rather than becoming a `TypeError`.
