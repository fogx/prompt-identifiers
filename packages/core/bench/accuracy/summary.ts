/**
 * The summary the accuracy benchmark prints, kept apart from the run loop so that the numbers it
 * claims can be tested without calling a model. `run.ts` is an entry point that calls `main()` on
 * import, so nothing in it is reachable from a test.
 */

import { BenchmarkFormat } from "./prompts";
import { VerificationResult } from "./verify";

export interface RunResult {
  model: string;
  format: BenchmarkFormat;
  run: number;
  verification: VerificationResult;
  latencyMs: number;
  promptTokens?: number;
  responseTokens?: number;
}

export interface ModelResults {
  model: string;
  modelDisplayName: string;
  results: RunResult[];
  /** Undefined for a format whose every run failed, which is not the same as a score of zero. */
  averageErrors: Record<BenchmarkFormat, number | undefined>;
  /** The same average over `idsNotReproduced`, which is what the formats are compared on. */
  averageMisses: Record<BenchmarkFormat, number | undefined>;
  failedRuns: Record<BenchmarkFormat, number>;
}

export interface BenchmarkResults {
  config: {
    itemCount: number;
    classCount: number;
    runs: number;
    timestamp: string;
  };
  models: ModelResults[];
}

/**
 * The mean errors per format over the runs that reached the model. A format with none is
 * undefined rather than zero: no measurement is not a perfect score.
 */
export function averageErrors(
  errorsByFormat: Record<BenchmarkFormat, number[]>,
  formats: BenchmarkFormat[]
): Record<BenchmarkFormat, number | undefined> {
  const averages = {} as Record<BenchmarkFormat, number | undefined>;
  for (const format of formats) {
    const errors = errorsByFormat[format];
    averages[format] =
      errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : undefined;
  }
  return averages;
}

/** The summary as lines, so a test can read what a run would have printed. */
export function summaryLines(results: BenchmarkResults): string[] {
  const lines: string[] = ["=".repeat(60), "# Summary", ""];

  const { config } = results;
  lines.push(`Items: ${config.itemCount}, Classes: ${config.classCount}, Runs: ${config.runs}`, "");

  for (const modelResult of results.models) {
    lines.push(`## ${modelResult.modelDisplayName}`, "");

    const formats = Object.keys(modelResult.averageErrors) as BenchmarkFormat[];
    const runNumbers = [...new Set(modelResult.results.map((r) => r.run))];

    lines.push("| Format | " + runNumbers.map((r) => `Run ${r}`).join(" | ") + " | Average |");
    lines.push("|--------|" + runNumbers.map(() => "-------").join("|") + "|---------|");

    for (const format of formats) {
      const runs = modelResult.results.filter((r) => r.format === format);
      const runErrors = runNumbers.map((n) => {
        const run = runs.find((r) => r.run === n);
        return run ? run.verification.totalErrors.toString() : "-";
      });
      const average = modelResult.averageErrors[format];
      const avg = average === undefined ? "-" : average.toFixed(1);
      lines.push(
        `| ${format.padEnd(12)} | ${runErrors.map((e) => e.padStart(5)).join(" | ")} | ${avg.padStart(7)} |`
      );
    }

    const failed = Object.entries(modelResult.failedRuns).filter(([, n]) => n > 0);
    if (failed.length > 0) {
      lines.push(
        "",
        `Runs that never reached the model: ${failed
          .map(([format, n]) => `${format} ${n}`)
          .join(", ")}. They are not in the averages.`
      );
    }

    // Compared on ids the answer did not reproduce exactly, not on total errors: the misspelling
    // discount is only available to a format whose placeholders are long enough to carry a typo,
    // so scoring the comparison on it charges a different price per format for one mistake.
    //
    // Both formats have to have been measured: comparing against a format that was never run, or
    // whose every run failed, is a claim with nothing behind it
    const rawAvg = modelResult.averageMisses["raw"];
    const safeAvg = modelResult.averageMisses["SafeNumeric"];

    if (rawAvg !== undefined && rawAvg > 0 && safeAvg !== undefined) {
      const improvement = ((rawAvg - safeAvg) / rawAvg) * 100;
      lines.push("", `SafeNumeric reduces errors by ${improvement.toFixed(0)}% vs raw UUIDs.`);
    }

    lines.push("");
  }

  return lines;
}
