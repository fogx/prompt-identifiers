---
"prompt-identifiers-baml": patch
---

Let the consumer that is reading the partials answer for a stream whose final rejects. Asking for the final before the loop and awaiting it after is an ordinary shape, and the rejection landing mid-loop took the report with nothing to say, so the partials the consumer had already read went uncounted.
