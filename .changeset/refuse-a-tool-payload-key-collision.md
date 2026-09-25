---
"prompt-identifiers-ai-sdk": patch
---

Refuse two tool payload keys that encode to one placeholder. One identifier written in two cases, or a key already spelled like a placeholder the call mints, left a single entry standing for both and lost the other silently. An encoded key is defined rather than assigned, so a payload key named `__proto__`, which is what `JSON.parse` produces, stays an own key instead of replacing the payload's prototype.
