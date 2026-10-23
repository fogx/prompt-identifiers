---
"prompt-identifiers-baml": patch
---

Use real UUIDs in the `encodeObject`, `decodeObject` and streaming examples. The placeholders and mapping they showed cannot come from the inputs they showed, because "uuid-here" is not a UUID and nothing encodes it.
