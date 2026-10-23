---
"prompt-identifiers": patch
---

Refuse an input format that can match the empty string. `/\d*/g` matches between every pair of characters, so `encode` minted a placeholder standing for nothing and wrote it into every gap in the prompt. The round trip still succeeded, which left the token bill as the only symptom.
