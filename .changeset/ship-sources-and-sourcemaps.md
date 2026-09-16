---
"prompt-identifiers": patch
"prompt-identifiers-ai-sdk": patch
"prompt-identifiers-baml": patch
---

Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.
