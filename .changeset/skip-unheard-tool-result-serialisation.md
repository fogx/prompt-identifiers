---
"prompt-identifiers-ai-sdk": patch
---

Serialise a provider-run tool result only when a listener will read it. A web search or a code interpreter returns whole documents, and the string was built on every response to feed a decode warning scan that does not run without `onDecode`.
