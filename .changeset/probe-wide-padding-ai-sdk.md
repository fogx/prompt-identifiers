---
"prompt-identifiers-ai-sdk": patch
---

Read a format's fixed affixes from four spread indices rather than two. A format padded wider than a probe, such as `ID{i:012}`, had its leading zeros read as a delimiter, so the `stripped_delimiter` warning reported a body shorter than the one the model wrote. The widest probe is 16 digits, so a pad wider than that still keeps some of its padding in the prefix.
