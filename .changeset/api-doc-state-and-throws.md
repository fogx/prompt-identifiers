---
"prompt-identifiers": patch
---

Bring the published API reference up to the code. It now carries `createEncodeState` and `EncodeState`, `encode`'s `state` parameter, and the three refusals the library makes: an input format that matches the empty string, an output format that returns an empty placeholder, and a mapping with an empty key.
