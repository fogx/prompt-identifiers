# API Reference

Complete technical reference for `prompt-identifiers`.

## Table of Contents

- [Functions](#functions)
  - [encode](#encode)
  - [decode](#decode)
- [Types](#types)
  - [InputFormat](#inputformat)
  - [OutputFormat](#outputformat)
  - [EncodeConfig](#encodeconfig)
  - [EncodeResult](#encoderesult)
  - [TemplateFormat](#templateformat)
  - [FormatterFn](#formatterfn)
- [Input Format Details](#input-format-details)
  - [UUIDv4](#uuidv4)
  - [ULID](#ulid)
  - [Custom RegExp](#custom-regexp)
- [Output Format Details](#output-format-details)
  - [Numeric](#numeric)
  - [IdToken](#idtoken)
  - [Passthrough](#passthrough)
  - [Template Strings](#template-strings)
  - [Custom Functions](#custom-functions)
- [Behavior](#behavior)
  - [Deduplication](#deduplication)
  - [Case Normalization](#case-normalization)
  - [Decoding Strategy](#decoding-strategy)
- [Edge Cases](#edge-cases)
- [Error Handling](#error-handling)

---

## Functions

### encode

```typescript
function encode(text: string, config: EncodeConfig): EncodeResult
```

Replace identifiers in text with short placeholders.

**Parameters:**
- `text` - Input text containing identifiers
- `config` - Configuration object specifying input and output formats

**Returns:** `EncodeResult` with encoded text and mapping

**Example:**
```typescript
const result = encode(
  'User 123e4567-e89b-42d3-a456-426655440000 logged in',
  { inputFormat: 'UUIDv4', outputFormat: 'Numeric' }
);
// result.encoded: "User 000 logged in"
// result.mapping: { "000": "123e4567-e89b-42d3-a456-426655440000" }
```

---

### decode

```typescript
function decode(text: string, mapping: Record<string, string>): string
```

Restore original identifiers from placeholders.

**Parameters:**
- `text` - Text containing placeholders
- `mapping` - Mapping from `encode()` result

**Returns:** Text with original identifiers restored

**Example:**
```typescript
const decoded = decode(
  'User 000 logged in',
  { '000': '123e4567-e89b-42d3-a456-426655440000' }
);
// decoded: "User 123e4567-e89b-42d3-a456-426655440000 logged in"
```

---

## Types

### InputFormat

```typescript
type InputFormat = 'UUIDv4' | 'ULID' | RegExp
```

Specifies how to detect identifiers in the input text.

| Value | Description |
|-------|-------------|
| `'UUIDv4'` | Match RFC 4122 UUID version 4 |
| `'ULID'` | Match ULID (26-char Crockford Base32) |
| `RegExp` | Custom pattern (global flag added if missing) |

---

### OutputFormat

```typescript
type OutputFormat = 'Numeric' | 'IdToken' | 'Passthrough' | TemplateFormat | FormatterFn
```

Specifies how to generate placeholder strings.

| Value | Description |
|-------|-------------|
| `'Numeric'` | Smart triplet: `000`, `001`, ..., `999`, `001000` |
| `'IdToken'` | Base62: `0`, `A`, `z`, `10` |
| `'Passthrough'` | No replacement (returns original text) |
| `{ template: string }` | Template with format specifiers |
| `(index: number) => string` | Custom formatter function |

---

### EncodeConfig

```typescript
interface EncodeConfig {
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
}
```

Configuration for the `encode` function.

---

### EncodeResult

```typescript
interface EncodeResult {
  encoded: string;
  mapping: Record<string, string>;
}
```

Result of the `encode` function.

| Property | Description |
|----------|-------------|
| `encoded` | Text with identifiers replaced by placeholders |
| `mapping` | Object mapping placeholders to original identifiers |

---

### TemplateFormat

```typescript
interface TemplateFormat {
  template: string;
}
```

Template-based output format with `{i}` placeholder and optional format specifier.

---

### FormatterFn

```typescript
type FormatterFn = (index: number) => string
```

Custom function that converts an index to a placeholder string.

---

## Input Format Details

### UUIDv4

Matches [RFC 4122](https://www.rfc-editor.org/rfc/rfc4122) UUID version 4.

**Pattern:**
```regex
\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b
```

**Validation:**
- Version bit: `4` at position 15
- Variant bits: `[89ab]` at position 20

**Examples:**
- ✅ `123e4567-e89b-42d3-a456-426655440000`
- ✅ `123E4567-E89B-42D3-A456-426655440000` (case insensitive)
- ❌ `123e4567-e89b-72d3-a456-426655440000` (wrong version)

---

### ULID

Matches [ULID](https://github.com/ulid/spec) - 26 characters in Crockford Base32.

**Pattern:**
```regex
\b[0-9A-HJKMNP-TV-Z]{26}\b
```

**Character set:** `0-9A-HJKMNP-TV-Z` (excludes I, L, O, U to avoid ambiguity)

**Example:** `01ARZ3NDEKTSV4RRFFQ69G5FAV`

---

### Custom RegExp

Any JavaScript `RegExp` object. The global flag (`g`) is added automatically if not present.

**Best practices:**
- Use word boundaries (`\b`) to avoid partial matches
- Avoid greedy quantifiers (`.*`) that may over-match
- Test patterns with expected inputs

**Example:**
```typescript
// Match user IDs like "user-123456"
encode(text, {
  inputFormat: /user-\d{6}/gi,
  outputFormat: 'Numeric'
});

// Match custom codes
encode(text, {
  inputFormat: /[A-Z]{3}-\d{4}-[A-Z]{2}/g,
  outputFormat: 'Numeric'
});
```

---

## Output Format Details

### Numeric

Smart triplet expansion for optimal tokenization.

| Index Range | Width | Examples |
|-------------|-------|----------|
| 0-999 | 3 | `000`, `001`, ..., `999` |
| 1,000-999,999 | 6 | `001000`, `001001`, ..., `999999` |
| 1,000,000+ | 9 | `001000000`, ... |

**Why triplets?** LLM tokenizers typically split numbers at 3-digit boundaries. Smart expansion keeps placeholders as 1-2 tokens.

---

### IdToken

Base62 encoding using alphabet `0-9A-Za-z`.

| Index | Output |
|-------|--------|
| 0-9 | `0`-`9` |
| 10-35 | `A`-`Z` |
| 36-61 | `a`-`z` |
| 62+ | `10`, `11`, ... |

**Compact but less predictable** - use when minimizing character count matters more than consistent tokenization.

---

### Passthrough

Returns original text unchanged with empty mapping. Useful for testing or conditional encoding.

```typescript
const result = encode(text, {
  inputFormat: 'UUIDv4',
  outputFormat: 'Passthrough'
});
// result.encoded === text
// result.mapping === {}
```

---

### Template Strings

Format: `{ template: string }` where string contains `{i}` or `{i:specifier}`.

**Format specifiers:**

| Specifier | Description | Examples |
|-----------|-------------|----------|
| `{i}` | Plain numeric | `0`, `1`, `2`, ... |
| `{i:02}` | Zero-pad to 2 digits | `00`, `01`, ..., `99`, `100` |
| `{i:03}` | Zero-pad to 3 digits | `000`, `001`, ... |
| `{i:04}` | Zero-pad to 4 digits | `0000`, `0001`, ... |
| `{i:base62}` | Base62 encoding | `0`, `A`, `z`, `10`, ... |

**Examples:**
```typescript
// XML-style tags
{ template: '<id>{i}</id>' }        // <id>0</id>, <id>1</id>

// Bracketed with padding
{ template: '[ID:{i:04}]' }         // [ID:0000], [ID:0001]

// Base62 in custom format
{ template: '${i:base62}' }         // $0, $A, $z, $10
```

---

### Custom Functions

Full control over placeholder generation.

```typescript
type FormatterFn = (index: number) => string
```

**Examples:**
```typescript
// Hex encoding
(i) => `0x${i.toString(16)}`        // 0x0, 0x1, ..., 0xa, 0xb

// Letters (A-Z, then AA, AB, ...)
(i) => {
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(65 + Math.floor(i / 26) - 1) +
         String.fromCharCode(65 + (i % 26));
}

// Custom prefix with padding
(i) => `REF_${i.toString().padStart(5, '0')}`  // REF_00000, REF_00001
```

---

## Behavior

### Deduplication

Duplicate identifiers receive the same placeholder.

```typescript
const result = encode(
  'User ABC logged in. User ABC logged out.',
  { inputFormat: /ABC/g, outputFormat: 'Numeric' }
);
// result.encoded: "User 000 logged in. User 000 logged out."
// result.mapping: { "000": "abc" }  // Only one entry
```

---

### Case Normalization

All identifiers are normalized to lowercase in the mapping. This ensures:
- `123E4567-...` and `123e4567-...` map to the same placeholder
- Decoded text uses lowercase identifiers

```typescript
const result = encode('ID: 123E4567-E89B-42D3-A456-426655440000', {
  inputFormat: 'UUIDv4',
  outputFormat: 'Numeric'
});
// result.mapping: { "000": "123e4567-e89b-42d3-a456-426655440000" }
```

---

### Decoding Strategy

The `decode` function:

1. Sorts placeholders by length (descending) to prevent partial matches
2. Builds a single regex matching all placeholders
3. Performs one-pass replacement (O(n) complexity)

This ensures `001000` is matched before `001` when both exist.

---

## Edge Cases

| Input | Behavior |
|-------|----------|
| Empty string | Returns `{ encoded: "", mapping: {} }` |
| No matches | Returns original text with empty mapping |
| Only whitespace | Returns original text with empty mapping |
| Unicode text | Works correctly, only IDs are replaced |
| Overlapping patterns | First match wins (left-to-right) |

---

## Error Handling

### Invalid Template

Templates must contain `{i}` or `{i:specifier}`.

```typescript
encode(text, {
  inputFormat: 'UUIDv4',
  outputFormat: { template: 'no_placeholder' }
});
// Throws: Error: Invalid template "no_placeholder": must contain {i} or {i:specifier}
```

### Invalid RegExp

If a custom RegExp is invalid, the JavaScript engine throws a `SyntaxError` at RegExp construction time (before `encode` is called).

### Unknown Format Specifier

Unknown format specifiers fall back to plain numeric:

```typescript
encode(text, {
  inputFormat: 'UUIDv4',
  outputFormat: { template: '{i:unknown}' }
});
// Uses plain numeric: 0, 1, 2, ...
```
