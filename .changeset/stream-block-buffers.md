---
"prompt-identifiers-ai-sdk": patch
---

Each streaming text and reasoning block gets its own buffer, keyed by the id the provider sends, the way tool inputs already did. One buffer was shared across every text block, so a provider running two at once fed one block's text into the other's held tail: a placeholder split across one block's chunks came back raw, with the other block's text spliced into the middle of it. A tail held when a block ends is now flushed onto that block rather than onto whichever block spoke last.

A tool input whose `tool-input-start` never arrived is buffered instead of decoded chunk by chunk, so a placeholder split across its deltas no longer reaches the caller raw. A repeated `tool-input-start` for the same id keeps the buffer it already had rather than replacing it and dropping what it held.

The decode warning scan only runs when an `onDecode` callback is registered to receive it. It masks every ID across the whole answer, which is the dominant cost of a large response, and nothing could read the result.

A mapping above roughly 120,000 placeholders no longer throws `RangeError: Maximum call stack size exceeded` when a stream starts. The longest placeholder was measured by spreading every length into `Math.max`.
