---
"prompt-identifiers-ai-sdk": patch
---

Scan the last result of each provider-run tool call rather than every preview frame. A preliminary result is replaced by the next one for the same call, so scanning all of them reported one warning per frame, and skipping them lost the warning entirely when a stream died before its final result arrived.
