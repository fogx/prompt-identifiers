---
"prompt-identifiers": patch
---

`findPlaceholders(text, format)` returns the tokens in a text that carry an output format's delimiters, so a caller can tell which ones the model invented. A body the format would have written differently counts too, since `~5~` where it pads to `~005~` is one of the ways a model invents an identifier. It returns nothing for `Numeric`, `IdToken` and `Passthrough`, whose placeholders look like ordinary text. A format whose delimiters occur in ordinary text, such as a bracket template against a markdown link, still matches text that was never a placeholder, and counting an unpadded body widens that: a `-{i}-` template reports `-01-` out of the date `2024-01-15`.
