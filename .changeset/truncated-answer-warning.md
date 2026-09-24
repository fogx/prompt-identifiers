---
"prompt-identifiers-ai-sdk": patch
---

An answer the model did not finish no longer reports its last placeholder as one the model invented. Under a format that opens a placeholder without closing it, such as `{ template: 'ID_{i:04}' }`, the cut lands mid-token and leaves `ID_000`. Nothing closes a placeholder in that format, so the scan reads the shortened digit run as a whole one and `unknown_placeholder` fired on every truncated answer, even though the format never writes a body that short. The trailing token is now left alone when the call stopped at the token limit, errored or was cancelled, and only when a placeholder this call actually minted starts with it. A token that starts none of them, such as an invented `ID_9999`, is still reported, and a format that closes its placeholders is unaffected either way because half of one is not a placeholder at all.

An example placeholder carrying `$` reaches the instruction intact. `{format}` was substituted with a string replacement, which reads `$$` as an escape, so `{ template: '$${i:03}$$' }` told the model to expect `$000$` while the prompt carried `$$000$$`.
