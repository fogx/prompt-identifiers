/**
 * Integration tests using actual AI SDK functions.
 *
 * These tests use `wrapLanguageModel` from the `ai` package to wrap a mock model
 * with our middleware, then call `doGenerate`/`doStream` on the wrapped model.
 */

import { describe, test, expect, vi } from "vitest";
import type { LanguageModelV4Message, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { streamText, wrapLanguageModel } from "ai";
import type { EncodeConfig } from "prompt-identifiers";
import { promptIdentifiersMiddleware } from "../src/index";
import {
  collectStreamParts,
  createMockModel,
  getResultText,
  getToolCall,
  getToolResultOutput,
  getUserMessageText,
  mockFinishReason,
  mockUsage,
  toolMessage,
  userMessage,
} from "./test-helpers";

describe("AI SDK Integration", () => {
  const defaultConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
  const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

  describe("wrapLanguageModel + doGenerate", () => {
    test("encodes prompt and decodes text response", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "Found user ~000~ in database." }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage(`Find user ${uuid1}`)],
      });

      // Verify prompt was encoded before reaching the model
      expect(getUserMessageText(receivedPrompt[0])).toBe("Find user ~000~");

      // Verify response was decoded
      expect(getResultText(result)).toBe(`Found user ${uuid1} in database.`);
    });

    test("decodes tool call inputs in response", async () => {
      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "create_campaign",
              input: '{"user_id":"~000~","name":"Campaign"}',
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage(`Create campaign for ${uuid1}`)],
      });

      const toolCall = getToolCall(result);
      expect(toolCall).toBeDefined();
      expect(toolCall?.input).toBe(`{"user_id":"${uuid1}","name":"Campaign"}`);
    });

    test("encodes JSON tool result values", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "User ~000~ is active." }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [
          toolMessage("call-1", "get_user", {
            type: "json",
            value: { id: uuid1, name: "Alice" },
          }),
        ],
      });

      const output = getToolResultOutput<{ id: string; name: string }>(receivedPrompt[0]);
      expect(output?.type).toBe("json");
      expect(output?.value.id).toBe("~000~");
      expect(output?.value.name).toBe("Alice");
    });

    test("encodes text tool result values", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "OK" }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [
          toolMessage("call-1", "get_user", {
            type: "text",
            value: `User ${uuid1} found`,
          }),
        ],
      });

      const output = getToolResultOutput<string>(receivedPrompt[0]);
      expect(output?.type).toBe("text");
      expect(output?.value).toBe("User ~000~ found");
    });

    test("deduplicates UUIDs across messages", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "Comparing ~000~ and ~001~." }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [
          userMessage(`User ${uuid1} and ${uuid2}`),
          toolMessage("call-1", "compare", {
            type: "json",
            value: { a: uuid1, b: uuid2 },
          }),
        ],
      });

      // Same UUIDs should get same placeholders across messages
      expect(getUserMessageText(receivedPrompt[0])).toBe("User ~000~ and ~001~");

      const output = getToolResultOutput<{ a: string; b: string }>(receivedPrompt[1]);
      expect(output?.value.a).toBe("~000~");
      expect(output?.value.b).toBe("~001~");

      // Response should decode correctly
      expect(getResultText(result)).toBe(`Comparing ${uuid1} and ${uuid2}.`);
    });
  });

  describe("wrapLanguageModel + doStream", () => {
    test("decodes text deltas in stream", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          { type: "text-delta", id: "1", delta: "Found " },
          { type: "text-delta", id: "2", delta: "~000~" },
          { type: "text-delta", id: "3", delta: " in DB." },
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

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

      expect(text).toBe(`Found ${uuid1} in DB.`);
    });

    test("handles split placeholders across stream chunks", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          { type: "text-delta", id: "1", delta: "User ~0" },
          { type: "text-delta", id: "2", delta: "00~ found." },
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

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

    test("decodes tool-call chunks in stream", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          {
            type: "tool-call",
            id: "1",
            toolCallId: "call-1",
            toolName: "get_user",
            input: '{"id":"~000~"}',
          } as LanguageModelV4StreamPart,
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const { stream } = await wrappedModel.doStream({
        prompt: [userMessage(`Find ${uuid1}`)],
      });

      const parts = await collectStreamParts(stream);
      const toolCall = parts.find((p) => p.type === "tool-call") as { input: string } | undefined;

      expect(toolCall).toBeDefined();
      expect(toolCall?.input).toBe(`{"id":"${uuid1}"}`);
    });

    test("decodes tool-input-delta chunks in stream", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          {
            type: "tool-input-delta",
            id: "1",
            delta: '{"id":"~000~"}',
          } as LanguageModelV4StreamPart,
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const { stream } = await wrappedModel.doStream({
        prompt: [userMessage(`Find ${uuid1}`)],
      });

      const parts = await collectStreamParts(stream);
      const inputDelta = parts.find((p) => p.type === "tool-input-delta") as
        | { delta: string }
        | undefined;

      expect(inputDelta).toBeDefined();
      expect(inputDelta?.delta).toBe(`{"id":"${uuid1}"}`);
    });

    test("preserves non-text stream parts", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          { type: "text-delta", id: "1", delta: "~000~" },
          { type: "text-end", id: "2" },
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const { stream } = await wrappedModel.doStream({
        prompt: [userMessage(`Find ${uuid1}`)],
      });

      const parts = await collectStreamParts(stream);

      expect(parts.some((p) => p.type === "text-end")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("handles empty mapping (no IDs to encode)", async () => {
      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [{ type: "text", text: "Hello world" }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage("Hello, how are you?")],
      });

      expect(getResultText(result)).toBe("Hello world");
    });

    test("handles deeply nested JSON in tool results", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "OK" }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [
          toolMessage("call-1", "get_nested", {
            type: "json",
            value: {
              level1: {
                level2: {
                  level3: {
                    ids: [uuid1, uuid2],
                  },
                },
              },
            },
          }),
        ],
      });

      type NestedValue = { level1: { level2: { level3: { ids: string[] } } } };
      const output = getToolResultOutput<NestedValue>(receivedPrompt[0]);
      expect(output?.value.level1.level2.level3.ids).toEqual(["~000~", "~001~"]);
    });

    test("handles JSON arrays at root level", async () => {
      let receivedPrompt: LanguageModelV4Message[] = [];

      const mockModel = createMockModel({
        onGenerate: (prompt) => {
          receivedPrompt = prompt;
          return {
            content: [{ type: "text", text: "OK" }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          };
        },
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [
          toolMessage("call-1", "get_ids", {
            type: "json",
            value: [uuid1, uuid2],
          }),
        ],
      });

      const output = getToolResultOutput<string[]>(receivedPrompt[0]);
      expect(output?.value).toEqual(["~000~", "~001~"]);
    });

    test("handles tool result with undefined value gracefully", async () => {
      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [{ type: "text", text: "OK" }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      // Should not throw
      const result = await wrappedModel.doGenerate({
        prompt: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "test",
                output: { type: "json" }, // Missing value
              },
            ],
          } as LanguageModelV4Message,
        ],
      });

      expect(result.content).toBeDefined();
    });

    test("handles multiple tool calls in single response", async () => {
      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "get_user",
              input: '{"id":"~000~"}',
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "get_user",
              input: '{"id":"~001~"}',
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, injectInstruction: false });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage(`Find ${uuid1} and ${uuid2}`)],
      });

      const toolCall1 = getToolCall(result, 0);
      const toolCall2 = getToolCall(result, 1);

      expect(toolCall1?.input).toBe(`{"id":"${uuid1}"}`);
      expect(toolCall2?.input).toBe(`{"id":"${uuid2}"}`);
    });
  });

  describe("Callbacks", () => {
    test("onEncode is called with correct mapping", async () => {
      const onEncode = vi.fn();

      const mockModel = createMockModel();
      const middleware = promptIdentifiersMiddleware({
        config: defaultConfig,
        onEncode,
      });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [userMessage(`Find ${uuid1} and ${uuid2}`)],
      });

      expect(onEncode).toHaveBeenCalledWith({
        mapping: expect.objectContaining({
          "~000~": uuid1,
          "~001~": uuid2,
        }),
      });
      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();
    });

    test("onDecode is called after decoding", async () => {
      const onDecode = vi.fn();

      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [{ type: "text", text: "~000~ and ~000~ again" }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({
        config: defaultConfig,
        onDecode,
      });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [userMessage(`Find ${uuid1}`)],
      });

      expect(onDecode).toHaveBeenCalledWith({
        output: `${uuid1} and ${uuid1} again`,
        mapping: { "~000~": uuid1 },
      });
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });

    test("debug mode populates debugData in integration", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      const mockModel = createMockModel({
        onGenerate: () => ({
          content: [{ type: "text", text: "Found ~000~ in DB." }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const middleware = promptIdentifiersMiddleware({
        config: defaultConfig,
        debug: true,
        onEncode,
        onDecode,
      });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      await wrappedModel.doGenerate({
        prompt: [userMessage(`Find ${uuid1}`)],
      });

      // onEncode should have debugData
      const encodeResult = onEncode.mock.calls[0][0];
      expect(encodeResult.debugData).toBeDefined();
      expect(encodeResult.debugData.encodedCount).toBe(1);
      expect(typeof encodeResult.debugData.durationMs).toBe("number");

      // onDecode should have debugData
      const decodeResult = onDecode.mock.calls[0][0];
      expect(decodeResult.debugData).toBeDefined();
      expect(decodeResult.debugData.decodedCount).toBe(1);
      expect(decodeResult.debugData.input).toBe("Found ~000~ in DB.");
      expect(decodeResult.debugData.output).toBe(`Found ${uuid1} in DB.`);
    });
  });
});

