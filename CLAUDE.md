# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for ID compression in LLM prompts. Replaces UUIDs/ULIDs with compact placeholders (e.g. `<000>`) to reduce token usage by up to 90%, then restores originals in responses.

## Commands

```bash
# Root-level (runs across all packages)
pnpm install                    # Install all dependencies
pnpm build                      # Build all packages (tsup → dist/)
pnpm test                       # Run all tests across all packages

# Per-package
pnpm --filter prompt-identifiers test           # Core tests only
pnpm --filter prompt-identifiers-ai-sdk test    # AI SDK tests only
pnpm --filter prompt-identifiers-baml test      # BAML tests only

# Single test file (from package dir)
cd packages/core && npx jest __tests__/index.test.ts
cd packages/core && npx jest --testNamePattern "encode"   # Filter by name

# Benchmarks (core only)
cd packages/core && pnpm bench            # Performance benchmarks
cd packages/core && pnpm bench:accuracy   # Accuracy benchmarks
```

## Architecture

Three-layer design where core is dependency-free and both integrations depend on it:

```
prompt-identifiers (core)          ← Zero dependencies, pure encode/decode
├── prompt-identifiers-ai-sdk      ← Vercel AI SDK v3 middleware
└── prompt-identifiers-baml        ← BAML function wrapper
```

### Core (`packages/core/src/index.ts`)

Two main functions: `encode(text, config)` and `decode(text, mapping)`.

- **Input formats**: `'UUID'`, `'ULID'`, or custom `RegExp` — defines what to detect
- **Output formats**: `'Numeric'`, `'IdToken'`, `'SafeNumeric'`, `'Passthrough'`, template string, or function — defines replacement style
- IDs are deduplicated (same ID → same placeholder) via case-normalized Map
- Decode sorts placeholders by length descending to prevent partial-match collisions
- Performance: WeakMap cache for decode regex, pre-computed BASE62 lookup table

### AI SDK Middleware (`packages/prompt-identifiers-ai-sdk/src/index.ts`)

`promptIdentifiersMiddleware(options)` returns a `LanguageModelV3Middleware` with three hooks:

- `transformParams` — encodes IDs in all prompt messages before LLM call
- `wrapGenerate` — decodes IDs in response content
- `wrapStream` — buffers incomplete placeholders split across stream chunks, then decodes

Handles TextPart, ToolResultPart (text + JSON), and tool call inputs.

### BAML Wrapper (`packages/prompt-identifiers-baml/src/index.ts`)

`wrapBamlFunction()` / `wrapBamlStreamingFunction()` — wraps BAML-generated functions.

- Field path selectors for targeted encoding: `'user_id'`, `'data.users[].profile.id'`
- Deep recursive traversal through objects/arrays with global mapping consistency

## Key Files

- `packages/core/src/index.ts` — Core encode/decode implementation
- `packages/prompt-identifiers-ai-sdk/src/index.ts` — AI SDK middleware
- `packages/prompt-identifiers-baml/src/index.ts` — BAML wrapper
- `packages/prompt-identifiers-ai-sdk/__tests__/test-helpers.ts` — Mock factories for AI SDK tests

## Code Conventions

- Use `function` declarations for top-level functions, arrow functions for callbacks
- Extract repeated patterns into helper functions
- Import test utilities from `test-helpers.ts` where available
- No runtime dependencies in core package
- All packages build with tsup (CJS + ESM + DTS)
- Tests use Jest with ts-jest preset; test files live in `__tests__/` directories

## Changelog

When making changes, update root `CHANGELOG.md`:

- Add entries under the relevant package section
- Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`
- Imperative mood: "Add feature" not "Added feature"
