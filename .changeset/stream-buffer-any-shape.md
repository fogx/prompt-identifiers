---
"prompt-identifiers-ai-sdk": patch
---

The streaming buffer holds back a chunk tail that could still grow into one of this call's placeholders, instead of deriving delimiters from the first placeholder and assuming the body is digits. A placeholder split across chunks now decodes whatever the output format writes, so `{ template: '[{i:base62}]' }` no longer delivers `[A]` verbatim, a formatter function returning letters works the same way, and `Numeric` and `IdToken` reassemble a split placeholder instead of passing it through.

A whole match can go back into the buffer, since it may still grow into a longer placeholder, so a format whose placeholder widths jump (`Numeric` past 1000 ids, `ID1` against `ID11`) decodes the one the model wrote rather than the shorter one inside it. A tail never starts partway through a match, so an ID the buffer just restored is not read back as the start of another one. That holds for a placeholder sitting inside another one at an offset, which a custom formatter can produce: streaming `XABY` against the set `{AB, XABY}` used to restore the ID of `AB` and a stray `X`.

A streaming tool input whose buffer still holds a tail gets it back on the closing `finish` chunk, not only on `tool-input-end`. A provider that ends a stream without the per-block end chunk used to drop it, while an identically shaped text stream kept it.
