# Contributing to prompt-identifiers

Thank you for your interest in contributing!

## Project Overview

`prompt-identifiers` is a TypeScript monorepo for compressing long identifiers in LLM prompts. It consists of:

- **prompt-identifiers** - Core library (zero dependencies)
- **prompt-identifiers-ai-sdk** - Vercel AI SDK middleware
- **prompt-identifiers-baml** - BAML wrapper

## Project Structure

```
prompt-identifiers/
├── packages/
│   ├── prompt-identifiers-js/     # Core library
│   │   ├── src/index.ts
│   │   └── __tests__/
│   ├── prompt-identifiers-ai-sdk/ # AI SDK middleware
│   │   ├── src/index.ts
│   │   └── __tests__/
│   └── prompt-identifiers-baml/   # BAML wrapper
│       ├── src/index.ts
│       └── __tests__/
├── .github/workflows/             # CI/CD
├── CLAUDE.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

## Development Setup

### Prerequisites

- **Node.js 18+**
- **pnpm** (recommended)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/fogx/prompt_identifiers.git
cd prompt_identifiers

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

## Development Workflow

### Running Tests

```bash
# All packages
pnpm test

# Specific package
pnpm --filter prompt-identifiers test
pnpm --filter prompt-identifiers-ai-sdk test
pnpm --filter prompt-identifiers-baml test
```

### Building

```bash
# All packages
pnpm build

# Specific package
pnpm --filter prompt-identifiers build
```

## Making Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Write tests first** - Add test cases to `__tests__/`

3. **Implement the feature**

4. **Update changelog** - Add entry under `## [Unreleased]` in root `CHANGELOG.md`

5. **Run tests** - Ensure all tests pass

   ```bash
   pnpm test
   ```

6. **Commit your changes**
   ```bash
   git commit -m "feat: your descriptive commit message"
   ```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

## Code Style

- TypeScript strict mode
- `function` declarations for top-level, arrow functions for callbacks
- No runtime dependencies in core package
- Use shared test helpers where available

## Pull Request Checklist

- [ ] All tests pass (`pnpm test`)
- [ ] Code compiles (`pnpm build`)
- [ ] Changelog updated
- [ ] Commit messages are descriptive

## Questions?

Open an issue at https://github.com/fogx/prompt_identifiers/issues
