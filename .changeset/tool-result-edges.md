---
"prompt-identifiers-ai-sdk": patch
---

Handle the shapes a provider-executed tool result arrives in. A part carrying `result` as an explicit `undefined` crashed the decode warning scan on both paths; a preliminary result and the final one replacing it reported the same anomaly once per preview frame; and a result that references itself exhausted the stack instead of naming the payload, which its encode-side sibling has always done.
