/**
 * Prompt templates for LLM accuracy benchmark
 *
 * Creates prompts for the item aggregation task with different encoding formats.
 */

import { encode, OutputFormat } from '../../src/index';
import { Item, getExpectedAggregation } from './generate-data';

/**
 * Format type for the benchmark
 */
export type BenchmarkFormat = 'raw' | 'SafeNumeric' | 'Numeric';

/**
 * Expected result for verification
 */
export interface ExpectedResult {
  /** Map of class_id (or encoded placeholder) to expected aggregation */
  aggregations: Map<string, { count: number; names: string[] }>;
  /** Original class IDs for reference */
  originalClassIds: Set<string>;
}

/**
 * Result of prompt creation
 */
export interface PromptResult {
  /** The prompt to send to the LLM */
  prompt: string;
  /** Mapping from placeholder to original UUID (undefined for 'raw' format) */
  mapping?: Record<string, string>;
  /** Expected result for verification */
  expected: ExpectedResult;
  /** The format used */
  format: BenchmarkFormat;
}

/**
 * Create a prompt for the aggregation task.
 *
 * @param items - Dataset items
 * @param format - Output format: 'raw' (UUIDs), 'SafeNumeric', or 'Numeric'
 * @returns Prompt, optional mapping, and expected result
 */
export function createPrompt(items: Item[], format: BenchmarkFormat): PromptResult {
  const expectedRaw = getExpectedAggregation(items);
  const originalClassIds = new Set(items.map((i) => i.class_id));

  if (format === 'raw') {
    // Send raw UUIDs - no encoding
    const itemList = items.map((item) => `- Item "${item.name}": class_id = ${item.class_id}`).join('\n');

    const prompt = `Here are items with their class IDs:
${itemList}

Aggregate these items by class_id. For each class, provide:
1. The class_id
2. Count of items in that class
3. List of item names in that class

Output ONLY valid JSON (no other text) in this exact format:
{
  "aggregations": [
    { "class_id": "<the class_id>", "count": <number>, "names": ["name1", "name2"] }
  ]
}

CRITICAL REQUIREMENTS:
- Output the COMPLETE JSON with ALL ${originalClassIds.size} classes - do not truncate or ask questions
- Copy class_ids EXACTLY as they appear (do not modify them)
- Ensure counts and names match the input data precisely`;

    return {
      prompt,
      expected: {
        aggregations: expectedRaw,
        originalClassIds,
      },
      format,
    };
  }

  // Encode class_ids using prompt-identifiers
  const outputFormat: OutputFormat = format === 'SafeNumeric' ? 'SafeNumeric' : 'Numeric';

  // Build a text with all class_ids to encode
  const classIdText = items.map((item) => `CLASSID:${item.class_id}`).join('\n');
  const { encoded: encodedClassIdText, mapping } = encode(classIdText, {
    inputFormat: 'UUID',
    outputFormat,
  });

  // Build reverse mapping for quick lookup
  const uuidToPlaceholder = new Map<string, string>();
  for (const [placeholder, uuid] of Object.entries(mapping)) {
    uuidToPlaceholder.set(uuid, placeholder);
  }

  // Build the item list with encoded class_ids
  const itemList = items
    .map((item) => {
      const encodedClassId = uuidToPlaceholder.get(item.class_id.toLowerCase());
      return `- Item "${item.name}": class_id = ${encodedClassId}`;
    })
    .join('\n');

  // Build expected result with encoded placeholders
  const encodedAggregations = new Map<string, { count: number; names: string[] }>();
  for (const [uuid, data] of expectedRaw) {
    const placeholder = uuidToPlaceholder.get(uuid.toLowerCase());
    if (placeholder) {
      encodedAggregations.set(placeholder, data);
    }
  }

  const prompt = `Here are items with their class IDs:
${itemList}

Aggregate these items by class_id. For each class, provide:
1. The class_id
2. Count of items in that class
3. List of item names in that class

Output ONLY valid JSON (no other text) in this exact format:
{
  "aggregations": [
    { "class_id": "<the class_id>", "count": <number>, "names": ["name1", "name2"] }
  ]
}

CRITICAL REQUIREMENTS:
- Output the COMPLETE JSON with ALL ${encodedAggregations.size} classes - do not truncate or ask questions
- Copy class_ids EXACTLY as they appear (do not modify them)
- Ensure counts and names match the input data precisely`;

  return {
    prompt,
    mapping,
    expected: {
      aggregations: encodedAggregations,
      originalClassIds,
    },
    format,
  };
}
