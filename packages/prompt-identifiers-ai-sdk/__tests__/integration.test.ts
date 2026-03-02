/**
 * Integration tests using actual AI SDK functions.
 *
 * These tests use `wrapLanguageModel` from the `ai` package to wrap a mock model
 * with our middleware, then call `doGenerate`/`doStream` on the wrapped model.
 */

import type { LanguageModelV3Message, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
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
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage(`Create campaign for ${uuid1}`)],
      });

      const toolCall = getToolCall(result);
      expect(toolCall).toBeDefined();
      expect(toolCall?.input).toBe(`{"user_id":"${uuid1}","name":"Campaign"}`);
    });

    test("encodes JSON tool result values", async () => {
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

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

      expect(text).toBe(`Found ${uuid1} in DB.`);
    });

    test("handles split placeholders across stream chunks", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          { type: "text-delta", id: "1", delta: "User ~0" },
          { type: "text-delta", id: "2", delta: "00~ found." },
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

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

    test("decodes tool-call chunks in stream", async () => {
      const mockModel = createMockModel({
        onStream: () => [
          {
            type: "tool-call",
            id: "1",
            toolCallId: "call-1",
            toolName: "get_user",
            input: '{"id":"~000~"}',
          } as LanguageModelV3StreamPart,
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
          } as LanguageModelV3StreamPart,
        ],
      });

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
      const wrappedModel = wrapLanguageModel({ model: mockModel, middleware });

      const result = await wrappedModel.doGenerate({
        prompt: [userMessage("Hello, how are you?")],
      });

      expect(getResultText(result)).toBe("Hello world");
    });

    test("handles deeply nested JSON in tool results", async () => {
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
      let receivedPrompt: LanguageModelV3Message[] = [];

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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
          } as LanguageModelV3Message,
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

      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });
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
      const onEncode = jest.fn();

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
      const onDecode = jest.fn();

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
      const onEncode = jest.fn();
      const onDecode = jest.fn();

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
