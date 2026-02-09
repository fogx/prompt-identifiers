# prompt-identifiers-ai-sdk

Vercel AI SDK middleware for automatic ID encoding/decoding in LLM prompts. Reduces token usage by up to 90% for UUIDs and ULIDs.

## Installation

```bash
npm install prompt-identifiers-ai-sdk prompt-identifiers ai
```

## Quick Start

```typescript
import { openai } from "@ai-sdk/openai";
import { wrapLanguageModel, generateText } from "ai";
import { promptIdentifiersMiddleware } from "prompt-identifiers-ai-sdk";

// Wrap your model with the middleware
const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: promptIdentifiersMiddleware({
    config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
  }),
});

// Use normally - IDs are automatically encoded/decoded
const result = await generateText({
  model,
  prompt: "Summarize activity for user 123e4567-e89b-42d3-a456-426655440000",
});

// The LLM sees: "Summarize activity for user ~000~"
// You receive the response with original UUIDs restored
```

## How It Works

1. **Before LLM call**: The middleware encodes IDs in your prompt messages

   - `123e4567-e89b-42d3-a456-426655440000` → `~000~`

2. **After LLM call**: The middleware decodes IDs in the response
   - `~000~` → `123e4567-e89b-42d3-a456-426655440000`

This is completely transparent - you work with real IDs, the LLM works with compact placeholders.

## Configuration

```typescript
promptIdentifiersMiddleware({
  // Required: encoding configuration
  config: {
    inputFormat: "UUID", // or 'ULID' or custom RegExp
    outputFormat: "SafeNumeric", // or 'Numeric', 'IdToken', { template: '...' }
  },

  // Optional: enable debug mode for detailed diagnostics
  debug: true,

  // Optional: callbacks for logging/debugging
  onEncode: (result) => {
    console.log("Mapping:", result.mapping);
    // debugData is only present when debug: true
    if (result.debugData) {
      console.log(`Encoded ${result.debugData.encodedCount} IDs in ${result.debugData.durationMs}ms`);
    }
  },
  onDecode: (result) => {
    if (result.debugData) {
      console.log(`Decoded ${result.debugData.decodedCount} placeholders in ${result.debugData.durationMs}ms`);
      console.log("Input:", result.debugData.input);
      console.log("Output:", result.debugData.output);
    }
  },
});
```

### Input Formats

| Format   | Description            | Example                                |
| -------- | ---------------------- | -------------------------------------- |
| `'UUID'` | RFC 4122 UUIDs         | `123e4567-e89b-42d3-a456-426655440000` |
| `'ULID'` | Crockford Base32 ULIDs | `01ARZ3NDEKTSV4RRFFQ69G5FAV`           |
| `RegExp` | Custom pattern         | `/user-\d{6}/gi`                       |

### Output Formats

| Format                | Description                                       | Example                               |
| --------------------- | ------------------------------------------------- | ------------------------------------- |
| `'SafeNumeric'`       | Collision-safe with tildes (recommended)          | `~000~`, `~001~`                      |
| `'Numeric'`           | Simple numeric with smart triplet expansion       | `000`, `001`                          |
| `'IdToken'`           | Base62 encoding                                   | `0`, `A`, `z`, `10`                   |
| `{ template: '...' }` | Custom template                                   | `{ template: '[ID:{i}]' }` → `[ID:0]` |

## Streaming Support

> **Important:** For streaming responses, use a **delimited format** like `SafeNumeric` or a custom template with delimiters. Non-delimited formats (`Numeric`, `IdToken`) cannot reliably handle placeholders split across chunks.

The middleware buffers incomplete placeholders when using delimited formats like `SafeNumeric`:

```typescript
import { streamText } from "ai";

const result = await streamText({
  model, // wrapped model
  prompt: "Analyze user 123e4567-e89b-42d3-a456-426655440000",
});

for await (const chunk of result.textStream) {
  // IDs are decoded in real-time as the stream arrives
  console.log(chunk);
}
```

## Works With Any Provider

The middleware works with any AI SDK provider:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";

// Anthropic
const claudeModel = wrapLanguageModel({
  model: anthropic("claude-3-5-sonnet-20241022"),
  middleware: promptIdentifiersMiddleware({ config }),
});

// Google
const geminiModel = wrapLanguageModel({
  model: google("gemini-1.5-pro"),
  middleware: promptIdentifiersMiddleware({ config }),
});
```

## Multiple IDs

Duplicate IDs are automatically deduplicated:

```typescript
const prompt = `
  User 123e4567-e89b-42d3-a456-426655440000 sent a message.
  Check if 123e4567-e89b-42d3-a456-426655440000 is online.
  User 987fcdeb-51a2-43f7-8d9c-0123456789ab received it.
`;

// Encoded as:
// User ~000~ sent a message.
// Check if ~000~ is online.
// User ~001~ received it.
```

## Peer Dependencies

- `prompt-identifiers` >= 0.1.0
- `ai` >= 6.0.0
- `@ai-sdk/provider` >= 3.0.0

## License

MIT
