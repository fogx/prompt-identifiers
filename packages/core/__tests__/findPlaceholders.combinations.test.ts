import { describe, expect, test } from "vitest";

import { createFormatter, findPlaceholders, type OutputFormat } from "../src/index";

/** Each format with the delimiters and the body it writes, spelled out rather than derived. */
const formats: [string, OutputFormat, string, string, "digits" | "base62"][] = [
  ["SafeNumeric", "SafeNumeric", "~", "~", "digits"],
  ["a padded template", { template: "<id:{i:03}>" }, "<id:", ">", "digits"],
  ["a zero-filled template", { template: "[{i:zeroFilled}]" }, "[", "]", "digits"],
  ["a multi-character template", { template: "((ID_{i:04}))" }, "((ID_", "))", "digits"],
  ["a base62 template", { template: "|{i:base62}|" }, "|", "|", "base62"],
  ["a prefix-only template", { template: "#{i}" }, "#", "", "digits"],
  // findPlaceholders compiles a template's literals into a pattern, so a backslash in one has to
  // be escaped or it changes what the pattern matches
  ["a backslash template", { template: "a\\{i:03}b" }, "a\\", "b", "digits"],
  ["a template ending in a backslash", { template: "<{i:03}\\" }, "<", "\\", "digits"],
];

/** Empty puts two placeholders against each other, or one at either end of the text. */
const gaps = ["", " ", " and ", "x"];
const indexSets = [[0], [0, 1], [7, 7], [5, 999, 1000], [0, 61, 62, 4000]];

/** Every arrangement of the placeholders with every gap pattern between and around them. */
function* texts(placeholders: string[]) {
  const slots = placeholders.length + 1;
  for (let pattern = 0; pattern < gaps.length ** slots; pattern++) {
    const chosen = Array.from(
      { length: slots },
      (_, slot) => gaps[Math.floor(pattern / gaps.length ** slot) % gaps.length]
    );
    yield placeholders.reduce((text, p, i) => text + p + chosen[i + 1], chosen[0]);
  }
}

describe.each(formats)("findPlaceholders over %s", (_, format, prefix, suffix, charset) => {
  const formatter = createFormatter(format);
  const [first, second] = [formatter(0), formatter(1)];

  test.each(indexSets)("returns the placeholders of %j wherever they sit", (...indices) => {
    const placeholders = indices.map(formatter);
    const expected = [...new Set(placeholders)];

    for (const text of texts(placeholders)) {
      expect(findPlaceholders(text, format), text).toEqual(expected);
    }
  });

  // Only a format that delimits both ends can wrap a token, so those rows sit apart
  const wrapped: [string, string, string[]][] =
    prefix && suffix
      ? [
          ["both delimiters wrap the token", prefix + first + suffix, []],
          ["a wrapped token follows a real one", first + " " + prefix + second + suffix, [first]],
          ["a real token follows a wrapped one", prefix + first + suffix + " " + second, [second]],
          [
            "a real token follows two wrapped ones",
            prefix + first + suffix + " " + prefix + second + suffix + " " + first,
            [first],
          ],
        ]
      : [];

  test.each<[string, string, string[]]>([
    ["a bare closing delimiter follows a run", first + second + suffix, [first, second]],
    ["a bare opening delimiter leads a run", prefix + first + second, [first, second]],
    ["a closing delimiter follows the first token", first + suffix, [first]],
    ["an opening delimiter leads the last token", prefix + first, [first]],
    ["ordinary text leads a token a closing delimiter follows", "x" + first + suffix, [first]],
    ...wrapped,
  ])("keeps the right tokens when %s", (_, text, expected) => {
    expect(findPlaceholders(text, format), text).toEqual(expected);
  });

  test("never returns a token whose body is outside the format's character set", () => {
    for (const body of ["", "-1", "a b", "é", "user_id"]) {
      const token = prefix + body + suffix;

      expect(findPlaceholders(`see ${token} here`, format), token).toEqual([]);
    }
  });

  test(`a letters-only body is ${charset === "base62" ? "returned" : "not"}`, () => {
    const token = prefix + "abc" + suffix;

    expect(findPlaceholders(`see ${token} here`, format)).toEqual(
      charset === "base62" ? [token] : []
    );
  });
});
