# prompt-identifiers-baml

## 0.1.3

### Patch Changes

- a0e182f: Build with tsdown instead of tsup. The CommonJS entry is now `dist/index.cjs` with types in `dist/index.d.cts`, and `main`, `types` and the `require` export point at them. Imports of the package root are unchanged.
- Updated dependencies [a0e182f]
  - prompt-identifiers@0.1.4

## 0.1.2

### Patch Changes

- Refactor to use core's `encode()` + `EncodeState` instead of duplicated internal encoding logic (~100 lines removed)
- Updated dependencies
  - prompt-identifiers@0.1.2
