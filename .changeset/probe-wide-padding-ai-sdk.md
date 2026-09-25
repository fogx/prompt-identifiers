---
"prompt-identifiers-ai-sdk": patch
---

Read a format's fixed affixes from several indices rather than two. A format padded wider than a probe, such as `ID{i:012}`, had its leading zeros read as a delimiter, so the `stripped_delimiter` warning reported a body shorter than the one the model wrote and missed the full one.
