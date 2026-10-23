---
"prompt-identifiers": patch
---

`decode` throws when the mapping carries an empty key. An empty key matches at every position, before the first character and after the last included, so it inserted its ID throughout the text: `decode("hello", { "": "X" })` returned `"XhXeXlXlXoX"`. `encode` already refuses to mint an empty placeholder, so a mapping that holds one was built by hand.
