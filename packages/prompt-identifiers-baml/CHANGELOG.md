# prompt-identifiers-baml

## 0.1.3

### Patch Changes

- e2303f4: Ship the TypeScript sources alongside `dist`, so the declaration maps and source maps in the published package resolve instead of pointing at files that were never included. The CommonJS build now emits a source map too, which only the ESM build had.
- 9e00ea1: Build with tsdown instead of tsup. The CommonJS entry is now `dist/index.cjs` with types in `dist/index.d.cts`, and `main`, `types` and the `require` export point at them. Imports of the package root are unchanged.

## 0.1.2

### Patch Changes

- Refactor to use core's `encode()` + `EncodeState` instead of duplicated internal encoding logic (~100 lines removed)
- Updated dependencies
  - prompt-identifiers@0.1.2
