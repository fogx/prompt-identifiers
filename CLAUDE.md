# prompt-identifiers

Monorepo for ID compression in LLM prompts. Reduces token usage by replacing UUIDs/ULIDs with compact placeholders.

## Packages

| Package | Description |
|---------|-------------|
| `prompt-identifiers` | Core JS library (zero dependencies) |
| `prompt-identifiers-ai-sdk` | Vercel AI SDK middleware |
| `prompt-identifiers-baml` | BAML wrapper |

## Commands

```bash
# Root
pnpm install              # Install all dependencies
pnpm test                 # Run tests for current package

# Per-package (from package dir)
pnpm test                 # Run tests
pnpm build                # Build to dist/
```

## Key Files

- `packages/core/src/index.ts` - Core encode/decode implementation
- `packages/prompt-identifiers-ai-sdk/src/index.ts` - AI SDK middleware
- `packages/prompt-identifiers-baml/src/index.ts` - BAML wrapper

## Code Conventions

- Use `function` declarations for top-level functions, arrow functions for callbacks
- Extract repeated patterns into helper functions
- Import test utilities from `test-helpers.ts` where available
- No runtime dependencies in core package

## Changelog

When making changes, update root `CHANGELOG.md`:

- Add entries under the relevant package section
- Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`
- Imperative mood: "Add feature" not "Added feature"
