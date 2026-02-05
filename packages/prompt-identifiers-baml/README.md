# prompt-identifiers-baml

BAML wrapper for automatic ID encoding/decoding in LLM function calls. Reduces token usage by up to 90% for UUIDs and ULIDs.

## Installation

```bash
npm install prompt-identifiers-baml prompt-identifiers @boundaryml/baml
```

## Quick Start

```typescript
import { wrapBamlFunction } from 'prompt-identifiers-baml';
import { b } from './baml_client';

// Wrap your BAML function
const analyzeUser = wrapBamlFunction(b.AnalyzeUser, {
  config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
});

// Use normally - IDs are automatically encoded/decoded
const result = await analyzeUser({
  user_id: '123e4567-e89b-42d3-a456-426655440000',
  items: [
    { id: '987fcdeb-51a2-43f7-8d9c-0123456789ab', name: 'Order 1' },
  ],
});

// The BAML function receives:
// { user_id: '<000>', items: [{ id: '<001>', name: 'Order 1' }] }
//
// You receive the response with original UUIDs restored
```

## How It Works

1. **Before BAML call**: Deep traverses input object and encodes all ID fields
   - `123e4567-e89b-42d3-a456-426655440000` → `<000>`

2. **After BAML call**: Deep traverses output object and decodes all placeholders
   - `<000>` → `123e4567-e89b-42d3-a456-426655440000`

This is completely transparent - you work with real IDs, the LLM works with compact placeholders.

## Configuration

```typescript
wrapBamlFunction(fn, {
  // Required: encoding configuration
  config: {
    inputFormat: 'UUID',      // or 'ULID' or custom RegExp
    outputFormat: 'SafeNumeric', // or 'Numeric', 'IdToken', { template: '...' }
  },

  // Optional: specify which fields to encode
  // If not provided, all matching strings are encoded
  encodeFields: ['user_id', 'items[].id', 'metadata.owner_id'],

  // Optional: callbacks for logging/debugging
  onEncode: (result) => {
    console.log(`Encoded ${result.encodedCount} IDs`);
    console.log('Mapping:', result.mapping);
  },
  onDecode: (result) => {
    console.log(`Decoded ${result.decodedCount} placeholders`);
  },
});
```

### Field Path Syntax

The `encodeFields` option supports dot notation and array wildcards:

| Pattern | Description | Example Match |
|---------|-------------|---------------|
| `user_id` | Top-level field | `{ user_id: '...' }` |
| `data.user_id` | Nested field | `{ data: { user_id: '...' } }` |
| `items[].id` | Array item field | `{ items: [{ id: '...' }] }` |
| `data.users[].profile.id` | Deep nested | `{ data: { users: [{ profile: { id: '...' } }] } }` |

### Input Formats

| Format | Description | Example |
|--------|-------------|---------|
| `'UUID'` | RFC 4122 UUIDs | `123e4567-e89b-42d3-a456-426655440000` |
| `'ULID'` | Crockford Base32 ULIDs | `01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| `RegExp` | Custom pattern | `/user-\d{6}/gi` |

### Output Formats

| Format | Description | Example |
|--------|-------------|---------|
| `'SafeNumeric'` | Collision-safe with angle brackets (recommended) | `<000>`, `<001>` |
| `'Numeric'` | Simple numeric with smart triplet expansion | `000`, `001` |
| `'IdToken'` | Base62 encoding | `0`, `A`, `z`, `10` |
| `{ template: '...' }` | Custom template | `{ template: '[ID:{i}]' }` → `[ID:0]` |

## Streaming Support

Use `wrapBamlStreamingFunction` for BAML streaming functions:

```typescript
import { wrapBamlStreamingFunction } from 'prompt-identifiers-baml';
import { b } from './baml_client';

const streamAnalysis = wrapBamlStreamingFunction(b.stream.AnalyzeUser, {
  config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
});

// IDs are decoded in real-time as partials arrive
for await (const partial of streamAnalysis({ user_id: uuid })) {
  console.log(partial);
}
```

## Utility Functions

### encodeObject

Manually encode an object (useful for custom integrations):

```typescript
import { encodeObject } from 'prompt-identifiers-baml';

const { encoded, mapping } = encodeObject(
  { user_id: 'uuid-here', data: { owner: 'other-uuid' } },
  { inputFormat: 'UUID', outputFormat: 'SafeNumeric' }
);

// encoded: { user_id: '<000>', data: { owner: '<001>' } }
// mapping: { '<000>': 'uuid-here', '<001>': 'other-uuid' }
```

### decodeObject

Manually decode an object:

```typescript
import { decodeObject } from 'prompt-identifiers-baml';

const decoded = decodeObject(
  { user_id: '<000>', summary: 'User <000> is active' },
  { '<000>': 'uuid-here' }
);

// decoded: { user_id: 'uuid-here', summary: 'User uuid-here is active' }
```

## Type Safety

The wrapper preserves BAML's TypeScript types:

```typescript
// BAML-generated types are preserved
const analyzeUser = wrapBamlFunction(b.AnalyzeUser, { config });

// TypeScript knows the input/output types
const result: AnalyzeUserOutput = await analyzeUser({
  user_id: '...',  // Type-checked
  items: [...],
});
```

## Auto-Detection vs Explicit Fields

**Auto-detection mode** (no `encodeFields`):
- Encodes ALL string fields matching the input pattern
- Simple to use, works for most cases
- May encode fields you don't want encoded

**Explicit fields** (with `encodeFields`):
- Only encodes specified fields
- More precise control
- Recommended for production use

```typescript
// Auto-detection: all UUIDs encoded
const wrapped1 = wrapBamlFunction(fn, {
  config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
});

// Explicit: only user_id and item IDs encoded
const wrapped2 = wrapBamlFunction(fn, {
  config: { inputFormat: 'UUID', outputFormat: 'SafeNumeric' },
  encodeFields: ['user_id', 'items[].id'],
});
```

## Peer Dependencies

- `prompt-identifiers` >= 0.1.0
- `@boundaryml/baml` >= 0.70.0 (optional)

## License

MIT
