---
"prompt-identifiers-baml": patch
---

Refuse two keys that decode to one identifier, the mirror of the refusal the encode half already carries. A model asked to group its answer can hand back the identifier in one key and the placeholder it was given in another, and one of the two values was dropped with nothing said. `decodeObject` is a public export, so the message names the identifier the caller has to fix.
