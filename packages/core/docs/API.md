# API Reference

Complete technical reference for `prompt-identifiers`.

## Table of Contents

- [Functions](#functions)
  - [encode](#encode)
  - [decode](#decode)
  - [findPlaceholders](#findplaceholders)
  - [createEncodeState](#createencodestate)
- [Types](#types)
  - [InputFormat](#inputformat)
  - [OutputFormat](#outputformat)
  - [EncodeConfig](#encodeconfig)
  - [EncodeResult](#encoderesult)
  - [EncodeState](#encodestate)
  - [TemplateFormat](#templateformat)
  - [FormatterFn](#formatterfn)
- [Input Format Details](#input-format-details)
  - [UUID](#uuid)
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
function encode(text: string, config: EncodeConfig, state?: EncodeState): EncodeResult;
```

Replace identifiers in text with short placeholders.

**Parameters:**

- `text` - Input text containing identifiers
- `config` - Configuration object specifying input and output formats
- `state` - Optional shared state, so several calls number their placeholders in one sequence and give one identifier the same placeholder everywhere. See [createEncodeState](#createencodestate).

**Returns:** `EncodeResult` with encoded text and mapping. When `state` is passed, `mapping` is the shared mapping and carries every identifier seen so far, not only the ones in `text`.

**Example:**

```typescript
const result = encode("User 123e4567-e89b-42d3-a456-426655440000 logged in", {
  inputFormat: "UUID",
  outputFormat: "Numeric",
});
// result.encoded: "User 000 logged in"
// result.mapping: { "000": "123e4567-e89b-42d3-a456-426655440000" }
```

---

### decode

```typescript
function decode(text: string, mapping: Record<string, string>): string;
```

Restore original identifiers from placeholders.

**Parameters:**

- `text` - Text containing placeholders
- `mapping` - Mapping from `encode()` result

**Returns:** Text with original identifiers restored

**Example:**

```typescript
const decoded = decode("User 000 logged in", {
  "000": "123e4567-e89b-42d3-a456-426655440000",
});
// decoded: "User 123e4567-e89b-42d3-a456-426655440000 logged in"
```

---

### findPlaceholders

```typescript
function findPlaceholders(text: string, format: OutputFormat): string[];
```

Return the distinct tokens in `text` that carry the output format's delimiters and hold nothing but the characters it writes between them, in order of first appearance.

**Parameters:**

- `text` - Text to scan, usually a model's response
- `format` - The output format the placeholders were written in

**Returns:** The tokens found. Any that are not keys of the mapping are candidates the model invented, and that includes a body the format would have written differently, such as `~5~` against `~005~`. A doubled delimiter, as in markdown strikethrough (`~~120~~`), does not count. `Numeric`, `IdToken` and `Passthrough` always return `[]`, since their placeholders look like ordinary numbers and words.

A template is read for the literals around its index, so its affixes are exact at any pad width. A formatter function cannot be read, so it is probed at four spread indices, the widest 16 digits, and one that throws on those indices returns `[]`.

One padded wider than 16 digits counts its own leading zeros into the prefix. It still finds a token that starts with them and misses one whose index is long enough not to, which is the invention the scan is for. Against `ID00000000000000000007` and `ID99999999999999999999`, `{ template: 'ID{i:020}' }` returns both and `(i) => 'ID' + String(i).padStart(20, '0')` returns only the first.

**Example:**

```typescript
// mapping came from encode()
// `in` walks the prototype chain, so a token spelling `__proto__`, `constructor` or `toString`
// would read as one this call minted and the invention would be dropped
const invented = findPlaceholders(llmResponse, "SafeNumeric").filter(
  (p) => !Object.prototype.hasOwnProperty.call(mapping, p)
);
// ["~053~"]
```

---

### createEncodeState

```typescript
function createEncodeState(): EncodeState;
```

Create the state that lets several `encode` calls share one numbering and one mapping. Encoding a conversation message by message without it restarts at index 0 each time, so the same identifier gets a different placeholder in each message and one placeholder stands for different identifiers.

**Returns:** `EncodeState` to pass to every `encode` call that belongs together

**Example:**

```typescript
const state = createEncodeState();

const first = encode("User 123e4567-e89b-42d3-a456-426655440000 logged in", config, state);
const second = encode("User 123e4567-e89b-42d3-a456-426655440000 paid", config, state);
// first.encoded:  "User 000 logged in"
// second.encoded: "User 000 paid"
// state.mapping:  { "000": "123e4567-e89b-42d3-a456-426655440000" }

decode(second.encoded, state.mapping);
```

---

## Types

### InputFormat

```typescript
type InputFormat = "UUID" | "ULID" | RegExp;
```

Specifies how to detect identifiers in the input text.

| Value    | Description                                   |
| -------- | --------------------------------------------- |
| `'UUID'` | Match RFC 4122 UUID version 4                 |
| `'ULID'` | Match ULID (26-char Crockford Base32)         |
| `RegExp` | Custom pattern (global flag added if missing) |

---

### OutputFormat

```typescript
type OutputFormat =
  "SafeNumeric" | "Numeric" | "IdToken" | "Passthrough" | TemplateFormat | FormatterFn;
```

Specifies how to generate placeholder strings.

| Value                       | Description                                       |
| --------------------------- | ------------------------------------------------- |
| `'SafeNumeric'`             | Tilde-delimited: `~000~`, `~001~`                 |
| `'Numeric'`                 | Smart triplet: `000`, `001`, ..., `999`, `001000` |
| `'IdToken'`                 | Base62: `0`, `A`, `z`, `10`                       |
| `'Passthrough'`             | No replacement (returns original text)            |
| `{ template: string }`      | Template with format specifiers                   |
| `(index: number) => string` | Custom formatter function                         |

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

| Property  | Description                                         |
| --------- | --------------------------------------------------- |
| `encoded` | Text with identifiers replaced by placeholders      |
| `mapping` | Object mapping placeholders to original identifiers |

---

### EncodeState

```typescript
interface EncodeState {
  idToPlaceholder: Map<string, string>;
  mapping: Record<string, string>;
}
```

The shared numbering and mapping behind a run of `encode` calls. Create it with [createEncodeState](#createencodestate) and treat its fields as read-only; `encode` writes to them.

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
type FormatterFn = (index: number) => string;
```

Custom function that converts an index to a placeholder string.

---

## Input Format Details

### UUID

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
  outputFormat: "Numeric",
});

// Match custom codes
encode(text, {
  inputFormat: /[A-Z]{3}-\d{4}-[A-Z]{2}/g,
  outputFormat: "Numeric",
});
```

---

## Output Format Details

### Numeric

Smart triplet expansion for optimal tokenization.

| Index Range   | Width | Examples                          |
| ------------- | ----- | --------------------------------- |
| 0-999         | 3     | `000`, `001`, ..., `999`          |
| 1,000-999,999 | 6     | `001000`, `001001`, ..., `999999` |
| 1,000,000+    | 9     | `001000000`, ...                  |

**Why triplets?** LLM tokenizers typically split numbers at 3-digit boundaries. Smart expansion keeps placeholders as 1-2 tokens.

---

### IdToken

Base62 encoding using alphabet `0-9A-Za-z`.

| Index | Output          |
| ----- | --------------- |
| 0-9   | `0`-`9`         |
| 10-35 | `A`-`Z`         |
| 36-61 | `a`-`z`         |
| 62+   | `10`, `11`, ... |

**Compact but less predictable** - use when minimizing character count matters more than consistent tokenization.

---

### Passthrough

Returns original text unchanged with empty mapping. Useful for testing or conditional encoding.

```typescript
const result = encode(text, {
  inputFormat: "UUID",
  outputFormat: "Passthrough",
});
// result.encoded === text
// result.mapping === {}
```

---

### Template Strings

Format: `{ template: string }` where string contains `{i}` or `{i:specifier}`.

**Format specifiers:**

| Specifier    | Description          | Examples                     |
| ------------ | -------------------- | ---------------------------- |
| `{i}`        | Plain numeric        | `0`, `1`, `2`, ...           |
| `{i:02}`     | Zero-pad to 2 digits | `00`, `01`, ..., `99`, `100` |
| `{i:03}`     | Zero-pad to 3 digits | `000`, `001`, ...            |
| `{i:04}`     | Zero-pad to 4 digits | `0000`, `0001`, ...          |
| `{i:base62}` | Base62 encoding      | `0`, `A`, `z`, `10`, ...     |

**Examples:**

```typescript
// XML-style tags
{
  template: "<id>{i}</id>";
} // <id>0</id>, <id>1</id>

// Bracketed with padding
{
  template: "[ID:{i:04}]";
} // [ID:0000], [ID:0001]

// Base62 in custom format
{
  template: "${i:base62}";
} // $0, $A, $z, $10
```

---

### Custom Functions

Full control over placeholder generation.

```typescript
type FormatterFn = (index: number) => string;
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
const result = encode("User ABC logged in. User ABC logged out.", {
  inputFormat: /ABC/g,
  outputFormat: "Numeric",
});
// result.encoded: "User 000 logged in. User 000 logged out."
// result.mapping: { "000": "ABC" }  // Only one entry, in the case it was written in
```

---

### Case Normalization

Deduplication ignores case, and the mapping holds each identifier as it was written:

- `123E4567-...` and `123e4567-...` map to the same placeholder
- Decoded text carries the casing the first occurrence used, so a ULID comes back uppercase

A reverse map built from `Object.values(mapping)` now holds the identifier as it was written, so lowercase it when the map is built rather than when it is read:

```typescript
const placeholderFor = new Map<string, string>();
for (const [placeholder, id] of Object.entries(result.mapping)) {
  placeholderFor.set(id.toLowerCase(), placeholder);
}
```

```typescript
const result = encode("ID: 123E4567-E89B-42D3-A456-426655440000", {
  inputFormat: "UUID",
  outputFormat: "Numeric",
});
// result.mapping: { "000": "123E4567-E89B-42D3-A456-426655440000" }
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

| Input                | Behavior                                 |
| -------------------- | ---------------------------------------- |
| Empty string         | Returns `{ encoded: "", mapping: {} }`   |
| No matches           | Returns original text with empty mapping |
| Only whitespace      | Returns original text with empty mapping |
| Unicode text         | Works correctly, only IDs are replaced   |
| Overlapping patterns | First match wins (left-to-right)         |

---

## Error Handling

### Invalid Template

Templates must contain `{i}` or `{i:specifier}`.

```typescript
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "no_placeholder" },
});
// Throws: Error: Invalid template "no_placeholder": must contain {i} or {i:specifier}
```

### Invalid RegExp

If a custom RegExp is invalid, the JavaScript engine throws a `SyntaxError` at RegExp construction time (before `encode` is called).

### Empty Input Match

An input format that can match the empty string is refused, because it matches between every pair of characters.

```typescript
encode("ab12cd", { inputFormat: /\d*/g, outputFormat: "SafeNumeric" });
// Throws: Error: The input format /\d*/g matched the empty string. An input format has to match at least one character.
```

### Empty Placeholder

An output format that returns an empty string, or anything that is not a string, is refused, because the identifier would vanish from the prompt and its mapping key would match everywhere.

```typescript
encode(text, { inputFormat: "UUID", outputFormat: () => "" });
// Throws: Error: The output format returned "" for index 0. A placeholder must be a non-empty string.
```

### Empty Mapping Key

`decode` refuses a mapping with an empty key, for the same reason.

```typescript
decode("hello", { "": "X" });
// Throws: Error: The mapping has an empty placeholder key, which matches at every position.
```

### Unknown Format Specifier

Unknown format specifiers fall back to plain numeric:

```typescript
encode(text, {
  inputFormat: "UUID",
  outputFormat: { template: "{i:unknown}" },
});
// Uses plain numeric: 0, 1, 2, ...
```
