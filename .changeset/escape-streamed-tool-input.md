---
"prompt-identifiers-ai-sdk": patch
---

Escape an identifier written back into streamed tool input as well. The assembled `tool-call` chunk was escaped and the `tool-input-delta` chunks of the same answer were not, so a consumer reading partial tool input got text `JSON.parse` rejects while the value the tool was finally called with parsed cleanly.
