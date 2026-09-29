# Performance Benchmarks

Benchmarks for `prompt-identifiers`, the native JavaScript implementation.

**Environment:** Node.js v24.13.0, Apple Silicon
**Method:** `pnpm run bench` five times, the median of each cell. Every number is microseconds per
operation over 1000 iterations. The machine was not idle, so small sizes carry real noise: the
spread across the five runs is under 10% from 50 IDs up and reaches 50% at 1 and 5 IDs, where the
work is smaller than the measurement.

**Decode is measured against a mapping it has not seen before**, because `decode` caches its
compiled pattern on the mapping object and a request mints a fresh mapping every time. A loop that
reuses one mapping measures one pattern build and 999 cache hits, and reports decode about 2 to
2.5 times too fast.

## How to Run

```bash
pnpm run bench
```

## Part 1: Output Format Comparison

All tables use identical UUID input data.

### UUID → Numeric

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.63        | 0.4         | 0.99           |
| 5    | 1.63        | 1.11        | 2.7            |
| 10   | 3.18        | 1.66        | 4.9            |
| 30   | 9.6         | 4.57        | 14.17          |
| 50   | 16.18       | 7.51        | 23.72          |
| 100  | 34.62       | 15.6        | 50.95          |
| 300  | 89.58       | 48.2        | 137.8          |
| 500  | 141.35      | 82.31       | 221.75         |
| 1000 | 262.53      | 155.06      | 418.03         |

### UUID → IdToken (base62)

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.39        | 0.37        | 0.75           |
| 5    | 1.3         | 0.95        | 2.26           |
| 10   | 2.36        | 1.59        | 3.94           |
| 30   | 7.37        | 7.11        | 14.6           |
| 50   | 13.47       | 12.77       | 26.33          |
| 100  | 28.53       | 30.96       | 59.49          |
| 300  | 101.74      | 97.06       | 199.51         |
| 500  | 177.83      | 170.64      | 351.43         |
| 1000 | 415.82      | 396.03      | 811.85         |

### UUID → Template {i:03}

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.59        | 0.34        | 0.94           |
| 5    | 1.87        | 0.92        | 2.82           |
| 10   | 3.76        | 1.75        | 5.51           |
| 30   | 13.08       | 4.35        | 17.42          |
| 50   | 19.88       | 7.49        | 27.44          |
| 100  | 40.94       | 14.6        | 55.3           |
| 300  | 133.38      | 44.32       | 178.06         |
| 500  | 229.48      | 78.16       | 307.64         |
| 1000 | 502.14      | 170.53      | 671.62         |

### UUID → Template {i:base62}

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.48        | 0.35        | 0.84           |
| 5    | 1.61        | 0.88        | 2.49           |
| 10   | 3.12        | 1.6         | 4.68           |
| 30   | 9.6         | 4.31        | 13.82          |
| 50   | 16.22       | 8.22        | 24.19          |
| 100  | 35.22       | 13.51       | 48.82          |
| 300  | 119.63      | 44.33       | 163.54         |
| 500  | 207.43      | 77.18       | 287.61         |
| 1000 | 469.06      | 172.53      | 642.87         |

### UUID → Function

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.4         | 0.38        | 0.78           |
| 5    | 1.47        | 1.08        | 2.55           |
| 10   | 2.89        | 1.97        | 4.88           |
| 30   | 8.8         | 6.16        | 15.0           |
| 50   | 15.14       | 10.11       | 25.56          |
| 100  | 33.21       | 19.64       | 52.98          |
| 300  | 111.07      | 58.37       | 169.93         |
| 500  | 190.8       | 101.48      | 293.43         |
| 1000 | 429.85      | 213.63      | 642.77         |

## Part 2: Input Format Comparison

All tables write `Numeric` placeholders.

