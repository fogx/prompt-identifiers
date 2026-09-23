---
"prompt-identifiers": patch
---

`decode` rebuilds its pattern whenever the mapping's keys change. The pattern was cached against the mapping object alone, and `encode` adds to that same object, so a decode between two encode calls froze the pattern at the keys the mapping held then and every identifier minted afterwards came back as its raw placeholder. A caller who prunes a mapping met the same staleness from the other side: a key replaced by another one decoded to the literal string `undefined`. Encoding a whole conversation before decoding any of it was unaffected, which is what the AI SDK and BAML packages both do.
