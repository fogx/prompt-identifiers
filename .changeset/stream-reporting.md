---
"prompt-identifiers-ai-sdk": patch
---

`onDecode` fires once for a stream that errors or is cancelled, carrying the text decoded up to that point and the warnings found in it. A dying stream reported nothing, so a partial answer's `unknown_placeholder` and `stripped_delimiter` warnings went with it. A stream that ends normally still reports exactly once.

`debugData.decodedCount` on the streamed path counts the placeholder occurrences in the encoded text, the way the generated path always did. It reported the size of the mapping instead, so a call holding five identifiers reported five whatever the answer contained.
