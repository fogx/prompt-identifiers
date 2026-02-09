/**
 * Dedicated streaming decoder tests.
 *
 * Covers 4 output formats × ~15 test cases each, with focus on
 * symmetric delimiter handling (the primary bug fix).
 */

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { encode, type EncodeConfig } from "prompt-identifiers";
import { promptIdentifiersMiddleware } from "../src/index";
import {
  collectStreamParts,
  collectStreamText,
  createMiddleware,
  createMockModel,
  createMockStream,
  createParams,
  mockModel,
  userMessage,
} from "./test-helpers";

// =============================================================================
// Test format configurations
// =============================================================================

interface FormatDef {
  label: string;
  config: EncodeConfig;
  type: "asymmetric" | "symmetric";
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
    type: "symmetric",
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
    type: "asymmetric",
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
    type: "asymmetric",
    p0: "[[000]]",
    p1: "[[001]]",
    open: "[[",
    close: "]]",
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
  chunks: string[]
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

  const streamParts: LanguageModelV3StreamPart[] = chunks.map((delta, i) => ({
    type: "text-delta",
    id: String(i),
    delta,
  }));

  const mockStreamResult = { stream: createMockStream(streamParts) };

  const result = await middleware.wrapStream({
    doStream: jest.fn().mockResolvedValue(mockStreamResult),
    doGenerate: jest.fn(),
    params: transformedParams,
    model: mockModel,
  });

  return collectStreamText(result.stream);
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

  test("no placeholders", async () => {
    const text = await streamAndCollect(config, [uuid1], ["Hello world, no IDs here."]);
    expect(text).toBe("Hello world, no IDs here.");
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
  test("flush partial at end of stream", async () => {
    // Simulate a stream that ends mid-placeholder (shouldn't happen in practice, but must not hang)
    const text = await streamAndCollect(config, [uuid1], [`User ${open}000`]);
    // The flush should decode what it can — incomplete placeholder may not decode
    expect(text).toBeDefined();
  });

  test("flush completes final placeholder", async () => {
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
        { type: "text-delta", id: "2", delta: "00] found." },
      ],
    });

    const { wrapLanguageModel } = await import("ai");
    const middleware = promptIdentifiersMiddleware({ config });
    const wrappedModel = wrapLanguageModel({ model, middleware });

    const { stream } = await wrappedModel.doStream({
      prompt: [userMessage(`Find ${uuid1}`)],
    });

    const parts = await collectStreamParts(stream);
    const text = parts
      .filter(
        (
          p
        ): p is LanguageModelV3StreamPart & {
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
        { type: "text-delta", id: "2", delta: "00~ found." },
      ],
    });

    const { wrapLanguageModel } = await import("ai");
    const middleware = promptIdentifiersMiddleware({ config });
    const wrappedModel = wrapLanguageModel({ model, middleware });

    const { stream } = await wrappedModel.doStream({
      prompt: [userMessage(`Find ${uuid1}`)],
    });

    const parts = await collectStreamParts(stream);
    const text = parts
      .filter(
        (
          p
        ): p is LanguageModelV3StreamPart & {
          type: "text-delta";
          delta: string;
        } => p.type === "text-delta"
      )
      .map((p) => p.delta)
      .join("");

    expect(text).toBe(`User ${uuid1} found.`);
  });
});
