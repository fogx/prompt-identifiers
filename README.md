# prompt-identifiers

Efficient, reversible ID compression for LLM prompts - reduce AI token usage by up to 90%.

This is the **native JavaScript/TypeScript implementation** with zero runtime dependencies.

## Quick Start

```bash
cd packages/prompt-identifiers-js
npm install
npm test
npm run build
```

## Documentation

See [packages/prompt-identifiers-js/README.md](packages/prompt-identifiers-js/README.md) for full API documentation.

## Usage

```typescript
import { encode, decode } from 'prompt-identifiers';

const result = encode(
  'User 123e4567-e89b-42d3-a456-426655440000 requested access',
  { inputFormat: 'UUIDv4', outputFormat: 'Numeric' }
);
// result.encoded: "User 000 requested access"
// result.mapping: { "000": "123e4567-e89b-42d3-a456-426655440000" }

const restored = decode(result.encoded, result.mapping);
// "User 123e4567-e89b-42d3-a456-426655440000 requested access"
```

## License

MIT
