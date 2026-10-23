---
"prompt-identifiers": patch
---

`encode` throws when an output format returns an empty string or a non-string for an index, naming the index. A lookup-table formatter that runs out of entries used to drop the ID out of the prompt and put a mapping key in that matches at every position, which decoded a whole answer into repeated IDs and hung the AI SDK middleware's streaming decoder with no error.

A formatter returning a number now throws too. It used to be coerced, so `(i) => i` encoded to bare digits that matched inside every restored ID. `FormatterFn` has always been typed to return a string.
