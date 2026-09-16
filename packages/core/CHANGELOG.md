# prompt-identifiers

## 0.1.3

### Patch Changes

- Add instruction injection to prevent LLMs from stripping delimiter characters in tool call arguments. The middleware now appends a format-preservation instruction to the system message by default. Added decode warnings to detect stripped delimiters and surviving placeholders.

## 0.1.2

### Patch Changes

- Add `EncodeState` interface and `createEncodeState()` for shared placeholder assignment across multiple `encode()` calls
- Add optional `state` parameter to `encode()` for cross-call consistency
