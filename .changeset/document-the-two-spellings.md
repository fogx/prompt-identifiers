---
"prompt-identifiers": patch
---

Say in the docs what `findPlaceholders` can read. A template is read for the literals around its index, so its affixes are exact at any pad width, while a formatter function is probed at four indices and one padded wider than sixteen digits counts its own leading zeros into the prefix. It then finds a token that starts with that padding and misses one whose index is long enough not to. The two spellings of one format were documented as equivalent.
