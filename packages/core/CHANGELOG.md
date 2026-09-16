# prompt-identifiers

## 0.1.4

### Patch Changes

- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.
- 9e00ea1: Build with tsdown instead of tsup. The CommonJS entry is now `dist/index.cjs` with types in `dist/index.d.cts`, and `main`, `types` and the `require` export point at them. Imports of the package root are unchanged.

## 0.1.3

### Patch Changes

- Add instruction injection to prevent LLMs from stripping delimiter characters in tool call arguments. The middleware now appends a format-preservation instruction to the system message by default. Added decode warnings to detect stripped delimiters and surviving placeholders.

## 0.1.2

### Patch Changes

- Add `EncodeState` interface and `createEncodeState()` for shared placeholder assignment across multiple `encode()` calls
- Add optional `state` parameter to `encode()` for cross-call consistency
