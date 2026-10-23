---
"prompt-identifiers": minor
---

Write an identifier back in the case it was written in. `encode` stored every match lowercased, so a ULID, whose Crockford base32 alphabet is upper case, came back from `decode` in a form that misses a case-sensitive lookup, and no round trip of an uppercase identifier returned its input. Deduplication still ignores case, so one identifier written two ways is still one placeholder, and the casing of its first occurrence is what `decode` writes. A reverse map built from `Object.values(mapping)` has to lowercase its key on the way in rather than on the way out.
