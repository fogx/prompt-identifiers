---
"prompt-identifiers-baml": minor
---

Encode an identifier sitting in an object key when the caller asks for it with `encodeKeys: true`. A `map<string, T>` input keyed by identifier sent every id to the model in full, which is the one thing the package exists to prevent, while the decode side reads keys either way. It is off by default because nothing at runtime tells a map key from a class's own field name, so a custom input format matching a field name would rewrite the class's shape. Two keys that encode to one placeholder are refused rather than collapsed into one entry. With it on, the object the wrapped function is called with has different keys from the one the caller passed.