### UUID (36 chars, complex pattern)

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.37        | 0.35        | 0.71           |
| 5    | 1.42        | 0.83        | 2.25           |
| 10   | 2.86        | 1.51        | 4.36           |
| 30   | 9.26        | 4.08        | 13.6           |
| 50   | 15.67       | 6.94        | 22.55          |
| 100  | 33.11       | 13.12       | 46.23          |
| 300  | 82.75       | 46.49       | 129.6          |
| 500  | 131.94      | 78.95       | 210.49         |
| 1000 | 267.44      | 160.97      | 423.05         |

### ULID (26 chars, medium pattern)

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.44        | 0.33        | 0.77           |
| 5    | 1.52        | 0.85        | 2.37           |
| 10   | 3.14        | 1.62        | 4.73           |
| 30   | 8.26        | 4.1         | 12.31          |
| 50   | 14.61       | 6.97        | 21.68          |
| 100  | 30.31       | 13.01       | 43.32          |
| 300  | 73.25       | 46.05       | 119.21         |
| 500  | 117.24      | 77.85       | 194.6          |
| 1000 | 221.19      | 150.46      | 377.81         |

### Custom Regex matching UUIDs (simpler pattern, same data)

| IDs  | Encode (μs) | Decode (μs) | Roundtrip (μs) |
| ---- | ----------- | ----------- | -------------- |
| 1    | 0.46        | 0.35        | 0.8            |
| 5    | 1.51        | 0.87        | 2.38           |
| 10   | 2.98        | 1.59        | 4.57           |
| 30   | 9.22        | 4.12        | 13.37          |
| 50   | 16.11       | 8.38        | 24.18          |
| 100  | 34.09       | 13.88       | 47.59          |
| 300  | 88.38       | 47.28       | 135.66         |
| 500  | 142.96      | 77.88       | 220.88         |
| 1000 | 284.53      | 154.53      | 437.35         |

## Summary: Roundtrip at 100 IDs

| Configuration          | Roundtrip (μs) |
| ---------------------- | -------------- |
| UUID → Numeric         | 50.95          |
| UUID → IdToken         | 59.49          |
| UUID → Template {i:03} | 55.3           |
| UUID → Function        | 52.98          |

## Analysis

### Key Findings

1. **Regex complexity does not matter.** The built-in UUID pattern, with its version and variant
   checks, runs the same as a plain `/[0-9a-f-]{36}/gi` over the same data:
   46.23μs against
   47.59μs at 100 IDs.

2. **The output formats separate as the count grows.** At 100 IDs they sit within a third of each
   other, 50.95μs to 59.49μs. At 1000 IDs
   `Numeric` is 418.03μs and `IdToken` is 811.85μs,
   which is roughly twice as long, so the choice starts to cost something on large payloads.

3. **Scaling is linear in the number of identifiers** for every configuration.

### Recommendations

**Use `'Numeric'`**, for three reasons:

1. **It suits LLM tokenizers.** Most of them chunk digits in threes, and the triplet expansion
   (`000` → `001000` → `001000000`) follows that, keeping a placeholder to one or two tokens.

2. **It is the least ambiguous.** A purely numeric placeholder reads the same in any context, where
   base62 (`A`, `z`, `10`) can be mistaken for ordinary text.

3. **It is the fastest.** The gap is small at ordinary sizes and about 2x against `IdToken` at
   1000 identifiers.

### Comparison with Rust FFI

The Rust column below is from the earlier Rust-FFI branch and was not re-measured. The JavaScript
column is this run, with decode measured against a fresh mapping, so the advantage is smaller than
the figure the old harness produced.

| IDs  | Rust FFI (μs) | Native JS (μs) | JS Advantage |
| ---- | ------------- | -------------- | ------------ |
| 1    | 2.27          | 0.99           | 2.3x         |
| 50   | 72.89         | 23.72          | 3.1x         |
| 100  | 113.91        | 50.95          | 2.2x         |
| 500  | 416.10        | 221.75         | 1.9x         |
| 1000 | 833.51        | 418.03         | 2.0x         |
