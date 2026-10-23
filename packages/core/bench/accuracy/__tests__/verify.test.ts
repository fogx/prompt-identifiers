import { describe, expect, test } from "vitest";

import { verify } from "../verify";
import type { ExpectedResult } from "../prompts";

/** The shape `verify` scores against: one aggregation per class the prompt asked about. */
function expectedFor(ids: string[]): ExpectedResult {
  return {
    aggregations: new Map(ids.map((id) => [id, { count: 1, names: ["a"] }])),
    originalClassIds: new Set(ids),
  };
}

/**
 * The parser looks for a JSON object, so a bare array reaches it as text between the first brace
 * and the last and fails to parse. A model answering this prompt returns the wrapped shape.
 */
function answer(rows: { class_id: string; count: number; names: string[] }[]) {
  return JSON.stringify({ aggregations: rows });
}

describe("the accuracy bench scores every format the same way", () => {
  const uuids = [
    "123e4567-e89b-42d3-a456-426655440000",
    "987fcdeb-51a2-43f7-8d9c-0123456789ab",
    "0192b4a1-7b3e-4c4d-8e9f-1a2b3c4d5e6f",
  ];
  const placeholders = ["000", "001", "002"];

  test("a hallucinated placeholder costs what a hallucinated UUID costs", () => {
    // The scorer decides what a wrong id is by how close it is to an expected one. Two distinct
    // three-digit placeholders differ in at most three characters BY CONSTRUCTION, so a budget
    // that is generous enough for a UUID typo calls every one of them a misspelling, and the
    // compressed format is handed a lower error count than the raw baseline for the same failure
    const invented = verify(
      answer([{ class_id: "999", count: 1, names: ["a"] }]),
      expectedFor(placeholders)
    );
    const inventedRaw = verify(
      answer([{ class_id: "deadbeef-dead-4bad-8bad-deadbeefdead", count: 1, names: ["a"] }]),
      expectedFor(uuids)
    );

    expect(invented.totalErrors).toBe(inventedRaw.totalErrors);
  });

  test("a UUID with one character changed is still read as a misspelling", () => {
    const typo = uuids[0].slice(0, 5) + "f" + uuids[0].slice(6);

    const result = verify(answer([{ class_id: typo, count: 1, names: ["a"] }]), expectedFor(uuids));

    expect(result.misspelledIds).toBe(1);
    expect(result.details[0]).toMatchObject({ type: "misspelled", expected: uuids[0] });
  });

  test("a misspelling is attributed to the nearest expected id, not the first close one", () => {
    // Both are close enough to the answer, and the second is closer. Blaming the first marks an
    // id the model never wrote as seen, and leaves the one it meant counted as dropped
    const three = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const written = "bbbaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const one = "bbbbaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const expected = expectedFor([three, one]);

    const result = verify(answer([{ class_id: written, count: 1, names: ["a"] }]), expected);

    expect(result.details[0]).toMatchObject({ type: "misspelled", expected: one });
  });

  test("an answer that gets every class right scores no errors, under either format", () => {
    for (const ids of [uuids, placeholders]) {
      const result = verify(
        answer(ids.map((id) => ({ class_id: id, count: 1, names: ["a"] }))),
        expectedFor(ids)
      );

      expect(result.totalErrors, ids[0]).toBe(0);
    }
  });

  test("a class the model never mentioned is counted as dropped", () => {
    const result = verify(
      answer([{ class_id: placeholders[0], count: 1, names: ["a"] }]),
      expectedFor(placeholders)
    );

    expect(result.droppedIds).toBe(2);
  });
});
