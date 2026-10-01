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

  test("an id echoed in a different case is one error, not two", () => {
    // The exact lookup is case-sensitive, so a re-cased id misses it and falls to the near-match
    // path. similarity() ignores case there, so the id is matched to itself and marked seen.
    const result = verify(
      answer([
        { class_id: uuids[0].toUpperCase(), count: 1, names: ["a"] },
        { class_id: uuids[1], count: 1, names: ["a"] },
        { class_id: uuids[2], count: 1, names: ["a"] },
      ]),
      expectedFor(uuids)
    );

    expect(result.misspelledIds).toBe(1);
    expect(result.droppedIds).toBe(0);
    expect(result.totalErrors).toBe(1);
    expect(result.idsNotReproduced).toBe(1);
  });

  test("four characters wrong is a different id, not a misspelling", () => {
    // Four of 36 positions differ, one over the budget's cap. Without the cap the relative term
    // alone would allow nine, so the scorer would blame this on the id it least resembles and
    // stop counting that id as dropped
    const written = "ffff" + uuids[0].slice(4);

    const result = verify(
      answer([{ class_id: written, count: 1, names: ["a"] }]),
      expectedFor([uuids[0]])
    );

    expect(result.droppedIds).toBe(1);
    expect(result.details[0]).toMatchObject({ type: "misspelled", actual: written });
    expect(result.details[0].expected).toBeUndefined();
  });

  test("a three-character id is never read as a typo of another", () => {
    // There is no room in three digits for a slip that is distinguishable from a different id,
    // so the scorer refuses to guess rather than discount. A budget generous enough to call 900 a
    // typo of 000 hands the short formats a discount the long ones pay full price for
    const result = verify(
      answer([
        { class_id: "900", count: 1, names: ["a"] },
        { class_id: placeholders[1], count: 1, names: ["a"] },
        { class_id: placeholders[2], count: 1, names: ["a"] },
      ]),
      expectedFor(placeholders)
    );

    expect(result.misspelledIds).toBe(1);
    expect(result.droppedIds).toBe(1);
    expect(result.totalErrors).toBe(2);
  });

  test("a misspelling is not also counted as dropped", () => {
    const typo = uuids[0].slice(0, 5) + "f" + uuids[0].slice(6);

    const result = verify(
      answer([
        { class_id: typo, count: 1, names: ["a"] },
        { class_id: uuids[1], count: 1, names: ["a"] },
      ]),
      expectedFor([uuids[0], uuids[1]])
    );

    expect(result.misspelledIds).toBe(1);
    expect(result.droppedIds).toBe(0);
  });

  test.each([
    { label: "two characters short", cut: 2, misspelled: 1 },
    { label: "three characters short", cut: 3, misspelled: 1 },
  ])("a UUID cut $label", ({ cut, misspelled }) => {
    // A model that runs out of output mid-identifier is the commonest raw-format failure the
    // bench measures, so where the length rules put it moves the baseline the claim divides by
    const truncated = uuids[0].slice(0, uuids[0].length - cut);

    const result = verify(
      answer([{ class_id: truncated, count: 1, names: ["a"] }]),
      expectedFor([uuids[0]])
    );

    expect(result.misspelledIds).toBe(misspelled);
    expect(result.droppedIds).toBe(cut <= 2 ? 0 : 1);
  });

  test("a class answered with the wrong count or the wrong names is charged for it", () => {
    const result = verify(
      answer([
        { class_id: uuids[0], count: 7, names: ["a"] },
        { class_id: uuids[1], count: 1, names: ["b"] },
        { class_id: uuids[2], count: 1, names: ["a"] },
      ]),
      expectedFor(uuids)
    );

    expect(result.incorrectCounts).toBe(1);
    expect(result.incorrectNames).toBe(1);
    expect(result.totalErrors).toBe(2);
    expect(result.idsNotReproduced).toBe(0);
  });

  test.for([
    { label: "the same names in another order", names: ["b", "a"], incorrectNames: 0 },
    { label: "the same names with padding", names: [" b ", "a"], incorrectNames: 0 },
    { label: "an extra name", names: ["a", "b", "c"], incorrectNames: 1 },
    { label: "a name missing", names: ["a"], incorrectNames: 1 },
  ])("a class answered with $label", ({ names, incorrectNames }) => {
    // The names are compared as sets, so order and padding are the dataset's business and not
    // the model's error, while a name too many or too few is
    const expected: ExpectedResult = {
      aggregations: new Map([[uuids[0], { count: 2, names: ["a", "b"] }]]),
      originalClassIds: new Set([uuids[0]]),
    };

    const result = verify(answer([{ class_id: uuids[0], count: 2, names }]), expected);

    expect(result.incorrectNames).toBe(incorrectNames);
    expect(result.totalErrors).toBe(incorrectNames);
  });

  test("a class whose expected names are held in another order is still matched", () => {
    const expected: ExpectedResult = {
      aggregations: new Map([[uuids[0], { count: 2, names: ["b", "a"] }]]),
      originalClassIds: new Set([uuids[0]]),
    };

    const result = verify(answer([{ class_id: uuids[0], count: 2, names: ["a", "b"] }]), expected);

    expect(result.incorrectNames).toBe(0);
    expect(result.totalErrors).toBe(0);
  });

  test("a short-format id cut short is not read as the same id in another case", () => {
    // The case-only return needs equal lengths. Without that half, a two-character answer is no
    // distance from "000", so it would be charged as a misspelling and "000" marked seen, and
    // the three-character format would get a discount on a truncation the 36-character one
    // cannot earn
    const result = verify(
      answer([
        { class_id: "00", count: 1, names: ["a"] },
        { class_id: "001", count: 1, names: ["a"] },
        { class_id: "002", count: 1, names: ["a"] },
      ]),
      expectedFor(placeholders)
    );

    expect(result.misspelledIds).toBe(1);
    expect(result.droppedIds).toBe(1);
    expect(result.totalErrors).toBe(2);
    expect(result.idsNotReproduced).toBe(1);
  });

  test("an encoded format is scored against the placeholders, not the original ids", () => {
    // createPrompt keys the aggregations by placeholder and keeps the raw UUIDs in
    // originalClassIds, so scoring against the wrong one would read every encoded run as a
    // total loss and hand the comparison to the raw baseline
    const expected: ExpectedResult = {
      aggregations: new Map([
        ["~000~", { count: 1, names: ["a"] }],
        ["~001~", { count: 1, names: ["a"] }],
      ]),
      originalClassIds: new Set([uuids[0], uuids[1]]),
    };

    const result = verify(
      answer([
        { class_id: "~000~", count: 1, names: ["a"] },
        { class_id: "~001~", count: 1, names: ["a"] },
      ]),
      expected
    );

    expect(result.totalErrors).toBe(0);
    expect(result.idsNotReproduced).toBe(0);
  });

  test.for([
    { label: "a result wrapper", key: "result" },
    { label: "a data wrapper", key: "data" },
    { label: "a wrapper under some other name", key: "classes" },
  ])("an answer shaped as $label is scored, not thrown away", ({ key }) => {
    // The last rung takes any array property whose first row carries a class_id, which is what
    // keeps a model's own choice of wrapper from losing the whole run
    const body = JSON.stringify({ [key]: [{ class_id: uuids[0], count: 1, names: ["a"] }] });

    const result = verify(body, expectedFor([uuids[0]]));

    expect(result.parseSuccess).toBe(true);
    expect(result.totalErrors).toBe(0);
  });

  test("an answer in a code fence is read out of the fence", () => {
    // The brace in the prose after the fence is what makes this fail without the fence
    // extraction: the span from the first brace to the last then ends outside the JSON
    const body = `Here is the aggregation:\n\`\`\`json\n${answer([
      { class_id: uuids[0], count: 1, names: ["a"] },
    ])}\n\`\`\`\nEvery class is listed {complete}.`;

    const result = verify(body, expectedFor([uuids[0]]));

    expect(result.parseSuccess).toBe(true);
    expect(result.totalErrors).toBe(0);
  });

  test("an answer that does not parse loses every class", () => {
    // The scorer cannot see what the model meant, so every expected id is a miss. Leaving the
    // format-fair count at zero here scores an unusable answer as a perfect one
    const result = verify("not JSON at all", expectedFor(uuids));

    expect(result.parseSuccess).toBe(false);
    expect(result.droppedIds).toBe(3);
    expect(result.idsNotReproduced).toBe(3);
    expect(result.totalErrors).toBe(3);
  });

  test("a class the model never mentioned is counted as dropped", () => {
    const result = verify(
      answer([{ class_id: placeholders[0], count: 1, names: ["a"] }]),
      expectedFor(placeholders)
    );

    expect(result.droppedIds).toBe(2);
  });
});
