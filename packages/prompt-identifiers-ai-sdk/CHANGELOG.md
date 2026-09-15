# prompt-identifiers-ai-sdk

## 0.3.0

### Minor Changes

- 326082a: **Breaking:** Support AI SDK v7. The middleware now implements `LanguageModelV4Middleware` (`specificationVersion: "v4"`) and requires `ai@>=7` and `@ai-sdk/provider@>=4`. Stay on 0.2.x for AI SDK v6.

### Patch Changes

- Updated dependencies [a0e182f]
  - prompt-identifiers@0.1.4

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
