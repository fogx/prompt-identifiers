/**
 * Dedicated streaming decoder tests.
 *
 * The formats table runs the same cases over five delimiter arrangements, including the ones
 * where a closing delimiter is a prefix of an opening one. The describes after it cover bodies
 * that are not digits, formats with no closing delimiter, and the stream's own bookkeeping.
 */

import { describe, test, expect, vi } from "vitest";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { decode, encode, type EncodeConfig } from "prompt-identifiers";
import { promptIdentifiersMiddleware } from "../src/index";
import {
  collectStreamParts,
  collectStreamText,
  createMiddleware,
  createMockModel,
  createMockStream,
  createParams,
  mockFinishReason,
  mockModel,
  mockUsage,
  userMessage,
} from "./test-helpers";

// =============================================================================
// Test format configurations
// =============================================================================

interface FormatDef {
  label: string;
  config: EncodeConfig;
  /** Example placeholder for the first ID (index 0) */
  p0: string;
  /** Example placeholder for the second ID (index 1) */
  p1: string;
  /** The opening delimiter */
  open: string;
  /** The closing delimiter */
  close: string;
}

const formats: FormatDef[] = [
  {
    label: "SafeNumeric ~000~",
    config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
    p0: "~000~",
    p1: "~001~",
    open: "~",
    close: "~",
  },
  {
    label: "Angle bracket <000>",
    config: {
      inputFormat: "UUID",
      outputFormat: { template: "<{i:zeroFilled}>" },
    },
    p0: "<000>",
    p1: "<001>",
    open: "<",
    close: ">",
  },
  {
    label: "Double bracket [[000]]",
    config: {
      inputFormat: "UUID",
      outputFormat: { template: "[[{i:zeroFilled}]]" },
    },
    p0: "[[000]]",
    p1: "[[001]]",
    open: "[[",
    close: "]]",
  },
  {
    label: "Tilde-ID ~ID000~ (CLOSE is prefix of OPEN)",
    config: {
      inputFormat: "UUID",
      outputFormat: { template: "~ID{i:zeroFilled}~" },
    },
    p0: "~ID000~",
    p1: "~ID001~",
    open: "~ID",
    close: "~",
  },
  {
    label: "Tilde ~000ID~ (OPEN is prefix of CLOSE)",
    config: {
      inputFormat: "UUID",
      outputFormat: { template: "~{i:zeroFilled}ID~" },
    },
    p0: "~000ID~",
    p1: "~001ID~",
    open: "~",
    close: "ID~",
  },
];

// =============================================================================
// Helpers
// =============================================================================

const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";
const uuid3 = "aabbccdd-1122-4334-8556-6677889900aa";
const uuid4 = "deadbeef-cafe-4bab-9000-111222333444";
const uuid5 = "facefeed-dead-4bee-af00-aabbccddeeff";

/**
 * Stream a response through the middleware and collect all text output.
 * The prompt encodes the given UUIDs, and the stream chunks are the "LLM response".
 */
async function streamAndCollect(
  config: EncodeConfig,
  uuids: string[],
  chunks: string[],
  partType: "text-delta" | "reasoning-delta" = "text-delta"
): Promise<string> {
  // Build a prompt that contains all UUIDs so they get encoded
  const promptText = uuids.map((u, i) => `id${i}=${u}`).join(" ");
  const middleware = createMiddleware({ config });

  const params = createParams([userMessage(promptText)]);
  const transformedParams = await middleware.transformParams({
    params,
    type: "stream",
    model: mockModel,
  });

  // Every delta of one block carries that block's id, which is what a provider sends
  const streamParts: LanguageModelV4StreamPart[] = chunks.map((delta) => ({
    type: partType,
    id: "block-1",
    delta,
  }));

  const mockStreamResult = { stream: createMockStream(streamParts) };

  const result = await middleware.wrapStream({
    doStream: vi.fn().mockResolvedValue(mockStreamResult),
    doGenerate: vi.fn(),
    params: transformedParams,
    model: mockModel,
  });

  if (partType === "text-delta") {
    return collectStreamText(result.stream);
  }

  const parts = await collectStreamParts(result.stream);
  return parts
    .filter((p) => p.type === partType)
    .map((p) => ("delta" in p ? p.delta : ""))
    .join("");
}

