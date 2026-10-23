import { describe, expect, test } from "vitest";

import { averageErrors, summaryLines } from "../summary";
import type { BenchmarkResults, ModelResults } from "../summary";
import type { BenchmarkFormat } from "../prompts";

function modelResults(over: Partial<ModelResults> = {}): ModelResults {
  return {
    model: "m",
    modelDisplayName: "a model",
    results: [],
    averageErrors: {} as Record<BenchmarkFormat, number | undefined>,
    averageMisses: {} as Record<BenchmarkFormat, number | undefined>,
    failedRuns: { raw: 0, SafeNumeric: 0, Numeric: 0 },
    ...over,
  };
}

function summaryOf(over: Partial<ModelResults>) {
  const results: BenchmarkResults = {
    config: { itemCount: 20, classCount: 10, runs: 1, timestamp: "" },
    models: [modelResults(over)],
  };
  return summaryLines(results).join("\n");
}

describe("the summary the accuracy benchmark prints", () => {
  test("a format with no successful run has no average, which is not a score of zero", () => {
    const averages = averageErrors({ raw: [4, 6], SafeNumeric: [], Numeric: [2] }, [
      "raw",
      "SafeNumeric",
      "Numeric",
    ]);

    expect(averages.raw).toBe(5);
    expect(averages.SafeNumeric).toBeUndefined();
    expect(averages.Numeric).toBe(2);
  });

  test("the table prints a dash for a format that was never measured", () => {
    const text = summaryOf({
      averageErrors: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      averageMisses: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      failedRuns: { raw: 0, SafeNumeric: 1, Numeric: 0 },
    });

    // The run columns sit between the format and its average, and there are none here
    expect(text).toMatch(/\| SafeNumeric\s+\|.*\|\s+-\s+\|/);
  });

  test("runs that never reached the model are named and kept out of the averages", () => {
    const text = summaryOf({
      averageErrors: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      averageMisses: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      failedRuns: { raw: 0, SafeNumeric: 2, Numeric: 0 },
    });

    expect(text).toContain("Runs that never reached the model: SafeNumeric 2");
  });

  test("the improvement line needs both formats measured", () => {
    // A format whose every run failed, and one never asked for, are both nothing to compare
    // against. Reading either as zero errors printed a perfect result for a run that never happened
    const everyRunFailed = summaryOf({
      averageErrors: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      averageMisses: { raw: 10, SafeNumeric: undefined } as Record<
        BenchmarkFormat,
        number | undefined
      >,
      failedRuns: { raw: 0, SafeNumeric: 1, Numeric: 0 },
    });
    expect(everyRunFailed).not.toContain("reduces errors");

    const neverRun = summaryOf({
      averageErrors: { raw: 10 } as Record<BenchmarkFormat, number | undefined>,
      averageMisses: { raw: 10 } as Record<BenchmarkFormat, number | undefined>,
    });
    expect(neverRun).not.toContain("reduces errors");
  });

  test("the improvement line is printed when both were measured", () => {
    const text = summaryOf({
      averageErrors: { raw: 10, SafeNumeric: 4 } as Record<BenchmarkFormat, number | undefined>,
      averageMisses: { raw: 10, SafeNumeric: 4 } as Record<BenchmarkFormat, number | undefined>,
    });

    expect(text).toContain("SafeNumeric reduces errors by 60% vs raw UUIDs.");
  });

  test("the improvement line is the format-fair count, not the total errors", () => {
    // The two records disagree whenever the misspelling discount lands differently per format,
    // which is the whole reason the second one exists. Reading the wrong one here is silent
    const text = summaryOf({
      averageErrors: { raw: 10, SafeNumeric: 10 } as Record<BenchmarkFormat, number | undefined>,
      averageMisses: { raw: 10, SafeNumeric: 4 } as Record<BenchmarkFormat, number | undefined>,
    });

    expect(text).toContain("SafeNumeric reduces errors by 60% vs raw UUIDs.");
    expect(text).not.toContain("by 0%");
  });

  test("a raw baseline of zero errors is not divided by", () => {
    const text = summaryOf({
      averageErrors: { raw: 0, SafeNumeric: 0 } as Record<BenchmarkFormat, number | undefined>,
      averageMisses: { raw: 0, SafeNumeric: 0 } as Record<BenchmarkFormat, number | undefined>,
    });

    expect(text).not.toContain("reduces errors");
    expect(text).not.toContain("NaN");
  });
});
