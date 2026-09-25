---
"prompt-identifiers-baml": patch
---

Define each encoded key as an own property. A key of `__proto__`, which `JSON.parse` produces as an own key, reached the prototype setter instead: the field never went to the model and the encoded object got a new prototype. The decode half already defined its keys.
