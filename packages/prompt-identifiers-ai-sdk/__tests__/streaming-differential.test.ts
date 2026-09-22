/**
 * Differential harness for createStreamingDecoder.
 *
 * Ground truth is decode(wholeText, mapping), which is what wrapGenerate returns for the same
 * text. What a consumer reads off a stream must equal it at every chunk boundary.
 *
 * The sweep runs mappings whose restored IDs contain placeholder text, placeholder sets that are
 * not prefix-free, regex metacharacters in the delimiters, formatters returning overlapping
 * strings, sizes 1 / 12 / 62 / 63 / 1000 / 1001, every split position, per character, the empty
 * chunk and an all-placeholder chunk.
 */

import { describe, expect, test } from "vitest";
import { decode, type EncodeConfig } from "prompt-identifiers";
import { makeHarness, splits } from "./streaming-harness";

interface Disagreement {
  format: string;
  size: number;
  text: string;
  chunks: string[];
  streamed: string;
  expected: string;
}

/** Distinct v4 UUIDs, several all-digit in one or more groups. */
function uuids(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = i.toString(16).padStart(8, "0");
    out.push(`${h}-4567-42d3-a456-426655440000`);
  }
  return out;
}

/** ULIDs: Crockford base32, 26 chars, uppercase, with digit-only stretches. */
function ulids(n: number): string[] {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let s = "";
    let v = i;
    for (let k = 0; k < 26; k++) {
      s = alphabet[v % 32] + s;
      v = Math.floor(v / 32);
    }
    out.push(s);
  }
  return out;
}

const formats: { label: string; config: EncodeConfig; input: "UUID" | "ULID" }[] = [
  {
    label: "SafeNumeric",
    config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
    input: "UUID",
  },
  {
    label: "Numeric/UUID",
    config: { inputFormat: "UUID", outputFormat: "Numeric" },
    input: "UUID",
  },
  {
    label: "Numeric/ULID",
    config: { inputFormat: "ULID", outputFormat: "Numeric" },
    input: "ULID",
  },
  {
    label: "IdToken/UUID",
    config: { inputFormat: "UUID", outputFormat: "IdToken" },
    input: "UUID",
  },
  {
    label: "IdToken/ULID",
    config: { inputFormat: "ULID", outputFormat: "IdToken" },
    input: "ULID",
  },
  {
    label: "angle <000>",
    config: { inputFormat: "UUID", outputFormat: { template: "<{i:zeroFilled}>" } },
    input: "UUID",
  },
  {
    label: "prefix-only -{i}",
    config: { inputFormat: "UUID", outputFormat: { template: "-{i}" } },
    input: "UUID",
  },
  {
    label: "regex metachars [{i}]",
    config: { inputFormat: "UUID", outputFormat: { template: "[{i}]" } },
    input: "UUID",
  },
  {
    label: "regex metachars (.{i}.)",
    config: { inputFormat: "UUID", outputFormat: { template: "(.{i}.)" } },
    input: "UUID",
  },
  {
    label: "regex alternation |{i}|",
    config: { inputFormat: "UUID", outputFormat: { template: "|{i}|" } },
    input: "UUID",
  },
  {
    label: "formatter with overlapping outputs",
    config: {
      inputFormat: "UUID",
      outputFormat: (i: number) => (i === 0 ? "ID1" : i === 1 ? "ID10" : i === 2 ? "$1" : `Q${i}Z`),
    },
    input: "UUID",
  },
  {
    label: "formatter nesting one placeholder inside another",
    config: {
      inputFormat: "UUID",
      outputFormat: (i: number) => (i === 0 ? "AB" : i === 1 ? "XABY" : `Q${i}Z`),
    },
    input: "UUID",
  },
  {
    label: "formatter nesting a delimited placeholder",
    config: {
      inputFormat: "UUID",
      outputFormat: (i: number) => (i === 0 ? "<1>" : i === 1 ? "<0<1>>" : `<${i + 9}>`),
    },
    input: "UUID",
  },
];

const sizes = [1, 12, 62, 63, 1000, 1001];

function bodies(placeholders: string[]): string[] {
  const p0 = placeholders[0];
  const p1 = placeholders[Math.min(1, placeholders.length - 1)];
  const last = placeholders[placeholders.length - 1];
  return [
    p0,
    `${p0}${p1}`,
    `Order ${p0}0 units`,
    `Order ${p0}${p0} units`,
    `See ${p0} and ${last}.`,
    `x${p0}`,
    `${p0}x`,
    `${last}${p0}`,
    `a ${p1} b ${last} c`,
    `${p0} ${p0} ${p0}`,
  ];
}

describe("streamed text equals decode() of the whole text", () => {
  for (const { label, config, input } of formats) {
    for (const size of sizes) {
      test(`${label}, ${size} ids`, async () => {
        const ids = input === "UUID" ? uuids(size) : ulids(size);
        const harness = await makeHarness(config, `Look up ${ids.join(" ")}`);
        const placeholders = Object.keys(harness.mapping);
        expect(placeholders.length).toBe(size);

        const disagreements: Disagreement[] = [];
        outer: for (const text of bodies(placeholders)) {
          const expected = decode(text, harness.mapping);
          for (const chunks of splits(text)) {
            const streamed = await harness.run(chunks);
            if (streamed !== expected) {
              disagreements.push({ format: label, size, text, chunks, streamed, expected });
              if (disagreements.length > 4) break outer;
            }
          }
        }
        expect(disagreements).toEqual([]);
      });
    }
  }
});

const uuid0 = "00000000-4567-42d3-a456-426655440000";
const uuid1 = "00000001-4567-42d3-a456-426655440000";

describe("facts the formats table cannot reach", () => {
  test("a stream ending on a held complete placeholder still decodes it", async () => {
    const config: EncodeConfig = {
      inputFormat: "UUID",
      outputFormat: (i: number) => (i === 0 ? "ID1" : "ID11"),
    };
    const harness = await makeHarness(config, `Look up ${uuid0} ${uuid1}`);
    expect(Object.keys(harness.mapping)).toEqual(["ID1", "ID11"]);

    // "ID1" is held because the next chunk could turn it into "ID11"; no next chunk comes
    expect(await harness.run(["xID1"])).toBe(decode("xID1", harness.mapping));
    expect(await harness.run(["xID1"])).toBe(`x${uuid0}`);
  });

  test("a call whose prompt carried no id still streams", async () => {
    const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
    const harness = await makeHarness(config, "no identifiers here");
    expect(Object.keys(harness.mapping)).toEqual([]);

    expect(await harness.run(["hello ", "world"])).toBe("hello world");
  });
});
