---
"prompt-identifiers-ai-sdk": patch
---

Encode the reason a caller gave for approving or denying a provider-run tool. A `tool-approval-response` part carries the user's own words about whatever the tool was about to act on, and they reached the model with every identifier in them spelled out. The sibling `execution-denied` output carries the same field and was already encoded. The `approvalId` is untouched, because it is what matches the response to the request the provider issued.
