# prompt-identifiers-baml

BAML wrapper for automatic ID encoding/decoding in LLM function calls. Reduces token usage by up to 90% for UUIDs and ULIDs.

> **Experimental:** This package has not been tested in production. The API works and passes tests, but real-world BAML integration may surface edge cases. Please [report issues](https://github.com/fogx/prompt-identifiers/issues) if you encounter any.

## Installation

```bash
npm install prompt-identifiers-baml prompt-identifiers @boundaryml/baml
```

## Quick Start

```typescript
import { wrapBamlFunction } from "prompt-identifiers-baml";
import { b } from "./baml_client";

// Wrap your BAML function
const analyzeUser = wrapBamlFunction(b.AnalyzeUser, {
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
});

// Use normally - IDs are automatically encoded/decoded
const result = await analyzeUser({
  user_id: "123e4567-e89b-42d3-a456-426655440000",
  items: [{ id: "987fcdeb-51a2-43f7-8d9c-0123456789ab", name: "Order 1" }],
});

// The BAML function receives:
// { user_id: '~000~', items: [{ id: '~001~', name: 'Order 1' }] }
//
// You receive the response with original UUIDs restored
```

## How It Works

1. **Before BAML call**: Deep traverses input object and encodes all ID fields, and object keys when `encodeKeys` is on
   - `123e4567-e89b-42d3-a456-426655440000` → `~000~`

2. **After BAML call**: Deep traverses output object and decodes all placeholders
   - `~000~` → `123e4567-e89b-42d3-a456-426655440000`

This is completely transparent - you work with real IDs, the LLM works with compact placeholders.

## Configuration

```typescript
wrapBamlFunction(fn, {
  // Required: encoding configuration
  config: {
    inputFormat: "UUID", // or 'ULID' or custom RegExp
    outputFormat: "SafeNumeric", // or 'Numeric', 'IdToken', { template: '...' }
  },

  // Optional: specify which fields to encode
  // If not provided, all matching strings are encoded
  encodeFields: ["user_id", "items[].id", "metadata.owner_id"],

  // Optional: enable debug mode for detailed diagnostics
  debug: true,

  // Optional: callbacks for logging/debugging
  onEncode: (result) => {
    console.log("Mapping:", result.mapping);
    // debugData is only present when debug: true
    if (result.debugData) {
      console.log(
        `Encoded ${result.debugData.encodedCount} IDs in ${result.debugData.durationMs}ms`
      );
    }
  },
  onDecode: (result) => {
    if (result.debugData) {
      console.log(
        `Decoded ${result.debugData.decodedCount} placeholders in ${result.debugData.durationMs}ms`
      );
    }
  },
});
```

### Field Path Syntax

The `encodeFields` option supports dot notation and array wildcards:

| Pattern                   | Description      | Example Match                                       |
| ------------------------- | ---------------- | --------------------------------------------------- |
| `user_id`                 | Top-level field  | `{ user_id: '...' }`                                |
| `data.user_id`            | Nested field     | `{ data: { user_id: '...' } }`                      |
| `items[].id`              | Array item field | `{ items: [{ id: '...' }] }`                        |
| `data.users[].profile.id` | Deep nested      | `{ data: { users: [{ profile: { id: '...' } }] } }` |

### Input Formats

| Format   | Description            | Example                                |
| -------- | ---------------------- | -------------------------------------- |
| `'UUID'` | RFC 4122 UUIDs         | `123e4567-e89b-42d3-a456-426655440000` |
| `'ULID'` | Crockford Base32 ULIDs | `01ARZ3NDEKTSV4RRFFQ69G5FAV`           |
| `RegExp` | Custom pattern         | `/user-\d{6}/gi`                       |

### Output Formats

| Format                | Description                                 | Example                               |
| --------------------- | ------------------------------------------- | ------------------------------------- |
| `'SafeNumeric'`       | Collision-safe with tildes (recommended)    | `~000~`, `~001~`                      |
| `'Numeric'`           | Simple numeric with smart triplet expansion | `000`, `001`                          |
| `'IdToken'`           | Base62 encoding                             | `0`, `A`, `z`, `10`                   |
| `{ template: '...' }` | Custom template                             | `{ template: '[ID:{i}]' }` → `[ID:0]` |

## Streaming Support

Use `wrapBamlStreamingFunction` for BAML streaming functions:

```typescript
import { wrapBamlStreamingFunction } from "prompt-identifiers-baml";
import { b } from "./baml_client";

const streamAnalysis = wrapBamlStreamingFunction(b.stream.AnalyzeUser, {
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
});

const stream = streamAnalysis({ user_id: uuid });

// IDs are decoded in real-time as partials arrive
for await (const partial of stream) {
  console.log(partial);
}

const final = await stream.getFinalResponse();
```

The wrapper mirrors what it was given: pass `b.stream.<Fn>`, which returns a `BamlStream`, and you get a stream back with the same `getFinalResponse()` and the same `toStreamable()`, whose newline-delimited JSON carries the decoded partials and the decoded final. Pass a plain async generator and you get an async generator, whose return value is the decoded final.

`getFinalResponse()` decodes once however often it is called, and `onDecode` fires once per stream, where the consumption that finishes first ends: at the end of the loop, at `getFinalResponse()` for a consumer that calls it without iterating, or at the error that ends either one. Its counts cover what had been decoded by then. Iterating and then asking for the final counts both; asking for the final first counts the final alone; a generation that dies part way through counts the partials the consumer already read. A consumer that breaks out of the loop early is not reported to, because it stopped reading rather than finished.

## Utility Functions

### Keys

An input keyed by identifier, such as a BAML `map<string, T>`, sends the whole id to the model unless the key is encoded too. Pass `encodeKeys: true` to encode keys:

```typescript
const wrapped = wrapBamlFunction(b.AnalyzeUsers, {
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  encodeKeys: true,
});
// { byId: { "123e4567-e89b-42d3-a456-426655440000": "active" } }
//   reaches the model as { byId: { "~000~": "active" } }
```

It is off by default because nothing at runtime tells a map key from a class's own field name, so a custom input format matching a field name would rewrite the class's shape. It is ignored when `encodeFields` is given, because a field path names a value. Two keys that encode to one placeholder are refused rather than collapsed.

An ordinary key becomes one of that pair under a non-delimited format. `Numeric` mints `"000"` and `IdToken` mints `"0"`, which are keys a caller writes for their own reasons, so an object holding both an identifier and a key spelled that way is refused. A delimited format needs the key written as `~000~` before it collides. The same spelling collides on the way back: a key or a value carrying a bare digit run is rewritten on decode, because nothing tells it from a placeholder.

`IdToken` also moves the key it encodes. Its placeholder for a low index is a canonical integer string, and JavaScript orders an object's integer-like keys first and in ascending order whatever the insertion order was, so `{ alpha, <id>, beta }` reaches the model as `{ "0", alpha, beta }` and comes back in that order. Use a delimited format where the key order carries meaning.

Decoding reads keys either way, since a key only changes when it matches a placeholder the call minted. Two keys that decode to one identifier are refused rather than collapsed, the same as on the way out.

### What is walked

A value is walked when its state is in its own enumerable keys. A `Date`, a `Map`, a `Set`, a `RegExp`, a `Promise`, an `Error` and a typed array keep theirs in internal slots that no rebuild can copy, and each says so through its own `Object.prototype.toString` tag, whether or not it also carries a field. A BAML media argument (`image`, `audio`, `pdf`, `video`) is a native handle with no tag and no keys. All of them reach the function as themselves, and an identifier inside one reaches the model as it is written and is not in the mapping. An object that gives itself a `Symbol.toStringTag` is read the same way, so keep identifiers out of one.

Everything else is walked and rebuilt on its own prototype, so a class instance and a record built with no prototype have their identifiers encoded and keep their methods and their type. What a rebuild cannot carry is state that is not an own enumerable field: a `#private` field is gone from the copy, and a `Proxy` is read through to its target. Pass either of those as a field of a plain record, not as the record itself.

`encodeObject` takes the same switch as its fourth argument: `encodeObject(obj, config, undefined, true)`.

### encodeObject

Manually encode an object (useful for custom integrations):

```typescript
import { encodeObject } from "prompt-identifiers-baml";

const { encoded, mapping } = encodeObject(
  {
    user_id: "123e4567-e89b-42d3-a456-426655440000",
    data: { owner: "987fcdeb-51a2-43f7-8d9c-0123456789ab" },
  },
  { inputFormat: "UUID", outputFormat: "SafeNumeric" }
);

// encoded: { user_id: '~000~', data: { owner: '~001~' } }
// mapping: { '~000~': '123e4567-e89b-42d3-a456-426655440000', '~001~': '987fcdeb-51a2-43f7-8d9c-0123456789ab' }
```

### decodeObject

Manually decode an object:

```typescript
import { decodeObject } from "prompt-identifiers-baml";

const decoded = decodeObject(
  { user_id: "~000~", summary: "User ~000~ is active" },
  { "~000~": "123e4567-e89b-42d3-a456-426655440000" }
);

// decoded: { user_id: '123e4567-e89b-42d3-a456-426655440000', summary: 'User 123e4567-e89b-42d3-a456-426655440000 is active' }
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

- Encodes ALL string fields matching the input pattern, and object keys too when `encodeKeys` is on
- Simple to use, works for most cases
- May encode fields you don't want encoded

**Explicit fields** (with `encodeFields`):

- Only encodes specified fields
- More precise control
- Recommended for production use
- Leaves object keys alone whatever `encodeKeys` says, because a field path names a value. An input keyed by identifier needs auto-detection mode.

```typescript
// Auto-detection: all UUIDs encoded
const wrapped1 = wrapBamlFunction(fn, {
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
});

// Explicit: only user_id and item IDs encoded
const wrapped2 = wrapBamlFunction(fn, {
  config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  encodeFields: ["user_id", "items[].id"],
});
```

## License

MIT