/**
 * Stream a tool input through the middleware and collect the tool-input deltas.
 */
async function streamToolInputAndCollect(
  config: EncodeConfig,
  uuids: string[],
  chunks: string[]
): Promise<string> {
  const promptText = uuids.map((u, i) => `id${i}=${u}`).join(" ");
  const middleware = createMiddleware({ config });

  const params = createParams([userMessage(promptText)]);
  const transformedParams = await middleware.transformParams({
    params,
    type: "stream",
    model: mockModel,
  });

  const streamParts = [
    { type: "tool-input-start", id: "call-1", toolName: "lookup" },
    ...chunks.map((delta) => ({ type: "tool-input-delta", id: "call-1", delta })),
    { type: "tool-input-end", id: "call-1" },
  ] as LanguageModelV4StreamPart[];

  const result = await middleware.wrapStream({
    doStream: vi.fn().mockResolvedValue({ stream: createMockStream(streamParts) }),
    doGenerate: vi.fn(),
    params: transformedParams,
    model: mockModel,
  });

  const parts = await collectStreamParts(result.stream);
  return parts
    .filter((p) => p.type === "tool-input-delta")
    .map((p) => ("delta" in p ? p.delta : ""))
    .join("");
}

// =============================================================================
// Parameterized tests
// =============================================================================

describe.each(formats)("Streaming decoder: $label", (fmt) => {
  const { config, p0, p1, open, close } = fmt;

  // ─── Basic ──────────────────────────────────────────────────────
  test("single placeholder in one chunk", async () => {
    const text = await streamAndCollect(config, [uuid1], [`Found ${p0} in DB.`]);
    expect(text).toBe(`Found ${uuid1} in DB.`);
  });

  test("multiple placeholders in one chunk", async () => {
    const text = await streamAndCollect(config, [uuid1, uuid2], [`User ${p0} and ${p1}.`]);
    expect(text).toBe(`User ${uuid1} and ${uuid2}.`);
  });

  // ─── Split at every point of a placeholder ──────────────────────
  test("split at opener", async () => {
    // e.g., "User " + "[000]" or "User " + "~000~"
    const text = await streamAndCollect(config, [uuid1], ["User ", `${p0} found.`]);
    expect(text).toBe(`User ${uuid1} found.`);
  });

  test("split mid-digits", async () => {
    // e.g., "User [0" + "00]" or "User ~0" + "00~"
    const text = await streamAndCollect(config, [uuid1], [`User ${open}0`, `00${close} found.`]);
    expect(text).toBe(`User ${uuid1} found.`);
  });

  test("split at closer", async () => {
    // e.g., "User [000" + "]" or "User ~000" + "~"
    const text = await streamAndCollect(config, [uuid1], [`User ${open}000`, `${close} found.`]);
    expect(text).toBe(`User ${uuid1} found.`);
  });

  test("tool input placeholder split across two deltas", async () => {
    const text = await streamToolInputAndCollect(
      config,
      [uuid1],
      [`{"id":"${open}0`, `00${close}"}`]
    );
    expect(text).toBe(`{"id":"${uuid1}"}`);
  });

  test("reasoning placeholder split across two deltas", async () => {
    const text = await streamAndCollect(
      config,
      [uuid1],
      [`User ${open}0`, `00${close} found.`],
      "reasoning-delta"
    );
    expect(text).toBe(`User ${uuid1} found.`);
  });

  test("split opener from digits from closer (3 chunks)", async () => {
    const text = await streamAndCollect(
      config,
      [uuid1],
      [`User ${open}`, "000", `${close} found.`]
    );
    expect(text).toBe(`User ${uuid1} found.`);
  });

  // ─── Multiple placeholders split across chunks ────────────────
  test("two placeholders interleaved across chunks", async () => {
    const text = await streamAndCollect(
      config,
      [uuid1, uuid2],
      [`A=${open}00`, `0${close} B=${open}0`, `01${close} done.`]
    );
    expect(text).toBe(`A=${uuid1} B=${uuid2} done.`);
  });

  // ─── Flush: remaining buffer at stream end ─────────────────────
  test("a stream ending mid-placeholder keeps the tail out of the output", async () => {
    const text = await streamAndCollect(config, [uuid1], [`User ${open}000`]);
    // The tail can still grow into a placeholder, so it is held; onDecode gets it back
    expect(text).toBe("User ");
  });

  test("a placeholder arriving whole as the last chunk needs no flush", async () => {
    // Every format here has a closer, so the match completes inside the chunk that carries it and
    // nothing is left held. The case is the boundary: a placeholder with no text after it
    const text = await streamAndCollect(config, [uuid1], ["User ", `${p0}`]);
    expect(text).toBe(`User ${uuid1}`);
  });

  // ─── URL patterns ──────────────────────────────────────────────
  test("URL with placeholder", async () => {
    const text = await streamAndCollect(config, [uuid1], [`campaign://${p0}/edit`]);
    expect(text).toBe(`campaign://${uuid1}/edit`);
  });

  test("URL with split placeholder", async () => {
    const text = await streamAndCollect(
      config,
      [uuid1],
      [`campaign://${open}00`, `0${close}/edit`]
    );
    expect(text).toBe(`campaign://${uuid1}/edit`);
  });

  // ─── Char-by-char stress ───────────────────────────────────────
  test("char-by-char streaming", async () => {
    const response = `User ${p0} and ${p1} done.`;
    const chars = response.split("");

    const text = await streamAndCollect(config, [uuid1, uuid2], chars);
    expect(text).toBe(`User ${uuid1} and ${uuid2} done.`);
  });

  // ─── Round-trip: 5 UUIDs ───────────────────────────────────────
  test("round-trip with 5 UUIDs", async () => {
    const uuids = [uuid1, uuid2, uuid3, uuid4, uuid5];
    const { encoded, mapping } = encode(uuids.map((u, i) => `item${i}=${u}`).join(", "), config);

    // Stream the encoded text in 3-character chunks
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += 3) {
      chunks.push(encoded.substring(i, i + 3));
    }

    const text = await streamAndCollect(config, uuids, chunks);

    // All UUIDs should be restored
    for (const uuid of uuids) {
      expect(text).toContain(uuid);
    }
  });
});

