# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### prompt-identifiers (core)

### prompt-identifiers-ai-sdk

### prompt-identifiers-baml

---

## [0.1.1] - 2026-02-09

### prompt-identifiers (core)

#### Fixed

- Change SafeNumeric output from angle brackets (`<000>`) to tildes (`~000~`) to prevent stripping by LLMs and HTML/markdown parsers

#### Changed

- Apply prettier formatting across codebase

### prompt-identifiers-ai-sdk

#### Fixed

- Rewrite streaming decoder to support symmetric delimiters (e.g., `~000~`) and partial multi-char delimiter buffering
- Fix typo in docstring

#### Added

- Add dedicated streaming decoder test suite (4 output formats × ~15 cases, symmetric delimiter edge cases)
- Add `debug` option; when `true`, `onEncode`/`onDecode` callbacks receive `debugData` with input/output snapshots, counts, and `durationMs` timing

#### Changed

- **Breaking:** Move `encodedCount` and `decodedCount` from top-level callback args into `debugData`
- Apply prettier formatting

### prompt-identifiers-baml

#### Fixed

- Change SafeNumeric output from angle brackets (`<000>`) to tildes (`~000~`) in `formatPlaceholder`

#### Added

- Add `debug` option; when `true`, `onEncode`/`onDecode` callbacks receive `debugData` with input/output snapshots, counts, and `durationMs` timing

#### Changed

- **Breaking:** Move `encodedCount` and `decodedCount` from top-level callback args into `debugData`
- Apply prettier formatting

---

## [0.1.0] - 2026-02-05

Initial release of all packages.

### prompt-identifiers (core)

#### Added

- `encode()` and `decode()` functions
- Input formats: UUID, ULID, custom RegExp
- Output formats: SafeNumeric, Numeric, IdToken, custom templates
- Zero runtime dependencies

### prompt-identifiers-ai-sdk

#### Added

- Vercel AI SDK v3 middleware
- Support for `generateText` and `streamText`
- Streaming buffer for split placeholders
- Tool call input/output encoding
- `onEncode` and `onDecode` callbacks

### prompt-identifiers-baml

#### Added

- `wrapBamlFunction` for BAML-generated functions
- `wrapBamlStreamingFunction` for streaming
- `encodeObject` and `decodeObject` utilities
- Field path syntax for selective encoding (`items[].id`)
- `onEncode` and `onDecode` callbacks
