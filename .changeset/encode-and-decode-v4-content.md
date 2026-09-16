---
"prompt-identifiers-ai-sdk": patch
---

The middleware was walking past several V4 content shapes. It now encodes inline text carried by a file part and the `error-text`, `error-json`, `content` and `execution-denied` tool result outputs, and decodes reasoning text on the way back out of both generate and stream results. Streaming also holds together better: the buffered tail is emitted while the text block is still open rather than after the stream has finished, where the AI SDK dropped it from the assembled message; a streaming tool input buffers the way the text stream does, so a placeholder split across two deltas no longer arrives raw; and a clean decode with a non-delimited output format no longer reports a surviving placeholder that is really just part of the restored UUID.
