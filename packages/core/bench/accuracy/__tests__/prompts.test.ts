import { describe, expect, test } from "vitest";

import { createPrompt } from "../prompts";
import type { Item } from "../generate-data";

describe("the prompt the accuracy bench sends", () => {
  // encode() holds each identifier as the text wrote it, so a reverse lookup built off the
  // mapping's values has to agree on case with whatever the dataset carries. Reading it wrong
  // put `undefined` in every class_id and scored the model on nonsense, and nothing said so
  const upper = "123E4567-E89B-42D3-A456-426655440000";
  const items: Item[] = [
    { id: "1", class_id: upper, name: "first" },
    { id: "2", class_id: upper, name: "second" },
  ];

  test("an uppercase identifier reaches the prompt as a placeholder", () => {
    const { prompt } = createPrompt(items, "SafeNumeric");

    expect(prompt).not.toContain("undefined");
    expect(prompt).toContain("class_id = ~000~");
  });

  test("the expected result is keyed by the placeholder the prompt used", () => {
    const { expected } = createPrompt(items, "SafeNumeric");

    expect([...expected.aggregations.keys()]).toEqual(["~000~"]);
    expect(expected.aggregations.get("~000~")).toEqual({ count: 2, names: ["first", "second"] });
  });

  test("the Numeric arm writes Numeric placeholders, not SafeNumeric ones", () => {
    // The page compares three arms. An arm that quietly encodes as another one is still printed
    // under its own heading, and the comparison means nothing
    const { prompt, expected } = createPrompt(items, "Numeric");

    expect(prompt).toContain("class_id = 000");
    expect(prompt).not.toContain("~000~");
    expect([...expected.aggregations.keys()]).toEqual(["000"]);
  });

  test("the raw format sends the identifier as it was written", () => {
    const { prompt, expected } = createPrompt(items, "raw");

    expect(prompt).toContain(upper);
    expect([...expected.aggregations.keys()]).toEqual([upper]);
  });
});
