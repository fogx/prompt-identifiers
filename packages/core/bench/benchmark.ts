/**
 * Benchmarks for prompt-identifiers
 *
 * Run with: npx tsx bench/benchmark.ts
 */

import { encode, decode, EncodeConfig, OutputFormat } from '../src/index';

// =============================================================================
// Test Data Generation
// =============================================================================

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const section = (n: number) => Array.from({ length: n }, hex).join('');
  return `${section(8)}-${section(4)}-4${section(3)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${section(3)}-${section(12)}`;
}

function generateULID(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let result = alphabet[Math.floor(Math.random() * 8)];
  for (let i = 1; i < 26; i++) {
    result += alphabet[Math.floor(Math.random() * 32)];
  }
  return result;
}

function generatePrompt(count: number, generator: () => string): string {
  const ids = Array.from({ length: count }, generator);
  return ids.map((id, i) => `Item ${i}: ${id}`).join('\n');
}

// =============================================================================
// Benchmark Utilities
// =============================================================================

interface BenchResult {
  name: string;
  count: number;
  encodeUs: number;
  decodeUs: number;
  roundtripUs: number;
}

function benchmark(
  name: string,
  text: string,
  config: EncodeConfig,
  iterations: number = 1000
): Omit<BenchResult, 'count'> {
  // Warmup
  for (let i = 0; i < 100; i++) {
    const { encoded, mapping } = encode(text, config);
    decode(encoded, mapping);
  }

  // Benchmark encode
  const encodeStart = performance.now();
  let mapping: Record<string, string> = {};
  let encoded = '';
  for (let i = 0; i < iterations; i++) {
    const result = encode(text, config);
    encoded = result.encoded;
    mapping = result.mapping;
  }
  const encodeEnd = performance.now();
  const encodeUs = ((encodeEnd - encodeStart) / iterations) * 1000;

  // Benchmark decode
  const decodeStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    decode(encoded, mapping);
  }
  const decodeEnd = performance.now();
  const decodeUs = ((decodeEnd - decodeStart) / iterations) * 1000;

  return {
    name,
    encodeUs: Math.round(encodeUs * 100) / 100,
    decodeUs: Math.round(decodeUs * 100) / 100,
    roundtripUs: Math.round((encodeUs + decodeUs) * 100) / 100,
  };
}

function formatTable(results: BenchResult[]): string {
  const header = '| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |';
  const separator = '|-----|-------------|-------------|----------------|';
  const rows = results.map(
    (r) =>
      `| ${r.count.toString().padStart(4)} | ${r.encodeUs.toFixed(2).padStart(11)} | ${r.decodeUs.toFixed(2).padStart(11)} | ${r.roundtripUs.toFixed(2).padStart(14)} |`
  );
  return [header, separator, ...rows].join('\n');
}

// =============================================================================
// Run Benchmarks
// =============================================================================

const ID_COUNTS = [1, 5, 10, 30, 50, 100, 300, 500, 1000];

console.log('# prompt-identifiers Benchmarks\n');
console.log(`Node.js ${process.version}`);
console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`);

// -----------------------------------------------------------------------------
// Part 1: Output Format Comparison (same input: UUIDv4)
// -----------------------------------------------------------------------------

console.log('## Part 1: Output Format Comparison\n');
console.log('Using identical UUIDv4 test data for fair comparison.\n');

const outputFormats: { name: string; format: OutputFormat }[] = [
  { name: 'Numeric', format: 'Numeric' },
  { name: 'IdToken (base62)', format: 'IdToken' },
  { name: 'Template {i:03}', format: { template: '<{i:03}>' } },
  { name: 'Template {i:base62}', format: { template: '<{i:base62}>' } },
  { name: 'Function', format: (i) => `[${i}]` },
];

// Generate test data once for fair comparison
const uuidTestData: Record<number, string> = {};
for (const count of ID_COUNTS) {
  uuidTestData[count] = generatePrompt(count, generateUUID);
}

for (const { name, format } of outputFormats) {
  console.log(`### UUIDv4 → ${name}\n`);

  const results: BenchResult[] = [];
  for (const count of ID_COUNTS) {
    const text = uuidTestData[count];
    const result = benchmark(name, text, { inputFormat: 'UUIDv4', outputFormat: format });
    results.push({ ...result, count });
  }

  console.log(formatTable(results));
  console.log('');
}

