---
"prompt-identifiers-baml": minor
---

Encode an identifier sitting in an object key. A `map<string, T>` input keyed by identifier sent every id to the model in full, which is the one thing the package exists to prevent, while the decode side had already learned to read keys. Keys are encoded in auto-detect mode and share a placeholder with the same identifier in a value. An explicit `encodeFields` leaves keys alone, because a field path names a value.
