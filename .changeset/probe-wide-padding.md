---
"prompt-identifiers": patch
---

Read a format's fixed affixes from four spread indices rather than three. `findPlaceholders` probed indices of at most nine digits, so a format padded wider, such as `ID{i:012}`, had its leading zeros read as part of the prefix and its pattern missed every placeholder whose index was long enough to use them. The widest probe is 16 digits, so a pad wider than that still keeps some of its padding in the prefix.
