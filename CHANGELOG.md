# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### prompt-identifiers (core)

#### Changed

- Export `createFormatter` for use by integrations

### prompt-identifiers-ai-sdk

#### Added

- Add `injectInstruction` option (default `true`) to append a format-preservation instruction to the system message, preventing LLMs from stripping delimiter characters in tool call arguments
- Add `customInstruction` option with `{format}` placeholder for custom instruction text
- Add `DecodeWarning` type and `warnings` array in `onDecode` callback to detect stripped delimiters and surviving placeholders in both text and tool call outputs

### prompt-identifiers-baml

---

## [0.1.2] - 2026-03-02

### prompt-identifiers (core)

#### Added

- Add `EncodeState` interface and `createEncodeState()` for shared placeholder assignment across multiple `encode()` calls
- Add optional `state` parameter to `encode()` for cross-call consistency

### prompt-identifiers-ai-sdk

#### Fixed

- Fix cross-message placeholder consistency — same UUID now always gets the same placeholder across all messages in a prompt
- Fix streaming decoder for overlapping delimiters (e.g. `~ID000~` where CLOSE `~` is a prefix of OPEN `~ID`)
- Fix `decodedText` accumulation to work outside debug mode

#### Added

- Encode tool-call args (`ToolCallPart.input`) in prompt messages — prevents LLM from seeing raw UUIDs alongside placeholders in agentic flows
- Add `output` and `mapping` fields to `onDecode` callback (always available, not just in debug mode)
- Add overlapping delimiter edge case tests for streaming decoder

#### Changed

- **Breaking:** `onDecode` callback now receives `{ output, mapping, debugData? }` instead of `{ debugData? }`
- Refactor encoding internals to use core's `EncodeState`, remove `mergeMapping()` helper

### prompt-identifiers-baml

#### Changed

- Refactor to use core's `encode()` + `EncodeState` instead of duplicated internal encoding logic (~100 lines removed)

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
