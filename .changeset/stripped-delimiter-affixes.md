---
"prompt-identifiers-ai-sdk": patch
---

The `stripped_delimiter` warning works for every delimited output format, not only those whose placeholder is one run of digits between two literals. The bare index was extracted with a pattern that required the whole placeholder to be `<non-digits><digits><non-digits>`, so `v1_{i:03}`, `ID2_{i:03}`, `{i:03}_v2` and `<1:{i:03}:2>` produced no index at all and the check was silently inert for them while both READMEs documented the warning without qualification. The format's fixed prefix and suffix are now read off the format itself, by writing two placeholders far apart and keeping what they share at each end, so a literal carrying its own digits still contributes nothing and the body between the affixes is found wherever it sits. `Numeric` and `IdToken` have nothing fixed at either end and still report nothing, which is what the docs already say about them.
