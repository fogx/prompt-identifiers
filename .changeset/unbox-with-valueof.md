---
"prompt-identifiers-ai-sdk": patch
---

Unbox a wrapped primitive in a tool payload with `valueOf`. `Boolean(new Boolean(false))` is `true`, because the box is an object before it is a false, so a boxed `false` reached the model as `true`.
