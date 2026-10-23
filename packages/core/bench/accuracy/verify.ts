/**
 * Response verification for LLM accuracy benchmark
 *
 * Parses LLM responses and counts errors in the aggregation task.
 */

import { ExpectedResult } from "./prompts";

/**
 * Details of a specific error
 */
export interface ErrorDetail {
  type: "misspelled" | "dropped" | "incorrect_count" | "incorrect_names" | "parse_error";
  message: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Result of verification
 */
export interface VerificationResult {
  /** Number of class_ids that don't match any input ID */
  misspelledIds: number;
  /** Number of input class_ids missing from response */
  droppedIds: number;
  /** Number of classes with wrong item counts */
  incorrectCounts: number;
  /** Number of classes with wrong item names */
  incorrectNames: number;
  /** Total error count */
  totalErrors: number;
  /** Detailed error information */
  details: ErrorDetail[];
  /** Whether JSON parsing succeeded */
  parseSuccess: boolean;
}

/**
 * Parsed aggregation entry from LLM response
 */
interface ParsedAggregation {
  class_id: string;
  count: number;
  names: string[];
}

/**
 * Parse JSON response from LLM.
 * Handles various response formats and extracts the aggregations array.
 */
function parseResponse(response: string): ParsedAggregation[] | null {
  try {
    // Try to extract JSON from the response (may be wrapped in markdown code block)
    let jsonStr = response;

    // Handle markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find JSON object directly
      const objMatch = response.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Handle different response structures
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.aggregations && Array.isArray(parsed.aggregations)) {
      return parsed.aggregations;
    }
    if (parsed.result && Array.isArray(parsed.result)) {
      return parsed.result;
    }
    if (parsed.data && Array.isArray(parsed.data)) {
      return parsed.data;
    }

    // Try to find any array property
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value) && value.length > 0 && value[0].class_id !== undefined) {
        return value as ParsedAggregation[];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Verify LLM response against expected results.
 *
 * @param response - Raw LLM response text
 * @param expected - Expected aggregation result
 * @param mapping - Optional mapping from placeholder to original UUID (for decoding)
 * @returns Verification result with error counts and details
 */
export function verify(
  response: string,
  expected: ExpectedResult,
  mapping?: Record<string, string>
): VerificationResult {
  const result: VerificationResult = {
    misspelledIds: 0,
    droppedIds: 0,
    incorrectCounts: 0,
    incorrectNames: 0,
    totalErrors: 0,
    details: [],
    parseSuccess: false,
  };

  const parsed = parseResponse(response);
  if (!parsed) {
    result.details.push({
      type: "parse_error",
      message: "Failed to parse JSON response",
      actual: response.slice(0, 500),
    });
    result.totalErrors = expected.aggregations.size; // Count all as dropped
    result.droppedIds = expected.aggregations.size;
    return result;
  }

  result.parseSuccess = true;

  // Build a set of expected IDs (either placeholders or original UUIDs)
  const expectedIds = new Set(expected.aggregations.keys());

  // Track which expected IDs we've seen
  const seenIds = new Set<string>();

  // Check each aggregation in the response
  for (const agg of parsed) {
    const classId = agg.class_id;

    // Check if this ID exists in expected
    if (!expectedIds.has(classId)) {
      // Check if it's a close match (for misspelling detection)
      // The closest expected id, not the first one that happens to be close enough: taking the
      // first marks an arbitrary id as seen, and the one the model actually meant reads as dropped
      let nearest: { id: string; distance: number } | undefined;
      for (const expectedId of expectedIds) {
        const distance = similarity(classId, expectedId);
        if (distance !== undefined && (nearest === undefined || distance < nearest.distance)) {
          nearest = { id: expectedId, distance };
        }
      }

      if (nearest) {
        result.misspelledIds++;
        result.details.push({
          type: "misspelled",
          message: `ID "${classId}" appears to be misspelled`,
          expected: nearest.id,
          actual: classId,
        });
        seenIds.add(nearest.id); // Count as "seen" but misspelled
      } else {
        // Completely unknown ID - count as misspelled
        result.misspelledIds++;
        result.details.push({
          type: "misspelled",
          message: `ID "${classId}" not found in input`,
          actual: classId,
        });
      }
      continue;
    }

    seenIds.add(classId);

    const expectedAgg = expected.aggregations.get(classId)!;

    // Check count
    if (agg.count !== expectedAgg.count) {
      result.incorrectCounts++;
      result.details.push({
        type: "incorrect_count",
        message: `Incorrect count for class "${classId}"`,
        expected: expectedAgg.count,
        actual: agg.count,
      });
    }

    // Check names (normalize and sort for comparison)
    const expectedNames = [...expectedAgg.names].sort();
    const actualNames = (agg.names || []).map((n: string) => n.trim()).sort();

    if (!arraysEqual(expectedNames, actualNames)) {
      result.incorrectNames++;
      result.details.push({
        type: "incorrect_names",
        message: `Incorrect names for class "${classId}"`,
        expected: expectedNames,
        actual: actualNames,
      });
    }
  }

  // Check for dropped IDs (expected IDs not in response)
  for (const expectedId of expectedIds) {
    if (!seenIds.has(expectedId)) {
      result.droppedIds++;
      result.details.push({
        type: "dropped",
        message: `Class ID "${expectedId}" missing from response`,
        expected: expectedId,
      });
    }
  }

  result.totalErrors =
    result.misspelledIds + result.droppedIds + result.incorrectCounts + result.incorrectNames;

  return result;
}

/**
 * How far apart two strings are, counting position by position and then the length difference,
 * or undefined once they are too far apart to be one misspelling of the other.
 *
 * The budget is relative as well as absolute, because a flat three characters means something
 * different at either end of the scale. Two random UUIDs differ in about 34 of 36 positions and
 * are never confused; two distinct three-digit placeholders differ in at most three BY
 * CONSTRUCTION, so a flat budget calls every one of them a misspelling of the last, and the
 * format under test is handed a lower error count than the raw baseline for the same failure.
 */
function similarity(a: string, b: string): number | undefined {
  if (Math.abs(a.length - b.length) > 2) return undefined;

  const minLen = Math.min(a.length, b.length);
  const budget = Math.min(3, Math.floor(minLen / 4));
  if (budget === 0) return undefined;

  let differences = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) {
      differences++;
      if (differences > budget) return undefined;
    }
  }

  differences += Math.abs(a.length - b.length);
  return differences <= budget && differences > 0 ? differences : undefined;
}

/**
 * Check if two arrays are equal (order-independent after sort)
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
