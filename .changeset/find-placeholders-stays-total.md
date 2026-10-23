---
"prompt-identifiers": patch
---

Keep `findPlaceholders` total for a caller with no types. A format that is `null`, a number, a boolean, an object whose `template` is not a string, or an object whose `template` accessor throws, threw out of a function whose contract is to answer which tokens look like placeholders, where it should report the format as shapeless and return an empty list.
