# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### prompt-identifiers (core)

### prompt-identifiers-ai-sdk

### prompt-identifiers-baml

---

## [0.1.0] - Unreleased

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