describe("AI SDK Integration: V4 content coverage", () => {
  const config: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
  const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

  function wrap(model: ReturnType<typeof createMockModel>) {
    return wrapLanguageModel({
      model,
      middleware: promptIdentifiersMiddleware({ config, injectInstruction: false }),
    });
  }

  /** Sends the prompt through the middleware and returns what the model received. */
  async function promptSeenByModel(
    prompt: LanguageModelV4Message[]
  ): Promise<LanguageModelV4Message[]> {
    let receivedPrompt: LanguageModelV4Message[] = [];
    const model = createMockModel({
      onGenerate: (p) => {
        receivedPrompt = p;
        return {
          content: [{ type: "text", text: "OK" }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        };
      },
    });

    await wrap(model).doGenerate({ prompt });
    return receivedPrompt;
  }

  function fileData(msg: LanguageModelV4Message, index: number): unknown {
    if (msg.role !== "user") return undefined;
    const part = msg.content[index];
    return part.type === "file" ? part.data : undefined;
  }

  function toolResultOutput(msg: LanguageModelV4Message): Record<string, unknown> | undefined {
    if (msg.role !== "tool") return undefined;
    const part = msg.content.find((p) => p.type === "tool-result");
    return part && "output" in part ? (part.output as Record<string, unknown>) : undefined;
  }

  function toolResultMessage(output: unknown): LanguageModelV4Message {
    return {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-1", toolName: "get_user", output }],
    } as LanguageModelV4Message;
  }

  describe("file parts", () => {
    test("encodes inline text carried by a file part", async () => {
      const received = await promptSeenByModel([
        {
          role: "user",
          content: [
            { type: "text", text: `See the attached notes for ${uuid1}` },
            {
              type: "file",
              mediaType: "text/plain",
              data: { type: "text", text: `user ${uuid1} was last seen yesterday` },
            },
          ],
        },
      ]);

      expect(fileData(received[0], 1)).toEqual({
        type: "text",
        text: "user ~000~ was last seen yesterday",
      });
    });

    test("leaves binary, URL and reference file data untouched", async () => {
      const url = new URL("https://example.com/report.pdf");
      const received = await promptSeenByModel([
        {
          role: "user",
          content: [
            { type: "text", text: `Check ${uuid1}` },
            { type: "file", mediaType: "application/pdf", data: { type: "data", data: "YmFzZTY0" } },
            { type: "file", mediaType: "application/pdf", data: { type: "url", url } },
            {
              type: "file",
              mediaType: "application/pdf",
              data: { type: "reference", reference: { openai: uuid1 } },
            },
          ],
        },
      ]);

      expect(fileData(received[0], 1)).toEqual({ type: "data", data: "YmFzZTY0" });
      expect(fileData(received[0], 2)).toEqual({ type: "url", url });
      expect(fileData(received[0], 3)).toEqual({
        type: "reference",
        reference: { openai: uuid1 },
      });
    });
  });

  describe("tool result outputs", () => {
    test("encodes an error-text output", async () => {
      const received = await promptSeenByModel([
        toolResultMessage({ type: "error-text", value: `no such user ${uuid1}` }),
      ]);

      expect(toolResultOutput(received[0])).toEqual({
        type: "error-text",
        value: "no such user ~000~",
      });
    });

    test("encodes an error-json output", async () => {
      const received = await promptSeenByModel([
        toolResultMessage({ type: "error-json", value: { code: "not_found", id: uuid1 } }),
      ]);

      expect(toolResultOutput(received[0])).toEqual({
        type: "error-json",
        value: { code: "not_found", id: "~000~" },
      });
    });

    test("encodes text and inline-text file entries in a content output", async () => {
      const received = await promptSeenByModel([
        toolResultMessage({
          type: "content",
          value: [
            { type: "text", text: `user ${uuid1}` },
            {
              type: "file",
              mediaType: "text/plain",
              data: { type: "text", text: `owner ${uuid2}` },
            },
            { type: "file", mediaType: "image/png", data: { type: "data", data: "YmFzZTY0" } },
          ],
        }),
      ]);

      expect(toolResultOutput(received[0])).toEqual({
        type: "content",
        value: [
          { type: "text", text: "user ~000~" },
          { type: "file", mediaType: "text/plain", data: { type: "text", text: "owner ~001~" } },
          { type: "file", mediaType: "image/png", data: { type: "data", data: "YmFzZTY0" } },
        ],
      });
    });

    test("encodes the reason of an execution-denied output", async () => {
      const received = await promptSeenByModel([
        toolResultMessage({ type: "execution-denied", reason: `user ${uuid1} declined` }),
      ]);

      expect(toolResultOutput(received[0])).toEqual({
        type: "execution-denied",
        reason: "user ~000~ declined",
      });
    });
  });

  describe("reasoning output", () => {
    test("decodes reasoning content in a generate result", async () => {
      const model = createMockModel({
        onGenerate: () => ({
          content: [
            { type: "reasoning", text: "The user asked about ~000~." },
            { type: "text", text: "Done with ~000~." },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
      });

      const result = await wrap(model).doGenerate({ prompt: [userMessage(`Find ${uuid1}`)] });

      const reasoning = result.content.find((c) => c.type === "reasoning");
      expect(reasoning?.type === "reasoning" ? reasoning.text : undefined).toBe(
        `The user asked about ${uuid1}.`
      );
      expect(getResultText(result)).toBe(`Done with ${uuid1}.`);
    });

    test("decodes reasoning deltas in a stream", async () => {
      const model = createMockModel({
        onStream: () => [
          { type: "reasoning-delta", id: "r1", delta: "Looking up ~000~ first." },
          { type: "text-delta", id: "t1", delta: "Found ~000~." },
        ],
      });

      const { stream } = await wrap(model).doStream({ prompt: [userMessage(`Find ${uuid1}`)] });
      const parts = await collectStreamParts(stream);

      expect(deltasOfType(parts, "reasoning-delta")).toBe(`Looking up ${uuid1} first.`);
      expect(deltasOfType(parts, "text-delta")).toBe(`Found ${uuid1}.`);
    });

    test("buffers reasoning deltas separately from text deltas", async () => {
      const model = createMockModel({
        onStream: () => [
          { type: "reasoning-delta", id: "r1", delta: "Ref ~00" },
          { type: "text-delta", id: "t1", delta: `Answer for ~001~.` },
          { type: "reasoning-delta", id: "r2", delta: "0~ noted." },
        ],
      });

      const { stream } = await wrap(model).doStream({
        prompt: [userMessage(`Find ${uuid1} and ${uuid2}`)],
      });
      const parts = await collectStreamParts(stream);

      expect(deltasOfType(parts, "reasoning-delta")).toBe(`Ref ${uuid1} noted.`);
      expect(deltasOfType(parts, "text-delta")).toBe(`Answer for ${uuid2}.`);
    });
  });
});

function deltasOfType(parts: LanguageModelV4StreamPart[], type: "text-delta" | "reasoning-delta") {
  return parts
    .filter((p) => p.type === type)
    .map((p) => ("delta" in p ? p.delta : ""))
    .join("");
}

describe("AI SDK Integration: streamText", () => {
  const config: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  const uuid1 = "123e4567-e89b-42d3-a456-426655440000";

  const finishPart = {
    type: "finish",
    finishReason: mockFinishReason(),
    usage: mockUsage(),
  } as unknown as LanguageModelV4StreamPart;

  function textStreamParts(deltas: string[]): LanguageModelV4StreamPart[] {
    return [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t0" },
      ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t0", delta })),
      { type: "text-end", id: "t0" },
      finishPart,
    ];
  }

  function wrappedModel(deltas: string[]) {
    return wrapLanguageModel({
      model: createMockModel({ onStream: () => textStreamParts(deltas) }),
      middleware: promptIdentifiersMiddleware({ config, injectInstruction: false }),
    });
  }

  test("emits no text-delta after the stream has finished", async () => {
    const { stream } = await wrappedModel(["Item ~000"]).doStream({
      prompt: [userMessage(`Find ${uuid1}`)],
    });

    const types = (await collectStreamParts(stream)).map((p) => p.type);
    expect(types.indexOf("text-delta", types.indexOf("finish"))).toBe(-1);
  });

  test.each([
    { label: "a trailing bare delimiter", deltas: ["The id is ~000~ and cost ~"] },
    { label: "a truncated placeholder", deltas: ["Item ~000"] },
    { label: "a placeholder split across the last two deltas", deltas: ["Item ~0", "00"] },
  ])("textStream and result.text agree with $label", async ({ deltas }) => {
    const result = streamText({
      model: wrappedModel(deltas),
      prompt: `Tell me about ${uuid1}`,
    });

    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;

    expect(await result.text).toBe(streamed);
  });
});
