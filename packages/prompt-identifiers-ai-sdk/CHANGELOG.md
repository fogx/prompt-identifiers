# prompt-identifiers-ai-sdk

## 0.3.0

### Minor Changes

- 9e00ea1: **Breaking:** Support AI SDK v7. The middleware now implements `LanguageModelV4Middleware` (`specificationVersion: "v4"`) and requires `ai@>=7` and `@ai-sdk/provider@>=4`. Stay on 0.2.x for AI SDK v6.

### Patch Changes

- 0c71cae: The middleware was walking past several V4 content shapes. It now encodes inline text carried by a file part and the `error-text`, `error-json`, `content` and `execution-denied` tool result outputs, and decodes reasoning text on the way back out of both generate and stream results. Streaming also holds together better: the buffered tail is emitted while the text block is still open rather than after the stream has finished, where the AI SDK dropped it from the assembled message; a streaming tool input buffers the way the text stream does, so a placeholder split across two deltas no longer arrives raw; and a clean decode with a non-delimited output format no longer reports a surviving placeholder that is really just part of the restored UUID.
- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.

## 0.2.0

### Minor Changes

- Add instruction injection to prevent LLMs from stripping delimiter characters in tool call arguments. The middleware now appends a format-preservation instruction to the system message by default. Added decode warnings to detect stripped delimiters and surviving placeholders.

### Patch Changes

- Updated dependencies
  - prompt-identifiers@0.1.3

## 0.1.2

### Patch Changes

- Fix cross-message placeholder consistency — same UUID now always gets the same placeholder across all messages in a prompt
- Fix streaming decoder for overlapping delimiters (e.g. `~ID000~` where CLOSE `~` is a prefix of OPEN `~ID`)
- Encode tool-call args (`ToolCallPart.input`) in prompt messages — prevents LLM from seeing raw UUIDs alongside placeholders in agentic flows
- Add `output` and `mapping` fields to `onDecode` callback (always available, not just in debug mode)
- **Breaking:** `onDecode` callback now receives `{ output, mapping, debugData? }` instead of `{ debugData? }`
- Refactor encoding internals to use core's `EncodeState`, remove `mergeMapping()` helper
- Updated dependencies
  - prompt-identifiers@0.1.2
