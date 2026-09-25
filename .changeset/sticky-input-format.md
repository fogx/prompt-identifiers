---
"prompt-identifiers": patch
---

A custom input format carrying the sticky flag finds every identifier instead of at most one. `encode` adds the global flag to a `RegExp` a caller passes, and a regex that is both sticky and global anchors each match where the last one ended, so `/user-\d{6}/y` encoded only a run starting at position 0 and usually nothing at all. The sticky flag now comes off for the same reason the global flag goes on: the pattern describes an identifier to find anywhere in the text, not a cursor into it. Every other flag is passed through untouched.
