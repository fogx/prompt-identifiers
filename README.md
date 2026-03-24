# prompt-identifiers

**Efficient, reversible ID compression for LLM prompts.**

Reduce token usage by up to 90% when working with UUIDs, ULIDs, and other long identifiers in LLM prompts - without losing information.

[![npm](https://img.shields.io/npm/v/prompt-identifiers)](https://www.npmjs.com/package/prompt-identifiers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## The Problem

LLMs tokenize text inefficiently when dealing with long identifiers:

```text
"User 123e4567-e89b-12d3-a456-426655440000 requested access to resource 987fcdeb-51a2-43f7-8d9c-0123456789ab"
```

**Single UUID:** 36 characters → **~18 tokens** ([GPT-5](https://platform.openai.com/tokenizer))\
**Full prompt above:** ~50 tokens

UUIDs are 36 characters each but provide no semantic value to the LLM - they're just opaque identifiers.

---

## The Solution

Replace long IDs with short, reversible placeholders:

```text
"User ~000~ requested access to resource ~001~"
```

**Token count:** ~12 tokens
**Savings:** ~75% fewer tokens
**Reversible:** Decode LLM output back to original IDs

---

## Features

- ✅ **Token-optimized** - Smart triplet expansion aligns with LLM tokenizers
- ✅ **Zero dependencies** - Pure TypeScript, no runtime dependencies
- ✅ **Flexible formats** - Numeric, base62, UUID-shaped, or custom placeholders
- ✅ **Stateless by default** - Optional shared state for multi-call consistency

---

## Packages

| Package                                                             | Description                         |                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`prompt-identifiers`](./packages/core)                             | Core JS library (zero dependencies) | [![npm](https://img.shields.io/npm/v/prompt-identifiers)](https://www.npmjs.com/package/prompt-identifiers)               |
| [`prompt-identifiers-ai-sdk`](./packages/prompt-identifiers-ai-sdk) | Vercel AI SDK middleware            | [![npm](https://img.shields.io/npm/v/prompt-identifiers-ai-sdk)](https://www.npmjs.com/package/prompt-identifiers-ai-sdk) |
| [`prompt-identifiers-baml`](./packages/prompt-identifiers-baml)     | BAML wrapper (experimental)         | [![npm](https://img.shields.io/npm/v/prompt-identifiers-baml)](https://www.npmjs.com/package/prompt-identifiers-baml)     |

> **Note:** `prompt-identifiers-baml` has not been tested in production. The API works and passes tests, but real-world BAML integration may surface edge cases. Please report issues if you encounter any.

---

## Benchmarks

**Token Savings (GPT-4 tokenizer):**

| Format                    | Original                | Compressed             | Savings    | Use Case         |
| ------------------------- | ----------------------- | ---------------------- | ---------- | ---------------- |
| UUID → SafeNumeric        | 36 chars (18 tokens)    | 5 chars (3 tokens)     | **83%**    | Collision-safe   |
| UUID → Numeric            | 36 chars (18 tokens)    | 3 chars (1 token)      | **94%**    | <1000 IDs        |
| UUID → Numeric (overflow) | 36 chars (18 tokens)    | 6 chars (2 tokens)     | **89%**    | 1K-1M IDs        |
| UUID → IdToken            | 36 chars (18 tokens)    | 2-4 chars (1-2 tokens) | **89-94%** | Variable density |
| ULID → Numeric            | 26 chars (10-20 tokens) | 3 chars (1 token)      | **90-95%** | <1000 IDs        |

**Real-world example (10K requests with 10 UUIDs each):**
assuming we input 10 uuids and the LLM generates any ID 10x as well:

```text
Input savings:  80 tokens/request × 10K = 800K tokens saved
Output savings: 80 tokens/request × 10K = 800K tokens saved
```

**Cost savings at [GPT-5 pricing](https://openai.com/api/pricing/):**

- Input: 800K tokens × $1.25/1M = **$1.00 saved**
- Output: 800K tokens × $10/1M = **$8.00 saved**
- **Total: $9.00 saved** (89%)

---

## Quick Start

### Installation

```bash
npm install prompt-identifiers
```

**Framework integrations:** [`prompt-identifiers-ai-sdk`](https://www.npmjs.com/package/prompt-identifiers-ai-sdk) for Vercel AI SDK and [`prompt-identifiers-baml`](https://www.npmjs.com/package/prompt-identifiers-baml) for BAML are also available. See [Documentation](#documentation) for details.

### Basic Usage

```typescript
import { encode, decode } from "prompt-identifiers";

// 1. Encode: Replace IDs with placeholders
const prompt = "User 123e4567-e89b-42d3-a456-426655440000 requested access.";
const { encoded, mapping } = encode(prompt, {
  inputFormat: "UUID",
  outputFormat: "SafeNumeric",
});
// → "User ~000~ requested access."

// 2. Send compressed prompt to LLM...
const llmResponse = callLLM(encoded); // "User ~000~ was granted access."

// 3. Decode: Restore original IDs
const restored = decode(llmResponse, mapping);
// → "User 123e4567-e89b-42d3-a456-426655440000 was granted access."
```

---

## Full Workflow Example

### Scenario: Database Query Results

```typescript
import { encode, decode } from "prompt-identifiers";

// Original prompt with database IDs
const prompt = `
  Analyze these user actions:
  - User 123e4567-e89b-42d3-a456-426655440000 logged in
  - User 987fcdeb-51a2-43f7-8d9c-0123456789ab made purchase
  - User 123e4567-e89b-42d3-a456-426655440000 logged out

  Summarize the activity.
`;

// Encode: Compress IDs
const { encoded, mapping } = encode(prompt, {
  inputFormat: "UUID",
  outputFormat: "SafeNumeric",
});
console.log(encoded);
// Output:
// Analyze these user actions:
// - User ~000~ logged in
// - User ~001~ made purchase
// - User ~000~ logged out

// Send to LLM (simulated)
const llmResponse = "User ~000~ had 2 sessions, User ~001~ made 1 purchase.";

// Decode: Restore original IDs
const restored = decode(llmResponse, mapping);
console.log(restored);
// Output: "User 123e4567-e89b-42d3-a456-426655440000 had 2 sessions,
//          User 987fcdeb-51a2-43f7-8d9c-0123456789ab made 1 purchase."
```

---

## AI SDK Integration

Automatic encoding/decoding as Vercel AI SDK middleware:

```typescript
import { openai } from "@ai-sdk/openai";
import { wrapLanguageModel, generateText } from "ai";
import { promptIdentifiersMiddleware } from "prompt-identifiers-ai-sdk";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: promptIdentifiersMiddleware({
    config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  }),
});

// Use normally - IDs are auto-encoded/decoded
const result = await generateText({
  model,
  prompt: "Summarize activity for user 123e4567-e89b-42d3-a456-426655440000",
});
```

### Prompt Injection

By default, the middleware appends a short instruction to the system message telling the model to preserve encoded identifiers:

> "All UUIDs have been replaced with short identifiers in the format ~000~. Always pass these identifiers exactly as-is."

This prevents LLMs from stripping delimiter characters (e.g., outputting `000` instead of `~000~` in tool call arguments). The instruction is only injected when at least one ID was encoded.

```typescript
// Default: instruction is injected (recommended)
promptIdentifiersMiddleware({
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
});

// Custom instruction ({format} is replaced with the example token)
promptIdentifiersMiddleware({
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  customInstruction: "IDs use {format} notation. Preserve them exactly.",
});

// Disable injection
promptIdentifiersMiddleware({
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  injectInstruction: false,
});
```

See [`prompt-identifiers-ai-sdk`](./packages/prompt-identifiers-ai-sdk) for full documentation.

---

## Output Formats

### SafeNumeric (Recommended)

Collision-safe tilde-wrapped numeric:

- **0-999:** `"~000~"` (3 tokens)
- **1K-1M:** `"~001000~"` (3 tokens)

```typescript
encode(text, { inputFormat: "UUID", outputFormat: "SafeNumeric" });
```

### Numeric

Smart triplet expansion for optimal tokenization:

- **0-999:** `"000"` (1 token)
- **1K-1M:** `"001000"` (2 tokens)
- **1M+:** `"001000000"` (3 tokens)

```typescript
encode(text, { inputFormat: "UUID", outputFormat: "Numeric" });
```

### IdToken (Base62)

Compact variable-length format:

- **0-61:** `"A"` (1 char)
- **62-3843:** `"zz"` (2 chars)
- **3844+:** `"100"` (3+ chars)

```typescript
encode(text, { inputFormat: "UUID", outputFormat: "IdToken" });
```

### Template

Template string with `{i}` placeholder and optional format specifier:

```typescript
// Custom delimiters with zero-filled index
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "[[{i:zeroFilled}]]" },
});
// Result: "[[000]]", "[[001]]", ...

// Plain index with prefix
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "<id:{i}>" },
});
// Result: "<id:0>", "<id:1>", ...

// Zero-padded to fixed width
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "ID_{i:04}" },
});
// Result: "ID_0000", "ID_0001", ...
```

### Custom Function

Full control with a formatter function:

```typescript
encode(text, {
  inputFormat: "UUID",
  outputFormat: (i) => `[[ID_${i}]]`,
});
// Result: "[[ID_0]]", "[[ID_1]]", ...
```

### NOTES

Depending on the tech stack used, some patterns and delimiters may work better than others. Here are some learnings to consider:

- if using streaming outputs, delimiters can break up. Example with delimiter `[[id]]` -> chunk1: `text [` chunk 2: `[id]]`
- some delimiters may be stripped or ignored by various systems. Example: delimiter: `<id>` -> will be stripped in URLs
- Pick delimiters that are not frequently used in your text. e.g. don't use delimiter: `~id~` if you have natural occurences of `~number` in your inputs/outputs as they may cause collisions.
- if you have prompts specifying ID output formats (e.g. `[Name](creator://id)`), the LLM may treat the template like a placeholder. Update your prompts accordingly

### Troubleshooting

#### Enable debug mode first

When something goes wrong, start by enabling `debug: true` and inspecting the `onEncode`/`onDecode` callbacks. They show the full mapping, encoded/decoded text, counts, and timing:

```typescript
promptIdentifiersMiddleware({
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  debug: true,
  onEncode: ({ mapping, debugData }) => {
    console.log("Mapping:", mapping); // { "~000~": "123e4567-..." }
    console.log("Encoded:", debugData?.output); // the full prompt sent to the LLM
  },
  onDecode: ({ output, mapping, debugData }) => {
    console.log("Decoded output:", output);
    console.log("Duration:", debugData?.durationMs, "ms");
  },
});
```

#### LLM strips delimiters in tool call arguments

**Symptom:** Tool calls fail because the model outputs `000` instead of `~000~`, causing the decode step to miss the placeholder.

**Cause:** Some LLMs treat delimiter characters (like `~`) as decorative formatting and strip them when generating structured JSON for tool calls.

**Fix:** Enable `injectInstruction` (on by default) to append a format-preservation instruction to the system message. This tells the model to preserve encoded identifiers exactly as-is.

#### LLM outputs fabricated/hallucinated IDs

**Symptom:** The response contains UUIDs that don't exist in your data.

**Cause:** The LLM sees raw IDs somewhere in the prompt alongside placeholders. This happens when part of the prompt is encoded but another part isn't, e.g. IDs injected after encoding or content that bypasses the middleware.

**Fix:** Check the `onEncode` mapping. If it has fewer entries than expected, some IDs aren't being encoded. Make sure all content passes through encoding.

#### Placeholders appear un-decoded in final output

**Symptom:** The response contains `~005~` or similar placeholders instead of real IDs.

**Cause:** The LLM invented a placeholder that doesn't exist in the mapping (e.g. `~005~` when only `~000~` through `~002~` were assigned). The LLM can "hallucinate" plausible-looking placeholders.

**Fix:** Compare `onDecode`'s output against the mapping keys. If the LLM is inventing placeholders, add a system prompt instruction like _"Only reference the identifiers provided to you. Do not invent new ones."_

#### Wrong ID restored after decoding

**Symptom:** A decoded ID doesn't match what was originally in that position.

**Cause:** Partial-match collisions. A short placeholder is a substring of a longer one (e.g. `00` inside `001`). The library handles this automatically (decode sorts by length), but custom formatter functions that produce variable-width placeholders without delimiters can still collide.

**Fix:** Use `SafeNumeric` (tilde-wrapped) or a delimited template like `[[{i:zeroFilled}]]` to prevent substring matches.

#### Streaming output drops or garbles text

**Symptom:** Streamed responses have missing or corrupted text around IDs.

**Cause:** Placeholders split across stream chunks. The AI SDK middleware handles this with an internal streaming decoder, but if you're using core `encode`/`decode` manually with streaming, you need to buffer across chunks yourself.

**Fix:** Use the AI SDK middleware or BAML wrapper for automatic stream handling. If using core directly with streaming, buffer text until you can confirm a complete placeholder before decoding.

---

## Input Formats

### UUID v4

```typescript
encode(text, { inputFormat: "UUID", outputFormat });
// Matches: 123e4567-e89b-42d3-a456-426655440000
```

### ULID

```typescript
encode(text, { inputFormat: "ULID", outputFormat });
// Matches: 01ARZ3NDEKTSV4RRFFQ69G5FAV
```

### Custom Regex

```typescript
encode(text, {
  inputFormat: /user-\d{6}/gi,
  outputFormat,
});
// Matches: user-123456, user-789012, ...
```

---

## API Reference

### Core Functions

#### `encode(text: string, config: EncodeConfig, state?: EncodeState): EncodeResult`

Replace IDs in prompt with placeholders.

Pass an optional `state` object (from `createEncodeState()`) to share placeholder assignments across multiple calls. The same ID always gets the same placeholder, and the counter continues from previous calls.

**Returns:**

- `encoded` - Compressed prompt with placeholders
- `mapping` - Placeholder → original ID mapping

**Example:**

```typescript
const { encoded, mapping } = encode("User abc-123 logged in", {
  inputFormat: "UUID",
  outputFormat: "SafeNumeric",
});
```

**Shared state example:**

```typescript
import { encode, createEncodeState } from "prompt-identifiers";

const state = createEncodeState();
const config = { inputFormat: "UUID", outputFormat: "SafeNumeric" } as const;

const r1 = encode("User 123e4567-e89b-42d3-a456-426655440000 logged in", config, state);
// → "User ~000~ logged in"

const r2 = encode(
  "User 987fcdeb-51a2-43f7-8d9c-0123456789ab and 123e4567-e89b-42d3-a456-426655440000",
  config,
  state
);
// → "User ~001~ and ~000~"   (123e4567 stays ~000~ from r1, 987fcdeb gets ~001~)
```

---

#### `decode(text: string, mapping: Record<string, string>): string`

Restore original IDs from LLM output.

**Example:**

```typescript
const restored = decode("User ~000~ was granted access", mapping);
```

---

### Configuration

#### `EncodeConfig`

```typescript
interface EncodeConfig {
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
}
```

---

### Types

#### `InputFormat`

- `'UUID'` - Match UUID version 4
- `'ULID'` - Match ULID format
- `RegExp` - Custom regex pattern

#### `OutputFormat`

- `'Numeric'` - Smart triplet expansion (000, 001, ..., 001000, ...)
- `'SafeNumeric'` - Collision-safe tilde-wrapped (~000~, ~001~, ...)
- `'IdToken'` - Base62 compact format
- `'Passthrough'` - No replacement (for testing)
- `{ template: string }` - Template with `{i}` placeholder
- `(index: number) => string` - Custom formatter function

#### `EncodeState`

Shared state for consistent placeholder assignment across multiple `encode()` calls. Create with `createEncodeState()`.

```typescript
interface EncodeState {
  idToPlaceholder: Map<string, string>;
  mapping: Record<string, string>;
}

function createEncodeState(): EncodeState;
```

#### `EncodeResult`

```typescript
interface EncodeResult {
  /** Text with IDs replaced by placeholders */
  encoded: string;
  /** Mapping from placeholders to original IDs */
  mapping: Record<string, string>;
}
```

---

## Use Cases

### 1. RAG Systems

Compress document IDs in retrieval results, decode when the LLM references them:

```typescript
import { encode, decode } from "prompt-identifiers";

// Documents retrieved from vector search
const docs = [
  {
    id: "123e4567-e89b-42d3-a456-426655440000",
    text: "Machine learning basics...",
  },
  {
    id: "987fcdeb-51a2-43f7-8d9c-0123456789ab",
    text: "Neural networks intro...",
  },
];

// Build prompt with document IDs
const prompt =
  docs.map((d) => `[${d.id}]: ${d.text}`).join("\n") +
  "\n\nAnswer the question using the documents above. Cite sources by their ID.";

// Encode: compress IDs before sending to LLM
const { encoded, mapping } = encode(prompt, {
  inputFormat: "UUID",
  outputFormat: "SafeNumeric",
});
// ~000~: Machine learning basics...
// ~001~: Neural networks intro...

// LLM responds with a tool call referencing encoded IDs
const llmResponse = '{"answer": "ML is...", "sources": ["~000~", "~001~"]}';

// Decode: restore real IDs for downstream use
const decoded = decode(llmResponse, mapping);
// {"answer": "ML is...", "sources": ["123e4567-...", "987fcdeb-..."]}
```

### 2. Multi-Agent Systems

Track agent IDs efficiently:

```typescript
const prompt = `Agent 01ARZ3NDEKTSV4RRFFQ69G5FAV suggests X,
              Agent 01ARZ3NDEKTSV4RRFFQ69G5FAW suggests Y.`;

const { encoded, mapping } = encode(prompt, {
  inputFormat: "ULID",
  outputFormat: "SafeNumeric",
});
// "Agent ~000~ suggests X, Agent ~001~ suggests Y."
```

### 3. Database Query Results

Reference rows by ID without token waste:

```typescript
const results = await db.query("SELECT id, name FROM users");
const prompt = `Summarize: ${JSON.stringify(results)}`;

const { encoded, mapping } = encode(prompt, {
  inputFormat: "UUID",
  outputFormat: "SafeNumeric",
});
```

---

## Comparison with Alternatives

| Approach               | Reversible | Token Efficient      | Maintains Uniqueness |
| ---------------------- | ---------- | -------------------- | -------------------- |
| **prompt-identifiers** | ✅ Yes     | ✅ Yes (90% savings) | ✅ Yes               |
| Raw UUIDs              | ✅ Yes     | ❌ No                | ✅ Yes               |
| Hash IDs               | ❌ No      | ⚠️ Partial           | ⚠️ Collision risk    |
| Sequential IDs         | ❌ No      | ✅ Yes               | ❌ Not reversible    |

---

## Documentation

- [`prompt-identifiers`](./packages/core) - Core library API
- [`prompt-identifiers-ai-sdk`](./packages/prompt-identifiers-ai-sdk) - Vercel AI SDK middleware
- [`prompt-identifiers-baml`](./packages/prompt-identifiers-baml) - BAML wrapper

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, guidelines, and how to get started.

For bug reports and feature requests, please [open an issue](https://github.com/fogx/prompt_identifiers/issues).

---

## License

MIT License - see [LICENSE](LICENSE) file for details.
