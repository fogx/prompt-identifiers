---
"prompt-identifiers-ai-sdk": patch
---

Report an invented placeholder that spells a member of `Object.prototype`. The warning scan decided whether the model's token was one this call minted by reading it off the mapping, so under a format whose literals supply the letters, such as `{ template: '__prot{i:base62}__' }`, a token of `__proto__` found the inherited value, was taken for a minted placeholder, and its `unknown_placeholder` warning was dropped.
