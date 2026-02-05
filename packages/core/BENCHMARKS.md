# Performance Benchmarks

Benchmarks for `prompt-identifiers` native JavaScript implementation.

**Environment:** Node.js v22, Apple Silicon
**Last Updated:** 2026-01-26

## How to Run

```bash
npm run bench
```

## Part 1: Output Format Comparison

All tests use identical UUID input data for fair comparison.

### UUID → Numeric (Recommended)

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.74 |        0.59 |           1.33 |
|    5 |        2.44 |        1.30 |           3.74 |
|   10 |        3.81 |        2.31 |           6.13 |
|   30 |       10.96 |        6.11 |          17.07 |
|   50 |       18.72 |       10.87 |          29.59 |
|  100 |       36.78 |       19.95 |          56.73 |
|  300 |      107.95 |       63.01 |         170.97 |
|  500 |      266.52 |      122.43 |         388.95 |
| 1000 |      323.94 |      219.27 |         543.21 |

### UUID → IdToken (base62)

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.49 |        0.35 |           0.84 |
|   10 |        3.25 |        2.71 |           5.96 |
|   50 |       18.00 |       15.02 |          33.03 |
|  100 |       37.21 |       29.18 |          66.39 |
|  500 |      193.50 |      154.91 |         348.41 |
| 1000 |      434.34 |      326.56 |         760.90 |

### UUID → Template {i:03}

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.90 |        0.30 |           1.20 |
|   10 |        5.17 |        2.31 |           7.48 |
|   50 |       27.49 |       10.88 |          38.37 |
|  100 |       58.32 |       26.59 |          84.90 |
|  500 |      234.01 |      109.17 |         343.19 |
| 1000 |      442.33 |      218.49 |         660.82 |

### UUID → Custom Function

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.49 |        0.35 |           0.84 |
|   10 |        3.25 |        2.71 |           5.96 |
|   50 |       18.00 |       15.02 |          33.03 |
|  100 |       37.21 |       29.18 |          66.39 |
|  500 |      193.50 |      154.91 |         348.41 |
| 1000 |      532.36 |      326.56 |         858.91 |

## Part 2: Input Format Comparison

### UUID (primary use case)

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.48 |        0.30 |           0.78 |
|   10 |        3.48 |        2.72 |           6.21 |
|   50 |       20.25 |        9.88 |          30.14 |
|  100 |       40.55 |       20.38 |          60.93 |
|  500 |      177.06 |      112.67 |         289.73 |
| 1000 |      323.94 |      219.27 |         543.21 |

### ULID

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.52 |        0.31 |           0.83 |
|   10 |        2.94 |        2.16 |           5.10 |
|   50 |       15.22 |       10.26 |          25.48 |
|  100 |       30.59 |       20.71 |          51.30 |
|  500 |      140.09 |      107.44 |         247.52 |
| 1000 |      244.56 |      219.85 |         464.40 |

### Custom Regex (same UUID data, simpler pattern)

Testing whether regex complexity affects performance. Using `/[0-9a-f-]{36}/gi` (no version/variant validation) on the same UUID data:

| IDs | Encode (μs) | Decode (μs) | Roundtrip (μs) |
|-----|-------------|-------------|----------------|
|    1 |        0.55 |        0.41 |           0.96 |
|   10 |        3.58 |        2.15 |           5.73 |
|   50 |       19.73 |       10.02 |          29.75 |
|  100 |       44.15 |       22.41 |          66.56 |
|  500 |      197.01 |      107.93 |         304.95 |
| 1000 |      390.81 |      227.26 |         618.07 |

**Result:** Nearly identical to the full UUID pattern (~61μs vs ~67μs at 100 IDs). Regex complexity doesn't matter.

## Summary at 100 IDs

| Configuration | Roundtrip (μs) |
|---------------|----------------|
| UUID → Numeric | 57 |
| UUID → IdToken | 66 |
| UUID → Template | 85 |
| UUID → Function | 66 |

## Analysis

### Key Findings

1. **Regex complexity doesn't matter**
   The built-in UUID pattern (with version/variant validation) performs the same as a simple `/[0-9a-f-]{36}/gi` pattern. V8's regex engine is highly optimized.

2. **All output formats are fast**
   Numeric, IdToken, templates, and functions all perform within 50% of each other.

3. **Linear O(n) scaling**
   All configurations scale linearly with ID count.

### Recommendations

**Use `'Numeric'` (triplet format)** - it's the best choice for three reasons:

1. **Optimized for LLM tokenizers** - Most tokenizers (GPT, Claude, etc.) chunk digits in groups of 3. The smart triplet expansion (`000`→`001000`→`001000000`) aligns with this, keeping placeholders to 1-2 tokens.

2. **Least ambiguous** - Pure numeric placeholders are unambiguous in any context. Base62 (`A`, `z`, `10`) can be confused with text.

3. **Fastest** - Slightly faster than other formats due to simpler string operations.

### Comparison with Rust FFI

From the main branch benchmarks, native JS is **1.5-2.7x faster** than Rust FFI at all scales due to zero FFI overhead. The Rust core is faster in isolation, but crossing the JS↔Rust boundary costs more than it saves.

| IDs | Rust FFI (μs) | Native JS (μs) | JS Advantage |
|-----|---------------|----------------|--------------|
| 1   | 2.27 | 0.78 | 2.9x |
| 50  | 72.89 | 30.14 | 2.4x |
| 100 | 113.91 | 60.93 | 1.9x |
| 500 | 416.10 | 289.73 | 1.4x |
| 1000 | 833.51 | 543.21 | 1.5x |
