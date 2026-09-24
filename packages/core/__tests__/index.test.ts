import { describe, test, expect } from "vitest";
import {
  createEncodeState,
  decode,
  encode,
  EncodeConfig,
  findPlaceholders,
  OutputFormat,
} from "../src/index";

describe("prompt-identifiers", () => {
  // Shared test configuration
  const UUID_NUMERIC_CONFIG: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "Numeric",
  };

  // Shared helper to generate valid UUID-like strings
  function makeUuid(n: number): string {
    const hex = n.toString(16).padStart(4, "0");
    return `12345678-1234-4234-8234-${hex.padStart(12, "0")}`;
  }

  describe("Basic encode/decode", () => {
    test("encode() with UUID and Numeric format", () => {
      const prompt = "User 123e4567-e89b-42d3-a456-426655440000 requested access";

      const result = encode(prompt, UUID_NUMERIC_CONFIG);

      expect(result).toBeDefined();
      expect(result.encoded).toBe("User 000 requested access");
      expect(typeof result.mapping).toBe("object");
      expect(result.mapping["000"]).toBe("123e4567-e89b-42d3-a456-426655440000");
    });

    test("decode() restores original IDs", () => {
      const prompt = "User 123e4567-e89b-42d3-a456-426655440000 requested access";

      const { encoded, mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      const decoded = decode(encoded, mapping);

      expect(decoded).toBe(prompt);
    });
  });

  describe("Roundtrip accuracy", () => {
    test("roundtrip with multiple UUIDs", () => {
      const prompt =
        "User 123e4567-e89b-42d3-a456-426655440000 sent message to 987fcdeb-51a2-43f7-8d9c-0123456789ab";

      const { encoded, mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      const decoded = decode(encoded, mapping);

      expect(decoded).toBe(prompt);
    });

    test("roundtrip with repeated IDs", () => {
      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const prompt = `User ${uuid} logged in. User ${uuid} logged out.`;

      const { encoded, mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      const decoded = decode(encoded, mapping);

      expect(decoded).toBe(prompt);
      expect(encoded).toBe("User 000 logged in. User 000 logged out.");
    });

    test("roundtrip with Unicode content", () => {
      const prompt = "用户 123e4567-e89b-42d3-a456-426655440000 发送了消息 🎉";

      const { encoded, mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      const decoded = decode(encoded, mapping);

      expect(decoded).toBe(prompt);
    });
  });

  describe("InputFormat enum values", () => {
    test("UUID format works", () => {
      const prompt = "ID: 123e4567-e89b-42d3-a456-426655440000";

      const { encoded } = encode(prompt, UUID_NUMERIC_CONFIG);
      expect(encoded).toBe("ID: 000");
    });

    test("ULID format works", () => {
      const prompt = "ID: 01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const config: EncodeConfig = {
        inputFormat: "ULID",
        outputFormat: "Numeric",
      };

      const { encoded } = encode(prompt, config);
      expect(encoded).toBe("ID: 000");
    });

    test("ULID case insensitive", () => {
      const prompt = "ID: 01arz3ndektsv4rrffq69g5fav";
      const config: EncodeConfig = {
        inputFormat: "ULID",
        outputFormat: "Numeric",
      };

      const { encoded } = encode(prompt, config);
      expect(encoded).toBe("ID: 000");
    });
  });

  describe("OutputFormat enum values", () => {
    const uuidPrompt = "ID: 123e4567-e89b-42d3-a456-426655440000";

    test("Numeric format", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });
      expect(encoded).toBe("ID: 000");
    });

    test("IdToken format", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: "IdToken",
      });
      expect(encoded).toBe("ID: 0");
    });

    test("Passthrough format", () => {
      const { encoded, mapping } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: "Passthrough",
      });
      expect(encoded).toBe(uuidPrompt);
      expect(mapping).toEqual({});
    });
  });

  describe("Edge cases", () => {
    test("empty string input", () => {
      const { encoded, mapping } = encode("", {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });

      expect(encoded).toBe("");
      expect(mapping).toEqual({});
    });

    test("no IDs in input returns original", () => {
      const prompt = "This has no identifiers at all";
      const { encoded, mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });

      expect(encoded).toBe(prompt);
      expect(mapping).toEqual({});
    });

    test("many IDs with triplet expansion", () => {
      // Generate 1001 unique UUIDs to trigger 6-digit placeholders
      const uuids = Array.from({ length: 1001 }, (_, i) => makeUuid(i));
      const prompt = uuids.join(" ");
      const { encoded, mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });

      // First placeholder should be "000"
      expect(mapping["000"]).toBeDefined();
      // 1000th placeholder should be "999"
      expect(mapping["999"]).toBeDefined();
      // 1001st placeholder should be "001000" (6 digits)
      expect(mapping["001000"]).toBeDefined();

      // Roundtrip should work
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(prompt);
    });
  });

  describe("Placeholder formats", () => {
    test("zeroFilled smart triplet expansion", () => {
      // Single ID -> "000"
      let result = encode(`ID: ${makeUuid(0)}`, {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });
      expect(Object.keys(result.mapping)[0]).toBe("000");

      // 10 IDs -> "000" through "009"
      const tenUuids = Array.from({ length: 10 }, (_, i) => makeUuid(i)).join(" ");
      result = encode(tenUuids, {
        inputFormat: "UUID",
        outputFormat: "Numeric",
      });
      expect(Object.keys(result.mapping).sort()).toEqual([
        "000",
        "001",
        "002",
        "003",
        "004",
        "005",
        "006",
        "007",
        "008",
        "009",
      ]);
    });

    test("base62 IdToken format", () => {
      // Generate 63 UUIDs to test base62 rollover
      const manyUuids = Array.from({ length: 63 }, (_, i) => makeUuid(i)).join(" ");
      const result = encode(manyUuids, {
        inputFormat: "UUID",
        outputFormat: "IdToken",
      });

      // First few should be 0-9, A-Z, a-z
      expect(result.mapping["0"]).toBeDefined();
      expect(result.mapping["9"]).toBeDefined();
      expect(result.mapping["A"]).toBeDefined();
      expect(result.mapping["Z"]).toBeDefined();
      expect(result.mapping["a"]).toBeDefined();
      expect(result.mapping["z"]).toBeDefined();
      // 62nd ID should be "10"
      expect(result.mapping["10"]).toBeDefined();
    });
  });

  describe("Error handling", () => {
    test("decode with valid mapping works", () => {
      const { encoded, mapping } = encode(
        "User 123e4567-e89b-42d3-a456-426655440000",
        UUID_NUMERIC_CONFIG
      );
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe("User 123e4567-e89b-42d3-a456-426655440000");
    });

    test("decode with empty mapping returns original", () => {
      const decoded = decode("Some text", {});
      expect(decoded).toBe("Some text");
    });

    test("decode handles missing placeholders gracefully", () => {
      // If a placeholder in the text isn't in the mapping, it stays as-is
      const decoded = decode("User 000 and 001", { "000": "uuid-here" });
      expect(decoded).toBe("User uuid-here and 001");
    });
  });

  describe("UUID case handling", () => {
    test("uppercase UUIDs are normalized to lowercase", () => {
      const prompt = "ID: 123E4567-E89B-42D3-A456-426655440000";

      const { mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      // Should store lowercase version
      expect(mapping["000"]).toBe("123e4567-e89b-42d3-a456-426655440000");
    });

    test("mixed case UUIDs deduplicate correctly", () => {
      const prompt =
        "ID: 123e4567-e89b-42d3-a456-426655440000 and 123E4567-E89B-42D3-A456-426655440000";

      const { encoded, mapping } = encode(prompt, UUID_NUMERIC_CONFIG);
      // Both should map to same placeholder
      expect(encoded).toBe("ID: 000 and 000");
      expect(Object.keys(mapping).length).toBe(1);
    });
  });

  describe("Custom regex input format", () => {
    test("custom regex with RegExp object", () => {
      const prompt = "User user-123456 logged in, then user-789012 logged out";
      const { encoded, mapping } = encode(prompt, {
        inputFormat: /user-\d{6}/gi,
        outputFormat: "Numeric",
      });

      expect(encoded).toBe("User 000 logged in, then 001 logged out");
      expect(mapping["000"]).toBe("user-123456");
      expect(mapping["001"]).toBe("user-789012");
    });

    test("custom regex roundtrip", () => {
      const prompt = "Order ORD-ABC-123 shipped to customer CUST-XYZ-789";
      const { encoded, mapping } = encode(prompt, {
        inputFormat: /[A-Z]{3,4}-[A-Z]{3}-\d{3}/gi,
        outputFormat: "Numeric",
      });

      const decoded = decode(encoded, mapping);
      // IDs are lowercased, surrounding text preserved
      expect(decoded).toBe("Order ord-abc-123 shipped to customer cust-xyz-789");
    });

    test("custom regex without global flag gets global added", () => {
      const prompt = "ID: abc123 and def456";
      const { encoded } = encode(prompt, {
        inputFormat: /[a-z]{3}\d{3}/, // no 'g' flag
        outputFormat: "Numeric",
      });

      // Should still match all occurrences
      expect(encoded).toBe("ID: 000 and 001");
    });
  });

  describe("Custom output format - templates", () => {
    const uuidPrompt =
      "User 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab";

    test("template with plain {i}", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "<id:{i}>" },
      });

      expect(encoded).toBe("User <id:0> and <id:1>");
    });

    test("template with {i:base62}", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "[ID_{i:base62}]" },
      });

      expect(encoded).toBe("User [ID_0] and [ID_1]");
    });

    test("template with {i:04} zero-padding", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "ID{i:04}" },
      });

      expect(encoded).toBe("User ID0000 and ID0001");
    });

    test("template with {i:zeroFilled} smart triplet expansion", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "[[{i:zeroFilled}]]" },
      });

      expect(encoded).toBe("User [[000]] and [[001]]");
    });

    test("template roundtrip", () => {
      const { encoded, mapping } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "[[id:{i}]]" },
      });

      expect(encoded).toBe("User [[id:0]] and [[id:1]]");
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(
        "User 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab"
      );
    });

    test("invalid template throws error", () => {
      expect(() =>
        encode("test 123e4567-e89b-42d3-a456-426655440000", {
          inputFormat: "UUID",
          outputFormat: { template: "no_placeholder" },
        })
      ).toThrow("must contain {i}");
    });
  });

  describe("Custom output format - functions", () => {
    const uuidPrompt =
      "User 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab";

    test("custom formatter function", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: (i) => `[[ID_${i}]]`,
      });

      expect(encoded).toBe("User [[ID_0]] and [[ID_1]]");
    });

    test("hex formatter function", () => {
      const { encoded } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: (i) => `0x${i.toString(16).toUpperCase()}`,
      });

      expect(encoded).toBe("User 0x0 and 0x1");
    });

    test("function formatter roundtrip", () => {
      const { encoded, mapping } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: (i) => `{${i}}`,
      });

      expect(encoded).toBe("User {0} and {1}");
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(
        "User 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab"
      );
    });

    test("an empty placeholder is rejected, naming the index that produced it", () => {
      const names = ["ALPHA"];
      expect(() =>
        encode(uuidPrompt, { inputFormat: "UUID", outputFormat: (i) => names[i] ?? "" })
      ).toThrow(/index 1/);
    });

    test("a formatter that hands back a non-string is rejected", () => {
      expect(() =>
        encode(uuidPrompt, {
          inputFormat: "UUID",
          // @ts-expect-error a caller with no types can return anything
          outputFormat: (i) => (i === 0 ? "A" : undefined),
        })
      ).toThrow(/index 1/);
    });
  });

  describe("Shared encode state across turns", () => {
    const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
    const first = "123e4567-e89b-42d3-a456-426655440000";
    const second = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

    test("an id minted after an earlier decode still decodes", () => {
      const state = createEncodeState();

      encode(`Look at ${first}`, config, state);
      expect(decode("~000~", state.mapping)).toBe(first);

      encode(`And ${second}`, config, state);

      expect(decode("~001~", state.mapping)).toBe(second);
      expect(decode("~000~ and ~001~", state.mapping)).toBe(`${first} and ${second}`);
    });

    // A template is any string carrying {i}, so a placeholder can hold a regex metacharacter.
    // An unescaped one either over-matches the decoy or, for ^ and $, anchors the pattern so it
    // matches nothing at all, and the first assertion catches that.
    test.each([
      { template: "a.{i}.b", decoy: "aX0Yb" },
      { template: "a*{i}", decoy: "0" },
      { template: "a+{i}", decoy: "aaa0" },
      { template: "a?{i}", decoy: "0" },
      { template: "^{i}^", decoy: "nothing to decode here" },
      { template: "${i}$", decoy: "nothing to decode here" },
      { template: "\\d{i}", decoy: "70" },
    ])("a $template placeholder decodes itself and nothing else", ({ template, decoy }) => {
      const { encoded, mapping } = encode(`Look at ${first}`, {
        inputFormat: "UUID",
        outputFormat: { template },
      });

      expect(decode(encoded, mapping)).toBe(`Look at ${first}`);
      expect(decode(decoy, mapping)).toBe(decoy);
    });

    test("a key replaced at the first position is noticed too", () => {
      const mapping: Record<string, string> = { "~000~": first };

      expect(decode("~000~", mapping)).toBe(first);

      delete mapping["~000~"];
      mapping["~001~"] = second;

      expect(decode("~000~ ~001~", mapping)).toBe(`~000~ ${second}`);
    });

    test("an unchanged mapping is decoded without rebuilding the pattern", () => {
      // Mixed widths, so the longest-first sort reorders them and the cache cannot be comparing
      // the array the sort rewrote
      const mapping: Record<string, string> = {};
      for (let i = 0; i < 200; i++) mapping[`~${i}~`] = `id-${i}`;

      decode("~0~", mapping);

      const RealRegExp = globalThis.RegExp;
      let built = 0;
      globalThis.RegExp = new Proxy(RealRegExp, {
        construct(target, args: ConstructorParameters<typeof RegExp>) {
          built++;
          return new target(...args);
        },
      });
      try {
        for (let i = 0; i < 50; i++) decode("~0~ ~100~", mapping);
      } finally {
        globalThis.RegExp = RealRegExp;
      }

      expect(built).toBe(0);
    });

    test("an empty key would match everywhere, so it is refused", () => {
      expect(() => decode("hello", { "": "X" })).toThrow(/empty placeholder key/);
    });

    test("a key replaced at the same count decodes against the keys the mapping holds now", () => {
      const third = "3f1c1a2a-60a6-444f-915f-7960a929fb78";
      const mapping: Record<string, string> = { "~000~": first, "~001~": second };

      expect(decode("~000~ ~001~", mapping)).toBe(`${first} ${second}`);

      delete mapping["~001~"];
      mapping["~777~"] = third;

      expect(decode("~000~ ~001~ ~777~", mapping)).toBe(`${first} ~001~ ${third}`);
    });
  });

  describe("SafeNumeric format", () => {
    const uuidPrompt = "User 123e4567-e89b-42d3-a456-426655440000";

    test("default delimiters use tildes", () => {
      const { encoded, mapping } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: "SafeNumeric",
      });

      expect(encoded).toBe("User ~000~");
      expect(mapping["~000~"]).toBe("123e4567-e89b-42d3-a456-426655440000");
    });

    test("custom delimiters via template", () => {
      // For custom delimiters, use template format instead of SafeNumeric
      const { encoded, mapping } = encode(uuidPrompt, {
        inputFormat: "UUID",
        outputFormat: { template: "ID_{i:03}_" },
      });

      expect(encoded).toBe("User ID_000_");
      expect(mapping["ID_000_"]).toBe("123e4567-e89b-42d3-a456-426655440000");
    });

    test("roundtrip with SafeNumeric", () => {
      const prompt =
        "User 123e4567-e89b-42d3-a456-426655440000 sent message to 987fcdeb-51a2-43f7-8d9c-0123456789ab";
      const { encoded, mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "SafeNumeric",
      });

      expect(encoded).toBe("User ~000~ sent message to ~001~");
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(prompt);
    });

    test("no collision with natural numbers", () => {
      const prompt = "User 123e4567-e89b-42d3-a456-426655440000";
      const { mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "SafeNumeric",
      });

      // LLM response contains natural "000" - should NOT be decoded
      const response = "Error code 000 for user ~000~";
      const decoded = decode(response, mapping);
      expect(decoded).toBe("Error code 000 for user 123e4567-e89b-42d3-a456-426655440000");
    });

    test("multiple UUIDs with SafeNumeric", () => {
      const prompt =
        "A: 123e4567-e89b-42d3-a456-426655440000, B: 987fcdeb-51a2-43f7-8d9c-0123456789ab, " +
        "A again: 123e4567-e89b-42d3-a456-426655440000";
      const { encoded, mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "SafeNumeric",
      });

      expect(encoded).toBe("A: ~000~, B: ~001~, A again: ~000~");
      expect(Object.keys(mapping).length).toBe(2);

      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(prompt);
    });

    test("SafeNumeric with triplet expansion for many IDs", () => {
      // Generate 1001 unique UUIDs to trigger 6-digit placeholders
      const uuids = Array.from({ length: 1001 }, (_, i) => makeUuid(i));
      const prompt = uuids.join(" ");
      const { encoded, mapping } = encode(prompt, {
        inputFormat: "UUID",
        outputFormat: "SafeNumeric",
      });

      // First placeholder should be "~000~"
      expect(mapping["~000~"]).toBeDefined();
      // 1000th placeholder should be "~999~"
      expect(mapping["~999~"]).toBeDefined();
      // 1001st placeholder should be "~001000~" (6 digits)
      expect(mapping["~001000~"]).toBeDefined();

      // Roundtrip should work
      const decoded = decode(encoded, mapping);
      expect(decoded).toBe(prompt);
    });
  });

  describe("findPlaceholders", () => {
    test("returns each distinct SafeNumeric placeholder in the text", () => {
      const text = "See [A](creator://~053~), [B](creator://~001000~) and ~053~ again";

      expect(findPlaceholders(text, "SafeNumeric")).toEqual(["~053~", "~001000~"]);
    });

    test("finds every placeholder in a run that touches, wherever the run starts", () => {
      expect(findPlaceholders("ids: ~053~~081~", "SafeNumeric")).toEqual(["~053~", "~081~"]);
      expect(findPlaceholders("~053~~081~", "SafeNumeric")).toEqual(["~053~", "~081~"]);
      expect(findPlaceholders("~053~~081~~092~", "SafeNumeric")).toEqual([
        "~053~",
        "~081~",
        "~092~",
      ]);
    });

    test("a format with only a closing delimiter never consults the doubling rule", () => {
      expect(findPlaceholders("000>>", { template: "{i:03}>" })).toEqual(["000>"]);
    });

    test("returns a body the format would have padded, which is how a model invents one", () => {
      expect(findPlaceholders("see ~5~ and ~42~ and ~001000~", "SafeNumeric")).toEqual([
        "~5~",
        "~42~",
        "~001000~",
      ]);
    });

    test("ignores a body outside the format's character set", () => {
      expect(findPlaceholders("see ~a1~ and ~~ and ~-5~", "SafeNumeric")).toEqual([]);
    });

    test("finds nothing for a formatter that ignores its index", () => {
      expect(findPlaceholders("a X b", () => "X")).toEqual([]);
    });

    test("finds nothing for a formatter that throws above its range", () => {
      const labels = ["<a>", "<b>"];
      const formatter = (index: number) => {
        if (index >= labels.length) throw new RangeError(`index ${index} out of range`);
        return labels[index];
      };

      expect(findPlaceholders("a <a> b", formatter)).toEqual([]);
    });

    test("finds nothing for a template without an index", () => {
      expect(findPlaceholders("a <x> b", { template: "no-index-here" })).toEqual([]);
    });

    test("ignores markdown strikethrough around digits", () => {
      expect(findPlaceholders("was ~~120~~ now 90", "SafeNumeric")).toEqual([]);
    });

    test.each<[string, OutputFormat, string, string]>([
      ["a template", { template: "<id:{i}>" }, "<id:7>", "<id:seven>"],
      ["a base62 template", { template: "[{i:base62}]" }, "[zZ9]", "[z-9]"],
      ["a padded prefix template", { template: "ID_{i:04}" }, "ID_0042", "ID_"],
      ["a formatter function", (i) => `[[ID_${i}]]`, "[[ID_12]]", "[[ID_]]"],
      ["an offset formatter function", (i) => `<${i + 1}>`, "<3>", "<>"],
    ])("matches placeholders of %s", (_, outputFormat, placeholder, lookalike) => {
      expect(findPlaceholders(`a ${placeholder} b ${lookalike}`, outputFormat)).toEqual([
        placeholder,
      ]);
    });

    test.each<[OutputFormat]>([["Numeric"], ["IdToken"], ["Passthrough"]])(
      "%s finds nothing, since its placeholders look like ordinary text",
      (outputFormat) => {
        expect(findPlaceholders("Order 000 has 0 items ~000~", outputFormat)).toEqual([]);
      }
    );

    test("finds nothing for a formatter function that only covers small indices", () => {
      const labels = ["<a>", "<b>"];

      expect(findPlaceholders("<a> <b>", (i) => labels[i])).toEqual([]);
    });
  });
});
