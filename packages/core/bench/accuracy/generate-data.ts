/**
 * Dataset generation for LLM accuracy benchmark
 *
 * Generates items with UUIDs for class-based aggregation tasks.
 */

import { v4 as uuidv4 } from "uuid";
import { faker } from "@faker-js/faker";

/**
 * Represents an item in the benchmark dataset
 */
export interface Item {
  /** Unique item identifier */
  id: string;
  /** Class/group identifier (UUID) */
  class_id: string;
  /** Human-readable item name */
  name: string;
}

/**
 * Generate a dataset for the aggregation benchmark.
 *
 * @param itemCount - Total number of items to generate
 * @param classCount - Number of unique classes (items are distributed across classes)
 * @returns Array of items with UUIDs and names
 *
 * @example
 * const items = generateDataset(200, 100);
 * // Each class gets ~2 items on average
 */
export function generateDataset(itemCount: number, classCount: number): Item[] {
  // Pre-generate class UUIDs
  const classIds = Array.from({ length: classCount }, () => uuidv4());

  // Generate items distributed across classes
  const items: Item[] = Array.from({ length: itemCount }, (_, i) => ({
    id: uuidv4(),
    class_id: classIds[i % classCount],
    name: faker.commerce.productName(),
  }));

  // Shuffle items to avoid predictable ordering
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

/**
 * Get the expected aggregation result for verification.
 *
 * @param items - The generated dataset
 * @returns Map of class_id to { count, names }
 */
export function getExpectedAggregation(
  items: Item[]
): Map<string, { count: number; names: string[] }> {
  const result = new Map<string, { count: number; names: string[] }>();

  for (const item of items) {
    const existing = result.get(item.class_id);
    if (existing) {
      existing.count++;
      existing.names.push(item.name);
    } else {
      result.set(item.class_id, { count: 1, names: [item.name] });
    }
  }

  // Sort names for consistent comparison
  for (const entry of Array.from(result.values())) {
    entry.names.sort();
  }

  return result;
}
