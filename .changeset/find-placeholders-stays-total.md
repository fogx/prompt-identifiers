---
"prompt-identifiers": patch
---

Keep `findPlaceholders` total for a caller with no types. A format whose `template` is not a string threw out of a function whose contract is to answer which tokens look like placeholders, where it used to report the format as shapeless and return an empty list.