// -----------------------------------------------------------------------------
// Part 2: Input Format Comparison (same output: Numeric)
// -----------------------------------------------------------------------------

console.log('## Part 2: Input Format Comparison\n');
console.log('Note: Different input formats require different test data.\n');
console.log('- UUIDv4: 36-char IDs, complex regex pattern');
console.log('- ULID: 26-char IDs, simpler pattern');
console.log('- Custom regex patterns vary in complexity\n');

// UUIDv4
console.log('### UUIDv4 (36 chars, complex pattern)\n');
{
  const results: BenchResult[] = [];
  for (const count of ID_COUNTS) {
    const text = uuidTestData[count];
    const result = benchmark('UUIDv4', text, { inputFormat: 'UUIDv4', outputFormat: 'Numeric' });
    results.push({ ...result, count });
  }
  console.log(formatTable(results));
  console.log('');
}

// ULID
console.log('### ULID (26 chars, medium pattern)\n');
{
  const results: BenchResult[] = [];
  for (const count of ID_COUNTS) {
    const text = generatePrompt(count, generateULID);
    const result = benchmark('ULID', text, { inputFormat: 'ULID', outputFormat: 'Numeric' });
    results.push({ ...result, count });
  }
  console.log(formatTable(results));
  console.log('');
}

// Custom regex matching UUIDs (to isolate regex complexity)
console.log('### Custom Regex matching UUIDs (simpler pattern, same data)\n');
console.log('Pattern: `/[0-9a-f-]{36}/gi` (no version/variant validation)\n');
{
  const simpleUuidRegex = /[0-9a-f-]{36}/gi;
  const results: BenchResult[] = [];
  for (const count of ID_COUNTS) {
    const text = uuidTestData[count]; // Same UUID test data!
    const result = benchmark('Simple UUID regex', text, { inputFormat: simpleUuidRegex, outputFormat: 'Numeric' });
    results.push({ ...result, count });
  }
  console.log(formatTable(results));
  console.log('');
}

// -----------------------------------------------------------------------------
// Part 3: Summary
// -----------------------------------------------------------------------------

console.log('## Summary: Roundtrip at 100 IDs\n');

console.log('### Output Formats (UUIDv4 input)\n');
console.log('| Format | Time (μs) |');
console.log('|--------|-----------|');

const text100 = uuidTestData[100];
for (const { name, format } of outputFormats) {
  const result = benchmark(name, text100, { inputFormat: 'UUIDv4', outputFormat: format });
  console.log(`| ${name.padEnd(20)} | ${result.roundtripUs.toFixed(2).padStart(9)} |`);
}

console.log('\n### Input Formats (Numeric output)\n');
console.log('| Format | Time (μs) | Notes |');
console.log('|--------|-----------|-------|');

const uuidResult = benchmark('UUIDv4', text100, { inputFormat: 'UUIDv4', outputFormat: 'Numeric' });
console.log(`| UUIDv4 | ${uuidResult.roundtripUs.toFixed(2).padStart(9)} | 36-char IDs, complex pattern |`);

const ulidText100 = generatePrompt(100, generateULID);
const ulidResult = benchmark('ULID', ulidText100, { inputFormat: 'ULID', outputFormat: 'Numeric' });
console.log(`| ULID | ${ulidResult.roundtripUs.toFixed(2).padStart(9)} | 26-char IDs, simpler pattern |`);

const simpleResult = benchmark('Simple regex', text100, { inputFormat: /[0-9a-f-]{36}/gi, outputFormat: 'Numeric' });
console.log(`| Simple UUID regex | ${simpleResult.roundtripUs.toFixed(2).padStart(9)} | Same data, simpler pattern |`);
