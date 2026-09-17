---
"prompt-identifiers": patch
---

`findPlaceholders(text, format)` returns the tokens in a text that an output format could have produced, so a caller can tell which ones the model invented. It rules out a token the format cannot emit, such as `~5~` where it pads to `~005~`, and returns nothing for `Numeric`, `IdToken` and `Passthrough`, whose placeholders look like ordinary text. A format whose delimiters occur in prose, such as a bracket template against a markdown link, still matches text that was never a placeholder.
