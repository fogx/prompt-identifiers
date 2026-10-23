---
"prompt-identifiers-baml": patch
---

Refuse a key collision whichever key caused it. The check skipped a key that encodes to itself, so an object holding both an identifier and that identifier's own placeholder as keys still lost one of them, while the same pair in the other order was refused.
