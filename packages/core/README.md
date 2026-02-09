# prompt-identifiers

Efficient, reversible ID compression for LLM prompts - reduce token usage by up to 90%.

**Zero runtime dependencies** - pure TypeScript implementation.

## Installation

```bash
npm install prompt-identifiers
```

## Quick Start

```typescript
import { encode, decode } from "prompt-identifiers";

// Encode UUIDs to short placeholders
const result = encode(
  "User 123e4567-e89b-42d3-a456-426655440000 sent message to 987fcdeb-51a2-43f7-8d9c-0123456789ab",
  { inputFormat: "UUID", outputFormat: "Numeric" }
);

console.log(result.encoded);
// "User 000 sent message to 001"

console.log(result.mapping);
// { "000": "123e4567-e89b-42d3-a456-426655440000", "001": "987fcdeb-51a2-43f7-8d9c-0123456789ab" }

// Decode LLM response back to original IDs
const restored = decode(result.encoded, result.mapping);
// "User 123e4567-e89b-42d3-a456-426655440000 sent message to 987fcdeb-51a2-43f7-8d9c-0123456789ab"
```

## Why Use This?

LLMs tokenize UUIDs inefficiently - a single UUID consumes ~18 tokens. By replacing IDs with short placeholders:

- **Reduce token usage** by up to 90% on ID-heavy prompts
- **Lower API costs** proportionally
- **Increase effective context window** for complex prompts

The mapping preserves the original IDs for perfect reconstruction.

## Input Formats

### Built-in Formats

| Format   | Pattern                    | Example                                |
| -------- | -------------------------- | -------------------------------------- |
| `'UUID'` | RFC 4122 UUID v4           | `123e4567-e89b-42d3-a456-426655440000` |
| `'ULID'` | Crockford Base32, 26 chars | `01ARZ3NDEKTSV4RRFFQ69G5FAV`           |

### Custom RegExp

Pass any `RegExp` to match custom ID patterns:

```typescript
// Match custom user IDs
encode("User user-123456 logged in", {
  inputFormat: /user-\d{6}/gi,
  outputFormat: "Numeric",
});
// → { encoded: "User 000 logged in", mapping: { "000": "user-123456" } }

// Match order codes
encode("Order ORD-ABC-123 shipped", {
  inputFormat: /ORD-[A-Z]{3}-\d{3}/gi,
  outputFormat: "Numeric",
});
```

The global flag (`g`) is added automatically if not present.

## Output Formats

### Built-in Formats

| Format          | Description                                          | Examples                           |
| --------------- | ---------------------------------------------------- | ---------------------------------- |
| `'SafeNumeric'` | **Recommended.** Collision-safe with tildes           | `~000~`, `~001~`, `~002~`          |
| `'Numeric'`     | Smart triplet expansion                              | `000`, `001`, ..., `999`, `001000` |
| `'IdToken'`     | Base62 compact                                       | `0`, `A`, `z`, `10`                |
| `'Passthrough'` | No replacement                                       | Original text unchanged            |

### SafeNumeric Format (Recommended)

The `SafeNumeric` format wraps placeholders in tildes (`~`) to prevent collision with naturally-occurring numbers in LLM responses. See the [main documentation](../../README.md#output-formats) for detailed format comparisons and delimiter guidance.

```typescript
// Problem with Numeric format:
encode("User abc-123...", config) → "User 000"
// LLM responds: "User 000 reported error code 001"
decode(response, mapping) → Wrong! "001" gets decoded even though it's not a placeholder

// Solution with SafeNumeric:
encode("User abc-123...", config) → "User ~000~"
// LLM responds: "User ~000~ reported error code 001"
decode(response, mapping) → Correct! Only ~000~ is decoded
```

For custom delimiters, use the template format (see below).

### Template Strings

Use `{ template: string }` with format specifiers:

```typescript
// Plain numeric
encode(text, { inputFormat: "UUID", outputFormat: { template: "<id:{i}>" } });
// → <id:0>, <id:1>, <id:2>, ...

// Zero-padded to 4 digits
encode(text, { inputFormat: "UUID", outputFormat: { template: "ID_{i:04}" } });
// → ID_0000, ID_0001, ID_0002, ...

// Base62 encoding
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "[{i:base62}]" },
});
// → [0], [A], [z], [10], ...

// Smart triplet expansion (like SafeNumeric but with custom delimiters)
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "[[{i:zeroFilled}]]" },
});
// → [[000]], [[001]], ..., [[999]], [[001000]], ...
```

**Format specifiers:**

- `{i}` - plain numeric: 0, 1, 2, ...
- `{i:02}`, `{i:03}`, `{i:04}` - zero-padded to N digits
- `{i:zeroFilled}` - smart triplet expansion: 000, 001, ..., 999, 001000, ...
- `{i:base62}` - base62 encoding

### Custom Functions

For full control, pass a formatter function:

```typescript
// Custom prefix
encode(text, {
  inputFormat: "UUID",
  outputFormat: (i) => `[[ID_${i}]]`,
});
// → [[ID_0]], [[ID_1]], ...

// Hex encoding
encode(text, {
  inputFormat: "UUID",
  outputFormat: (i) => `0x${i.toString(16).toUpperCase()}`,
});
// → 0x0, 0x1, ..., 0xA, 0xB, ...

// Letter-based
encode(text, {
  inputFormat: "UUID",
  outputFormat: (i) => String.fromCharCode(65 + i),
});
// → A, B, C, ...
```

## API Reference

See [docs/API.md](docs/API.md) for complete type definitions and detailed documentation.

### `encode(text, config)`

```typescript
function encode(text: string, config: EncodeConfig): EncodeResult;
```

Replace IDs in text with placeholders. Returns encoded text and a mapping to restore original IDs.

### `decode(text, mapping)`

```typescript
function decode(text: string, mapping: Record<string, string>): string;
```

Restore original IDs from placeholders using the mapping from `encode()`.

## Features

- **Deduplication**: Repeated IDs get the same placeholder
- **Case insensitive**: `123E4567-...` and `123e4567-...` map to same placeholder
- **Unicode safe**: Works with any surrounding text content
- **Type-safe**: Full TypeScript support with exported types
- **Zero dependencies**: Pure JavaScript, works anywhere

## Performance

Native JavaScript implementation - **1.5-2.7x faster** than Rust FFI for this workload.

| UUIDs | Roundtrip (μs) |
| ----- | -------------- |
| 1     | 0.85           |
| 10    | 5.09           |
| 50    | 26.66          |
| 100   | 52.33          |
| 500   | 258.19         |
| 1000  | 560.70         |

Both `encode` and `decode` are O(n) linear time.

## License

MIT
