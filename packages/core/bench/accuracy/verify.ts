/**
 * Response verification for LLM accuracy benchmark
 *
 * Parses LLM responses and counts errors in the aggregation task.
 */

import { ExpectedResult } from './prompts';

/**
 * Details of a specific error
 */
export interface ErrorDetail {
  type: 'misspelled' | 'dropped' | 'incorrect_count' | 'incorrect_names' | 'parse_error';
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
      type: 'parse_error',
      message: 'Failed to parse JSON response',
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
      let isMisspelling = false;

      // For raw UUIDs, check if it's similar to any expected ID
      for (const expectedId of expectedIds) {
        if (isSimilar(classId, expectedId)) {
          isMisspelling = true;
          result.misspelledIds++;
          result.details.push({
            type: 'misspelled',
            message: `ID "${classId}" appears to be misspelled`,
            expected: expectedId,
            actual: classId,
          });
          seenIds.add(expectedId); // Count as "seen" but misspelled
          break;
        }
      }

      if (!isMisspelling) {
        // Completely unknown ID - count as misspelled
        result.misspelledIds++;
        result.details.push({
          type: 'misspelled',
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
        type: 'incorrect_count',
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
        type: 'incorrect_names',
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
        type: 'dropped',
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
 * Check if two strings are similar (for detecting misspellings).
 * Uses simple heuristics: same length and most characters match.
 */
function isSimilar(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;

  let differences = 0;
  const minLen = Math.min(a.length, b.length);

  for (let i = 0; i < minLen; i++) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) {
      differences++;
      if (differences > 3) return false;
    }
  }

  differences += Math.abs(a.length - b.length);
  return differences <= 3 && differences > 0;
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
