# prompt-identifiers-ai-sdk

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
