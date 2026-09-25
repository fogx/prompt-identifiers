---
"prompt-identifiers-baml": patch
---

Refuse a `prompt-identifiers` older than 0.2.0 where the wrapper is built. Every export this package uses exists on the older versions, so nothing failed to link and nothing read `undefined`, and a consumer whose peer range went unmet ran a whole call on a core that hands back a lowercased ULID. The probe is behavioural, since the change that matters is behaviour rather than an export.
