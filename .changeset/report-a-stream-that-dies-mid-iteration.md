---
"prompt-identifiers-baml": patch
---

Report a generation that dies part way through. The BAML client raises a validation error, a timeout and an abort from inside its own iterator, and a consumer already holding decoded partials was told nothing at all, on both return shapes. `onDecode` now fires where the consumption that finishes first ends, including the error that ends it, and a consumer that breaks out of its loop early is still not reported to. `durationMs` on a stream is the decode time summed over the partials rather than the wall clock around them, which carried the model's latency and read about 1400 times too high.
