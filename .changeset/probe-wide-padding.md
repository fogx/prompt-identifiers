---
"prompt-identifiers": patch
---

Read a format's fixed affixes from indices that no padding can make agree. `findPlaceholders` probed indices of at most nine digits, so a format padded wider, such as `ID{i:012}`, had its leading zeros read as part of the prefix and its pattern missed every placeholder whose index was long enough to use them.