// =============================================================================
// Symmetric-specific edge cases
// =============================================================================

describe("Streaming decoder: symmetric delimiter edge cases", () => {
  const tildeConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  test("hello ~000~ → decode all (last ~ is closer)", async () => {
    const text = await streamAndCollect(tildeConfig, [uuid1], ["hello ", "~000~"]);
    expect(text).toBe(`hello ${uuid1}`);
  });

  test("hello ~00 → partial → buffer ~00", async () => {
    // Two chunks: "hello ~00" then "0~ end"
    const text = await streamAndCollect(tildeConfig, [uuid1], ["hello ~00", "0~ end"]);
    expect(text).toBe(`hello ${uuid1} end`);
  });

  test("text~~000~ → look-back finds ~000 → closer → decode all", async () => {
    // The ~ at position after "text" is a natural tilde in text
    const text = await streamAndCollect(tildeConfig, [uuid1], ["text~", "~000~"]);
    expect(text).toBe(`text~${uuid1}`);
  });

  test("hello~world ~ → no valid opener before → buffer ~", async () => {
    // "hello~world " then "~" — the ~ at end might be an opener
    // Then "000~ done" completes it
    const text = await streamAndCollect(tildeConfig, [uuid1], ["hello~world ", "~", "000~ done"]);
    expect(text).toBe(`hello~world ${uuid1} done`);
  });

  test("~000~text~00 → buffer ~00, decode ~000~text", async () => {
    // Stream "~000~text~00" then "1~ end"
    const text = await streamAndCollect(tildeConfig, [uuid1, uuid2], ["~000~text~00", "1~ end"]);
    expect(text).toBe(`${uuid1}text${uuid2} end`);
  });

  test("multiple symmetric placeholders fully in one chunk", async () => {
    const text = await streamAndCollect(tildeConfig, [uuid1, uuid2], [`~000~ and ~001~`]);
    expect(text).toBe(`${uuid1} and ${uuid2}`);
  });

  test("symmetric placeholder split at every position", async () => {
    // ~000~ split as: "~" "0" "0" "0" "~"
    const text = await streamAndCollect(tildeConfig, [uuid1], ["User ~", "0", "0", "0", "~ end"]);
    expect(text).toBe(`User ${uuid1} end`);
  });

  test("back-to-back symmetric placeholders", async () => {
    const text = await streamAndCollect(tildeConfig, [uuid1, uuid2], ["~000~~001~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("back-to-back symmetric placeholders split between them", async () => {
    const text = await streamAndCollect(tildeConfig, [uuid1, uuid2], ["~000~", "~001~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("tilde in URL context", async () => {
    const text = await streamAndCollect(
      tildeConfig,
      [uuid1],
      ["https://example.com/~000", "~/path"]
    );
    expect(text).toBe(`https://example.com/${uuid1}/path`);
  });
});

// =============================================================================
// Overlapping delimiter edge cases (~ID{i}~ and ~{i}ID~)
// =============================================================================

describe("Streaming decoder: overlapping delimiter edge cases", () => {
  // CLOSE is prefix of OPEN: ~ID000~ (OPEN=~ID, CLOSE=~)
  const closePrefixConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: { template: "~ID{i:zeroFilled}~" },
  };

  // OPEN is suffix of CLOSE: ~000ID~ (OPEN=~, CLOSE=ID~)
  const openSuffixConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: { template: "~{i:zeroFilled}ID~" },
  };

  // ─── Back-to-back placeholders with shared delimiter chars ─────
  test("~ID: back-to-back (closing ~ adjacent to opening ~ID)", async () => {
    const text = await streamAndCollect(closePrefixConfig, [uuid1, uuid2], ["~ID000~~ID001~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("~ID: back-to-back split between them", async () => {
    const text = await streamAndCollect(closePrefixConfig, [uuid1, uuid2], ["~ID000~", "~ID001~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("ID~: back-to-back (closing ID~ contains opening ~)", async () => {
    const text = await streamAndCollect(openSuffixConfig, [uuid1, uuid2], ["~000ID~~001ID~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("ID~: back-to-back split between them", async () => {
    const text = await streamAndCollect(openSuffixConfig, [uuid1, uuid2], ["~000ID~", "~001ID~"]);
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  // ─── Natural text containing delimiter substrings ──────────────
  test("~ID: literal ~ in text doesn't trigger false decode", async () => {
    const text = await streamAndCollect(closePrefixConfig, [uuid1], ["Price is ~$50 for ~ID000~"]);
    expect(text).toBe(`Price is ~$50 for ${uuid1}`);
  });

  test("~ID: literal ~ID in text (not followed by digits)", async () => {
    const text = await streamAndCollect(
      closePrefixConfig,
      [uuid1],
      ["~IDeas are great. ~ID000~ works."]
    );
    expect(text).toBe(`~IDeas are great. ${uuid1} works.`);
  });

  test("ID~: literal ID in text doesn't trigger false decode", async () => {
    const text = await streamAndCollect(openSuffixConfig, [uuid1], ["My ID is ~000ID~ here"]);
    expect(text).toBe(`My ID is ${uuid1} here`);
  });

  test("ID~: literal ~ in text between placeholders", async () => {
    const text = await streamAndCollect(
      openSuffixConfig,
      [uuid1, uuid2],
      ["~000ID~ has a ~ tilde ~001ID~"]
    );
    expect(text).toBe(`${uuid1} has a ~ tilde ${uuid2}`);
  });

  // ─── Overlap at chunk boundary ────────────────────────────────
  test("~ID: chunk ends with closing ~ that could start new ~ID", async () => {
    // The ~ at end of chunk 1 is CLOSE for first placeholder, not start of OPEN
    const text = await streamAndCollect(
      closePrefixConfig,
      [uuid1, uuid2],
      ["~ID000~", " and ~ID001~"]
    );
    expect(text).toBe(`${uuid1} and ${uuid2}`);
  });

  test("~ID: chunk boundary splits closing ~ from OPEN of next placeholder", async () => {
    const text = await streamAndCollect(
      closePrefixConfig,
      [uuid1, uuid2],
      ["~ID000~", "~ID00", "1~"]
    );
    expect(text).toBe(`${uuid1}${uuid2}`);
  });

  test("ID~: chunk ends mid-CLOSE (ID without ~)", async () => {
    const text = await streamAndCollect(openSuffixConfig, [uuid1], ["Result: ~000ID", "~ done"]);
    expect(text).toBe(`Result: ${uuid1} done`);
  });

  test("~ID: chunk ends mid-OPEN (~I without D)", async () => {
    const text = await streamAndCollect(closePrefixConfig, [uuid1], ["Result: ~I", "D000~ done"]);
    expect(text).toBe(`Result: ${uuid1} done`);
  });
});

// =============================================================================
// Integration: wrapLanguageModel streaming
// =============================================================================

describe("Streaming decoder: wrapLanguageModel integration", () => {
  test("bracket format split placeholder through full middleware stack", async () => {
    const config: EncodeConfig = {
      inputFormat: "UUID",
      outputFormat: { template: "[{i:zeroFilled}]" },
    };

    const model = createMockModel({
      onStream: () => [
        { type: "text-delta", id: "1", delta: "User [0" },
        { type: "text-delta", id: "1", delta: "00] found." },
      ],
    });

    const { wrapLanguageModel } = await import("ai");
    const middleware = promptIdentifiersMiddleware({ config, instruction: false });
    const wrappedModel = wrapLanguageModel({ model, middleware });

    const { stream } = await wrappedModel.doStream({
      prompt: [userMessage(`Find ${uuid1}`)],
    });

    const parts = await collectStreamParts(stream);
    const text = parts
      .filter(
        (
          p
        ): p is LanguageModelV4StreamPart & {
          type: "text-delta";
          delta: string;
        } => p.type === "text-delta"
      )
      .map((p) => p.delta)
      .join("");

    expect(text).toBe(`User ${uuid1} found.`);
  });

  test("symmetric tilde format split through full middleware stack", async () => {
    const config: EncodeConfig = {
      inputFormat: "UUID",
      outputFormat: "SafeNumeric",
    };

    const model = createMockModel({
      onStream: () => [
        { type: "text-delta", id: "1", delta: "User ~0" },
        { type: "text-delta", id: "1", delta: "00~ found." },
      ],
    });

    const { wrapLanguageModel } = await import("ai");
    const middleware = promptIdentifiersMiddleware({ config, instruction: false });
    const wrappedModel = wrapLanguageModel({ model, middleware });

    const { stream } = await wrappedModel.doStream({
      prompt: [userMessage(`Find ${uuid1}`)],
    });

    const parts = await collectStreamParts(stream);
    const text = parts
      .filter(
        (
          p
        ): p is LanguageModelV4StreamPart & {
          type: "text-delta";
          delta: string;
        } => p.type === "text-delta"
      )
      .map((p) => p.delta)
      .join("");

    expect(text).toBe(`User ${uuid1} found.`);
  });
});

describe("Streaming decoder: bodies that are not digits", () => {
  // Eleven IDs, so the last one is index 10 and its base62 body is the letter "A"
  const uuids = Array.from(
    { length: 11 },
    (_, i) => `123e4567-e89b-42d3-a456-4266554400${String(i).padStart(2, "0")}`
  );
  const eleventh = uuids[10];

  test.each<[string, EncodeConfig, string, string[]]>([
    [
      "a base62 template",
      { inputFormat: "UUID", outputFormat: { template: "[{i:base62}]" } },
      "[A]",
      ["see [", "A", "] end"],
    ],
    [
      "a symmetric base62 template",
      { inputFormat: "UUID", outputFormat: { template: "|{i:base62}|" } },
      "|A|",
      ["see |", "A", "| end"],
    ],
    [
      "a formatter function writing letters",
      { inputFormat: "UUID", outputFormat: (i) => `<${"abcdefghijk"[i]}>` },
      "<k>",
      ["see <", "k", "> end"],
    ],
  ])("decodes %s split across chunks", async (_, config, placeholder, chunks) => {
    expect(await streamAndCollect(config, uuids, [`see ${placeholder} end`])).toBe(
      `see ${eleventh} end`
    );

    expect(await streamAndCollect(config, uuids, chunks)).toBe(`see ${eleventh} end`);
  });
});

describe("Streaming decoder: placeholders with no closing delimiter", () => {
  test.each<[string, EncodeConfig, number, string, string[]]>([
    // "000" is the placeholder and the "0" after it is the model's own digit
    [
      "Numeric",
      { inputFormat: "UUID", outputFormat: "Numeric" },
      1,
      "Order 0000 units",
      ["Order 000", "0 units"],
    ],
    // Twelve IDs, so "ID1" is a placeholder and also the start of "ID11"
    [
      "a prefix-only template",
      { inputFormat: "UUID", outputFormat: { template: "ID{i}" } },
      12,
      "See ID11 now.",
      ["See ID1", "1 now."],
    ],
  ])("%s split mid-run decodes as the whole text does", async (_, config, count, whole, chunks) => {
    const uuids = Array.from(
      { length: count },
      (_, i) => `123e4567-e89b-42d3-a456-4266554400${String(i).padStart(2, "0")}`
    );
    const { mapping } = encode(uuids.map((u, i) => `id${i}=${u}`).join(" "), config);

    expect(await streamAndCollect(config, uuids, chunks)).toBe(decode(whole, mapping));
  });
});

describe("Streaming decoder: stream bookkeeping", () => {
  const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };

  async function streamParts(parts: LanguageModelV4StreamPart[]) {
    const middleware = createMiddleware({ config });
    const transformedParams = await middleware.transformParams({
      params: createParams([userMessage(`a=${uuid1} b=${uuid2}`)]),
      type: "stream",
      model: mockModel,
    });

    const result = await middleware.wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: createMockStream(parts) }),
      doGenerate: vi.fn(),
      params: transformedParams,
      model: mockModel,
    });
    return collectStreamParts(result.stream);
  }

  test("a tool input that never announced itself is still buffered across chunks", async () => {
    const parts = await streamParts([
      { type: "tool-input-delta", id: "a", delta: '{"id":"~00' },
      { type: "tool-input-delta", id: "a", delta: '0~"}' },
      { type: "tool-input-end", id: "a" },
    ]);

    const deltas = parts
      .filter((part) => part.type === "tool-input-delta")
      .map((part) => ("delta" in part ? part.delta : ""))
      .join("");

    expect(deltas).toBe(`{"id":"${uuid1}"}`);
  });

  test("a repeated tool-input-start keeps what the first one was holding", async () => {
    const parts = await streamParts([
      { type: "tool-input-start", id: "a", toolName: "one" },
      { type: "tool-input-delta", id: "a", delta: '{"id":"~00' },
      { type: "tool-input-start", id: "a", toolName: "one" },
      { type: "tool-input-delta", id: "a", delta: '0~"}' },
      { type: "tool-input-end", id: "a" },
    ]);

    const deltas = parts
      .filter((part) => part.type === "tool-input-delta")
      .map((part) => ("delta" in part ? part.delta : ""))
      .join("");

    expect(deltas).toBe(`{"id":"${uuid1}"}`);
  });

  test("one block's held tail is not completed by another block's text", async () => {
    const parts = await streamParts([
      { type: "text-start", id: "first" },
      { type: "text-delta", id: "first", delta: "one ~00" },
      { type: "text-start", id: "second" },
      { type: "text-delta", id: "second", delta: "two" },
      { type: "text-delta", id: "first", delta: "0~ end" },
      { type: "text-end", id: "first" },
      { type: "text-end", id: "second" },
    ]);

    const textOf = (id: string) =>
      parts
        .filter((part) => part.type === "text-delta" && part.id === id)
        .map((part) => ("delta" in part ? part.delta : ""))
        .join("");

    expect(textOf("first")).toBe(`one ${uuid1} end`);
    expect(textOf("second")).toBe("two");
  });

  test("two tool calls streaming at once keep separate buffers", async () => {
    const parts = await streamParts([
      { type: "tool-input-start", id: "a", toolName: "one" },
      { type: "tool-input-start", id: "b", toolName: "two" },
      { type: "tool-input-delta", id: "a", delta: '{"id":"~0' },
      { type: "tool-input-delta", id: "b", delta: '{"id":"~0' },
      { type: "tool-input-delta", id: "a", delta: '00~"}' },
      { type: "tool-input-delta", id: "b", delta: '01~"}' },
      { type: "tool-input-end", id: "a" },
      { type: "tool-input-end", id: "b" },
    ] as LanguageModelV4StreamPart[]);

    const inputOf = (id: string) =>
      parts
        .filter((p) => p.type === "tool-input-delta" && "id" in p && p.id === id)
        .map((p) => ("delta" in p ? p.delta : ""))
        .join("");

    expect(inputOf("a")).toBe(`{"id":"${uuid1}"}`);
    expect(inputOf("b")).toBe(`{"id":"${uuid2}"}`);
  });

  test("tool-input-end emits a tail the buffer was still holding", async () => {
    const parts = await streamParts([
      { type: "tool-input-start", id: "a", toolName: "one" },
      { type: "tool-input-delta", id: "a", delta: '{"id":"~00' },
      { type: "tool-input-end", id: "a" },
    ] as LanguageModelV4StreamPart[]);

    const text = parts
      .filter((p) => p.type === "tool-input-delta")
      .map((p) => ("delta" in p ? p.delta : ""))
      .join("");

    expect(text).toBe('{"id":"~00');
  });

  test("finish emits a tool input tail when no tool-input-end arrives", async () => {
    const parts = await streamParts([
      { type: "tool-input-start", id: "a", toolName: "one" },
      { type: "tool-input-delta", id: "a", delta: '{"id":"~00' },
      { type: "finish", finishReason: "stop", usage: {} },
    ] as LanguageModelV4StreamPart[]);

    const text = parts
      .filter((p) => p.type === "tool-input-delta")
      .map((p) => ("delta" in p ? p.delta : ""))
      .join("");

    expect(text).toBe('{"id":"~00');
  });

  test("a closing chunk carries the tail, so it reaches the assembled message", async () => {
    const parts = await streamParts([
      { type: "text-delta", id: "1", delta: "Found ~000~ and ~00" },
      { type: "text-end", id: "1" },
    ] as LanguageModelV4StreamPart[]);

    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => ("delta" in p ? p.delta : ""))
      .join("");

    expect(text).toBe(`Found ${uuid1} and ~00`);
  });

  // The reasoning buffer is flushed by its own branch, and report() only ever sees the text one
  describe("a reasoning block ending while the decoder holds a tail", () => {
    const deltas = ["look ~00", "1~ done ~00"];

    function reasoningOf(parts: LanguageModelV4StreamPart[]) {
      return parts
        .filter((p) => p.type === "reasoning-delta")
        .map((p) => ("delta" in p ? p.delta : ""))
        .join("");
    }

    async function reasoningParts(closer: "reasoning-end" | "finish" | "both") {
      const parts: LanguageModelV4StreamPart[] = [
        { type: "reasoning-start", id: "r" },
        ...deltas.map((delta) => ({ type: "reasoning-delta" as const, id: "r", delta })),
      ];
      // Each label is one closing shape and only that one. Pushing `finish` for all three made
      // "reasoning-end" and "both" the same stream, and left the suite with nothing that closes a
      // reasoning block without a finish chunk, which is what an aborted stream looks like
      if (closer !== "finish") parts.push({ type: "reasoning-end", id: "r" });
      if (closer !== "reasoning-end") {
        parts.push({ type: "finish", finishReason: mockFinishReason(), usage: mockUsage() });
      }
      return streamParts(parts);
    }

    test("reasoning-end delivers the held tail", async () => {
      expect(reasoningOf(await reasoningParts("reasoning-end"))).toBe(`look ${uuid2} done ~00`);
    });

    test("finish delivers it when no reasoning-end arrives", async () => {
      expect(reasoningOf(await reasoningParts("finish"))).toBe(`look ${uuid2} done ~00`);
    });

    test("both closers deliver it exactly once", async () => {
      const parts = await reasoningParts("both");

      expect(reasoningOf(parts)).toBe(`look ${uuid2} done ~00`);
      // The tail rides on one delta. Both closers flushing would put it out twice, which the
      // joined text cannot tell from one
      expect(
        parts.filter((p) => p.type === "reasoning-delta" && "delta" in p && p.delta.endsWith("~00"))
      ).toHaveLength(1);
    });

    test("the flushed delta carries the block's own id", async () => {
      // `finish` is the only closer that reaches flushAll: reasoning-end flushes and drops the
      // decoder before finish runs, so under that label the ids come from the other branch
      const ids = (await reasoningParts("finish"))
        .filter((p) => p.type === "reasoning-delta")
        .map((p) => ("id" in p ? p.id : ""));

      expect(ids).toEqual(["r", "r", "r"]);
    });
  });
});
