import { describe, test, expect, vi } from "vitest";
import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { encode, type EncodeConfig, type OutputFormat } from "prompt-identifiers";
import { promptIdentifiersMiddleware } from "../src/index";
import {
  collectStreamParts,
  collectStreamText,
  createMiddleware,
  createMockStream,
  createParams,
  getTextFromContent,
  mockFinishReason,
  mockModel,
  mockUsage,
  systemMessage,
  toolMessage,
  userMessage,
} from "./test-helpers";

describe("prompt-identifiers-ai-sdk", () => {
  const defaultConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  describe("promptIdentifiersMiddleware", () => {
    test("creates middleware with required hooks", () => {
      const middleware = promptIdentifiersMiddleware({ config: defaultConfig, instruction: false });

      expect(middleware.specificationVersion).toBe("v4");
      expect(middleware.transformParams).toBeDefined();
      expect(middleware.wrapGenerate).toBeDefined();
      expect(middleware.wrapStream).toBeDefined();
    });
  });

  describe("transformParams", () => {
    // Helper to extract user message text from prompt
    function getUserText(prompt: LanguageModelV4Message[], index = 0): string {
      const msg = prompt[index];
      if (msg.role === "user") {
        const textPart = msg.content.find((p) => p.type === "text");
        return textPart?.type === "text" ? textPart.text : "";
      }
      return "";
    }

    // Helper to extract system message content
    function getSystemContent(prompt: LanguageModelV4Message[], index = 0): string {
      const msg = prompt[index];
      if (msg.role === "system") {
        return typeof msg.content === "string" ? msg.content : "";
      }
      return "";
    }

    test("encodes UUIDs in user message content", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage("Find user 123e4567-e89b-42d3-a456-426655440000 in the database"),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getUserText(result.prompt)).toBe("Find user ~000~ in the database");
    });

    test("encodes UUIDs in system message content", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        systemMessage("User 123e4567-e89b-42d3-a456-426655440000 is an admin."),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe("User ~000~ is an admin.");
    });

    test("encodes multiple UUIDs with deduplication", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

      const params = createParams([
        systemMessage(`User ${uuid1} is an admin.`),
        userMessage(`Compare ${uuid1} with ${uuid2}.`),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt, 0)).toBe("User ~000~ is an admin.");
      expect(getUserText(result.prompt, 1)).toBe("Compare ~000~ with ~001~.");
    });

    test("same UUID gets the same placeholder across all messages", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

      // uuid2 appears BEFORE uuid1 in the second message
      const params = createParams([
        systemMessage(`User ${uuid1} is an admin.`),
        userMessage(`Found ${uuid2}, also see ${uuid1}.`),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // uuid1 got ~000~ in message 1. It must stay ~000~ everywhere.
      expect(getSystemContent(result.prompt, 0)).toBe("User ~000~ is an admin.");
      // uuid2 is new, so it should get ~001~ (not ~000~)
      // uuid1 should still be ~000~ (not ~001~)
      expect(getUserText(result.prompt, 1)).toBe("Found ~001~, also see ~000~.");
    });

    test("placeholder collision: decode maps back to correct UUIDs after cross-message encoding", async () => {
      const onEncode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onEncode });

      const campaignId = "aaaa4567-e89b-42d3-a456-426655440000";
      const creatorId = "bbbb4567-e89b-42d3-a456-426655440000";
      const channelId = "cccc4567-e89b-42d3-a456-426655440000";

      // Simulates agentic flow: system has campaignId,
      // tool result introduces creatorId and channelId before re-mentioning campaignId
      const params = createParams([
        systemMessage(`Campaign ${campaignId} is active.`),
        userMessage(`Creator ${creatorId} with channel ${channelId} for campaign ${campaignId}.`),
      ]);

      const encoded = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mapping = onEncode.mock.calls[0][0].mapping;

      // Each UUID must have exactly one placeholder, and each placeholder one UUID
      const placeholders = Object.keys(mapping);
      const uuids = Object.values(mapping);
      expect(placeholders).toHaveLength(3);
      expect(new Set(uuids).size).toBe(3); // no UUID mapped twice

      // The model uses the placeholder it saw for channelId in a tool call.
      // Decode must return the correct channelId, not some other UUID.
      const channelPlaceholder = placeholders.find((p) => mapping[p] === channelId);
      expect(channelPlaceholder).toBeDefined();

      // Simulate model response referencing all three
      const campaignPlaceholder = placeholders.find((p) => mapping[p] === campaignId)!;
      const creatorPlaceholder = placeholders.find((p) => mapping[p] === creatorId)!;

      const mockResult = {
        content: [
          {
            type: "text" as const,
            text: `Adding ${creatorPlaceholder} to ${campaignPlaceholder} via ${channelPlaceholder}`,
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [] as never[],
      };

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: encoded,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe(
        `Adding ${creatorId} to ${campaignId} via ${channelId}`
      );
    });

    test("calls onEncode callback with mapping", async () => {
      const onEncode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onEncode,
      });

      const params = createParams([
        userMessage(
          "Find 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab"
        ),
      ]);

      await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(onEncode).toHaveBeenCalledWith({
        mapping: expect.any(Object),
      });
      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();
    });

    test("handles content with no IDs", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Hello, how are you?")]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getUserText(result.prompt)).toBe("Hello, how are you?");
    });
  });

  describe("wrapGenerate", () => {
    // Helper to create a mock generate result with proper V4 types
    function createMockGenerateResult(text: string): LanguageModelV4GenerateResult {
      return {
        content: [{ type: "text", text }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [], // V4 requires warnings array (can be empty)
      };
    }

    test("decodes placeholders in response content", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      // transformParams returns params with mapping attached
      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult = createMockGenerateResult("The user ~000~ was found in the database.");

      const doGenerate = vi.fn().mockResolvedValue(mockResult);
      const doStream = vi.fn();

      const result = await middleware.wrapGenerate({
        doGenerate,
        doStream,
        params: transformedParams,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe(
        "The user 123e4567-e89b-42d3-a456-426655440000 was found in the database."
      );
    });

    test("calls onDecode callback", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onDecode,
      });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult = createMockGenerateResult("Found ~000~ in the system.");

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode).toHaveBeenCalledWith({
        output: expect.any(String),
        mapping: expect.any(Object),
      });
      expect(onDecode.mock.calls[0][0].output).toBe(
        "Found 123e4567-e89b-42d3-a456-426655440000 in the system."
      );
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });

    test("handles response with no placeholders", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult = createMockGenerateResult("No users found.");

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe("No users found.");
    });
  });

  describe("wrapStream", () => {
    // Helper to create stream result with proper V4 types
    function createMockStreamResult(
      parts: LanguageModelV4StreamPart[]
    ): LanguageModelV4StreamResult {
      return { stream: createMockStream(parts) };
    }

    test("decodes placeholders in streamed text", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "stream",
        model: mockModel,
      });

      const mockStreamResult = createMockStreamResult([
        { type: "text-delta", id: "1", delta: "Found user " },
        { type: "text-delta", id: "2", delta: "~000~" },
        { type: "text-delta", id: "3", delta: " in database." },
      ]);
      const doStream = vi.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = vi.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params: transformedParams,
        model: mockModel,
      });

      const text = await collectStreamText(result.stream);
      expect(text).toBe("Found user 123e4567-e89b-42d3-a456-426655440000 in database.");
    });

    test("handles split placeholders across chunks", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "stream",
        model: mockModel,
      });

      // Simulate placeholder split across chunks: ~0 | 00~
      const mockStreamResult = createMockStreamResult([
        { type: "text-delta", id: "1", delta: "User ~0" },
        { type: "text-delta", id: "1", delta: "00~ found." },
      ]);
      const doStream = vi.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = vi.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params: transformedParams,
        model: mockModel,
      });

      const text = await collectStreamText(result.stream);
      expect(text).toBe("User 123e4567-e89b-42d3-a456-426655440000 found.");
    });

    test("preserves non-text-delta stream parts", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      await middleware.transformParams({
        params,
        type: "stream",
        model: mockModel,
      });

      const mockStreamResult = createMockStreamResult([
        { type: "text-delta", id: "1", delta: "~000~" },
        { type: "text-end", id: "2" },
      ]);
      const doStream = vi.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = vi.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params,
        model: mockModel,
      });

      const reader = result.stream.getReader();
      const parts: LanguageModelV4StreamPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts).toHaveLength(2);
      expect(parts[1].type).toBe("text-end");
    });
  });

  describe("Roundtrip encoding/decoding", () => {
    test("full roundtrip with multiple UUIDs", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

      const params = createParams([userMessage(`Compare user ${uuid1} with user ${uuid2}`)]);

      // Transform params (encode)
      const encoded = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // Access the encoded message content with proper type handling
      const encodedMsg = encoded.prompt[0];
      expect(encodedMsg.role).toBe("user");
      if (encodedMsg.role === "user") {
        const textPart = encodedMsg.content.find((p) => p.type === "text");
        expect(textPart?.type === "text" && textPart.text).toBe(
          "Compare user ~000~ with user ~001~"
        );
      }

      // Simulate LLM response with encoded IDs
      const mockResult: LanguageModelV4GenerateResult = {
        content: [
          {
            type: "text",
            text: "User ~000~ has more activity than ~001~. Recommending ~000~.",
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      // Wrap generate (decode) - use encoded params which has the mapping
      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: encoded,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe(
        `User ${uuid1} has more activity than ${uuid2}. Recommending ${uuid1}.`
      );
    });
  });

  describe("Tool result encoding", () => {
    // Helper to extract tool result output from encoded prompt
    function getToolResultOutput(prompt: LanguageModelV4Message[], index = 0): unknown {
      const msg = prompt[index];
      if (msg.role === "tool") {
        const toolResult = msg.content.find((p) => p.type === "tool-result");
        if (toolResult && "output" in toolResult) {
          return (toolResult as { output: unknown }).output;
        }
      }
      return undefined;
    }

    test("encodes UUIDs in tool result with text output", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([
        toolMessage("call-1", "get_user", {
          type: "text",
          value: `User ${uuid} found in database`,
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as {
        type: string;
        value: string;
      };
      expect(output.type).toBe("text");
      expect(output.value).toBe("User ~000~ found in database");
    });

    test("encodes UUIDs in tool result with json output", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";
      const params = createParams([
        toolMessage("call-1", "get_users", {
          type: "json",
          value: {
            users: [
              { id: uuid1, name: "Alice" },
              { id: uuid2, name: "Bob" },
            ],
          },
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as {
        type: string;
        value: { users: Array<{ id: string; name: string }> };
      };
      expect(output.type).toBe("json");
      expect(output.value.users[0].id).toBe("~000~");
      expect(output.value.users[0].name).toBe("Alice");
      expect(output.value.users[1].id).toBe("~001~");
      expect(output.value.users[1].name).toBe("Bob");
    });

    test("encodes UUIDs in nested json structures", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([
        toolMessage("call-1", "get_data", {
          type: "json",
          value: {
            level1: {
              level2: {
                id: uuid,
              },
            },
          },
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as {
        type: string;
        value: { level1: { level2: { id: string } } };
      };
      expect(output.value.level1.level2.id).toBe("~000~");
    });

    test("handles tool result with no UUIDs", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        toolMessage("call-1", "get_count", {
          type: "json",
          value: { count: 42, status: "ok" },
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as {
        type: string;
        value: { count: number; status: string };
      };
      expect(output.value).toEqual({ count: 42, status: "ok" });
    });

    test("deduplicates UUIDs across user messages and tool results", async () => {
      const onEncode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onEncode,
      });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([
        userMessage(`Find user ${uuid}`),
        toolMessage("call-1", "get_user", {
          type: "text",
          value: `User ${uuid} found`,
        }),
      ]);

      await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // Should only have 1 unique UUID in mapping
      expect(onEncode).toHaveBeenCalledWith({
        mapping: expect.any(Object),
      });
      expect(Object.keys(onEncode.mock.calls[0][0].mapping)).toHaveLength(1);
    });

    test("preserves non-tool-result parts in tool messages", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "test",
              output: { type: "text", value: "result" },
            },
          ],
        } as LanguageModelV4Message,
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const msg = result.prompt[0];
      expect(msg.role).toBe("tool");
    });
  });

  describe("Tool call args encoding in prompt", () => {
    test("encodes UUIDs in tool-call args within assistant messages", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const creatorId = "123e4567-e89b-42d3-a456-426655440000";
      const campaignId = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

      const params = createParams([
        userMessage(`Add creator ${creatorId} to campaign ${campaignId}`),
        {
          role: "assistant",
          content: [
            { type: "text", text: `Adding creator ${creatorId} to campaign.` },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "add_draft_collaboration",
              input: { creatorIds: [creatorId], campaignId },
            },
          ],
        } as LanguageModelV4Message,
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const assistantMsg = result.prompt[1];
      expect(assistantMsg.role).toBe("assistant");
      if (assistantMsg.role === "assistant") {
        // Text part should be encoded
        const textPart = assistantMsg.content.find((p) => p.type === "text");
        expect(textPart?.type === "text" && textPart.text).toBe(
          "Adding creator ~000~ to campaign."
        );

        // Tool-call args should also be encoded
        const toolCallPart = assistantMsg.content.find((p) => p.type === "tool-call") as {
          type: "tool-call";
          input: { creatorIds: string[]; campaignId: string };
        };
        expect(toolCallPart).toBeDefined();
        expect(toolCallPart.input.creatorIds[0]).toBe("~000~");
        expect(toolCallPart.input.campaignId).toBe("~001~");
      }
    });

    test("deduplicates UUIDs across text, tool results, and tool-call args", async () => {
      const onEncode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onEncode });

      const creatorId = "123e4567-e89b-42d3-a456-426655440000";

      const params = createParams([
        userMessage(`Find creator ${creatorId}`),
        {
          role: "assistant",
          content: [
            { type: "text", text: `Found creator ${creatorId}.` },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "get_creator",
              input: { id: creatorId },
            },
          ],
        } as LanguageModelV4Message,
        toolMessage("call-1", "get_creator", {
          type: "json",
          value: { id: creatorId, name: "Alice" },
        }),
      ]);

      await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // Same UUID across text, tool-call args, and tool result = 1 mapping entry
      const mapping = onEncode.mock.calls[0][0].mapping;
      expect(Object.keys(mapping)).toHaveLength(1);
      expect(mapping["~000~"]).toBe(creatorId);
    });
  });

  describe("Tool call input decoding", () => {
    test("decodes UUIDs in tool call input from wrapGenerate", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Create campaign for user ${uuid}`)]);

      // First encode the prompt
      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // Mock a generate result with a tool call containing encoded placeholder
      const mockResult: LanguageModelV4GenerateResult = {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "create_campaign",
            input: '{"user_id":"~000~","name":"Test Campaign"}',
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // Tool call input should have decoded UUID
      const toolCall = result.content.find((c) => c.type === "tool-call");
      expect(toolCall).toBeDefined();
      expect((toolCall as { input: string }).input).toBe(
        `{"user_id":"${uuid}","name":"Test Campaign"}`
      );
    });

    test("decodes UUIDs in tool call from wrapStream", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "stream",
        model: mockModel,
      });

      // Mock stream with a tool-call chunk
      const mockStreamResult = {
        stream: createMockStream([
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "get_user",
            input: '{"id":"~000~"}',
          } as LanguageModelV4StreamPart,
        ]),
      };

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue(mockStreamResult),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const reader = result.stream.getReader();
      const { value } = await reader.read();

      expect(value?.type).toBe("tool-call");
      expect((value as { input: string }).input).toBe(`{"id":"${uuid}"}`);
    });
  });

  describe("Different output formats", () => {
    // Helper to get user message text from encoded prompt
    function getUserMessageText(prompt: LanguageModelV4Message[]): string {
      const msg = prompt[0];
      if (msg.role === "user") {
        const textPart = msg.content.find((p) => p.type === "text");
        return textPart?.type === "text" ? textPart.text : "";
      }
      return "";
    }

    test("works with Numeric format", async () => {
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: "Numeric" },
      });

      const params = createParams([userMessage("Find 123e4567-e89b-42d3-a456-426655440000")]);

      const encoded = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe("Find 000");
    });

    test("works with custom template format", async () => {
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: { template: "[ID:{i}]" } },
      });

      const params = createParams([userMessage("Find 123e4567-e89b-42d3-a456-426655440000")]);

      const encoded = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe("Find [ID:0]");
    });

    test("works with ULID input format", async () => {
      const middleware = createMiddleware({
        config: { inputFormat: "ULID", outputFormat: "SafeNumeric" },
      });

      const params = createParams([userMessage("Find 01ARZ3NDEKTSV4RRFFQ69G5FAV")]);

      const encoded = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe("Find ~000~");
    });
  });

  describe("debug mode", () => {
    test("onEncode receives debugData when debug is true", async () => {
      const onEncode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        debug: true,
        onEncode,
      });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(onEncode).toHaveBeenCalledTimes(1);
      const result = onEncode.mock.calls[0][0];
      expect(result.mapping).toEqual({ "~000~": uuid });
      expect(result.debugData).toBeDefined();
      expect(result.debugData.encodedCount).toBe(1);
      expect(result.debugData.input).toBe(params.prompt);
      expect(result.debugData.output).toBeDefined();
      expect(typeof result.debugData.durationMs).toBe("number");
      expect(result.debugData.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("onDecode receives debugData on wrapGenerate when debug is true", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        debug: true,
        onDecode,
      });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult: LanguageModelV4GenerateResult = {
        content: [{ type: "text", text: "Found ~000~ in the system." }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode).toHaveBeenCalledTimes(1);
      const result = onDecode.mock.calls[0][0];
      expect(result.output).toBe(`Found ${uuid} in the system.`);
      expect(result.mapping).toEqual({ "~000~": uuid });
      expect(result.debugData).toBeDefined();
      expect(result.debugData.decodedCount).toBe(1);
      expect(result.debugData.input).toBe("Found ~000~ in the system.");
      expect(result.debugData.output).toBe(`Found ${uuid} in the system.`);
      expect(typeof result.debugData.durationMs).toBe("number");
    });

    test("counts a placeholder whose format carries a regex metacharacter", async () => {
      // The count compiles each placeholder into a pattern, escaping it first, so a format whose
      // literals carry a metacharacter counts the text rather than a character class
      const onDecode = vi.fn();
      const uuid = "123e4567-e89b-42d3-a456-426655440000";

      for (const template of ["+{i:03}+", "[[{i:03}]]"]) {
        onDecode.mockClear();
        const middleware = createMiddleware({
          config: { inputFormat: "UUID", outputFormat: { template } },
          debug: true,
          onDecode,
        });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage(`creator ${uuid}`)]),
          type: "generate",
          model: mockModel,
        });
        const placeholder = template.replace("{i:03}", "000");

        await middleware.wrapGenerate({
          doGenerate: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: `saw ${placeholder}` }],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          }),
          doStream: vi.fn(),
          params: transformedParams,
          model: mockModel,
        });

        expect(onDecode.mock.calls[0][0].debugData.decodedCount, template).toBe(1);
      }
    });

    test("a format that is JSON-unsafe only past its first index is refused", async () => {
      // The guard exists so a placeholder survives a tool call, and a format that is safe at
      // index 0 and not after loses an identifier out of a tool call's arguments instead
      expect(() =>
        createMiddleware({
          config: {
            inputFormat: "UUID",
            outputFormat: (i: number) => (i === 0 ? "P0" : `P"${i}`),
          },
        })
      ).toThrow(/would not survive a tool call/);
    });

    test("a format JSON-unsafe at an index no probe reads is refused when it mints there", async () => {
      // The probes sit far apart so that what they share is the format's literals. encode mints
      // densely from zero, so a lookup table unsafe at index 1 passes construction untouched and
      // the refusal has to come from the placeholder that was actually minted
      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";
      const table = ["<!>", '<">'];
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: (i: number) => table[i] ?? `<${i}>` },
      });

      await expect(
        middleware.transformParams({
          params: createParams([userMessage(`creators ${uuid1} and ${uuid2}`)]),
          type: "generate",
          model: mockModel,
        })
      ).rejects.toThrow(/would not survive a tool call/);
    });

    test("the same format is fine for as long as it only mints safe placeholders", async () => {
      const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
      const table = ["<!>", '<">'];
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: (i: number) => table[i] ?? `<${i}>` },
      });

      const transformed = await middleware.transformParams({
        params: createParams([userMessage(`creator ${uuid1}`)]),
        type: "generate",
        model: mockModel,
      });

      expect(JSON.stringify(transformed.prompt)).toContain("<!>");
    });

    test("a placeholder split across two text parts is reported once", async () => {
      // Decode never sees it whole, so it survives. Reporting it as invented as well would tell
      // the consumer the model made up a placeholder the middleware itself minted
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });
      const uuid = "123e4567-e89b-42d3-a456-426655440000";

      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`creator ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "see ~0" },
            { type: "text", text: "00~" },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        { type: "surviving_placeholder", value: "~000~", source: "text" },
      ]);
    });

    test("counts the placeholders in every text part of an answer, not just the last one", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, debug: true, onDecode });

      const first = "123e4567-e89b-42d3-a456-426655440000";
      const second = "987fcdeb-51a2-43f7-8d9c-0123456789ab";
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Compare ${first} with ${second}`)]),
        type: "generate",
        model: mockModel,
      });

      // A provider splits text around a tool call, so one answer arrives as several text parts
      const mockResult: LanguageModelV4GenerateResult = {
        content: [
          { type: "text", text: "First, ~000~ and ~000~ again." },
          { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: '{"id":"~000~"}' },
          { type: "text", text: "Then ~001~." },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const result = onDecode.mock.calls[0][0];
      // Two in the first part plus one in the second. `totalCount = ...` would report 1.
      expect(result.debugData.decodedCount).toBe(3);
      expect(result.debugData.input).toBe("First, ~000~ and ~000~ again.Then ~001~.");
      expect(result.output).toBe(`First, ${first} and ${first} again.Then ${second}.`);
    });

    test("the streamed count means the same thing as the generated one", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, debug: true, onDecode });

      const first = "123e4567-e89b-42d3-a456-426655440000";
      const second = "987fcdeb-51a2-43f7-8d9c-0123456789ab";
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Compare ${first} with ${second}`)]),
        type: "stream",
        model: mockModel,
      });

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-delta", id: "1", delta: "First, ~000~ and ~000~ again. " },
            { type: "text-delta", id: "1", delta: "Then ~001~." },
            { type: "text-end", id: "1" },
          ]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });
      await collectStreamParts(result.stream);

      // Three occurrences across two deltas, against a mapping of two
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(3);
    });

    test("the placeholder count is only paid for when debug is on", async () => {
      const ids = Array.from(
        { length: 40 },
        (_, i) => `${i.toString(16).padStart(8, "0")}-4567-42d3-a456-426655440000`
      );
      const { mapping } = encode(`Look up ${ids.join(" ")}`, defaultConfig);
      const answer = Object.keys(mapping).join(" and ");

      // Counting replacements builds one RegExp per placeholder, and only debugData reports it
      async function regexpsBuiltWith(debug: boolean) {
        const middleware = createMiddleware({ config: defaultConfig, debug });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage(`Look up ${ids.join(" ")}`)]),
          type: "generate",
          model: mockModel,
        });

        const RealRegExp = globalThis.RegExp;
        let built = 0;
        globalThis.RegExp = new Proxy(RealRegExp, {
          construct(target, args: ConstructorParameters<typeof RegExp>) {
            built++;
            return new target(...args);
          },
        });
        try {
          await middleware.wrapGenerate({
            doGenerate: vi.fn().mockResolvedValue({
              content: [{ type: "text", text: answer }],
              finishReason: mockFinishReason(),
              usage: mockUsage(),
              warnings: [],
            }),
            doStream: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
        } finally {
          globalThis.RegExp = RealRegExp;
        }
        return built;
      }

      expect((await regexpsBuiltWith(true)) - (await regexpsBuiltWith(false))).toBe(ids.length);
    });

    test("onDecode receives debugData on wrapStream when debug is true", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        debug: true,
        onDecode,
      });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "stream",
        model: mockModel,
      });

      const mockStreamResult = {
        stream: createMockStream([
          { type: "text-delta", id: "1", delta: "Found " },
          { type: "text-delta", id: "2", delta: "~000~" },
          { type: "text-delta", id: "3", delta: " in DB." },
        ]),
      };

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue(mockStreamResult),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // Consume the stream to trigger flush
      await collectStreamText(result.stream);

      expect(onDecode).toHaveBeenCalledTimes(1);
      const cbResult = onDecode.mock.calls[0][0];
      expect(cbResult.output).toContain(uuid);
      expect(cbResult.mapping).toEqual({ "~000~": uuid });
      expect(cbResult.debugData).toBeDefined();
      expect(cbResult.debugData.decodedCount).toBe(1);
      expect(cbResult.debugData.input).toBe("Found ~000~ in DB.");
      expect(cbResult.debugData.output).toContain(uuid);
      expect(typeof cbResult.debugData.durationMs).toBe("number");
    });

    test("the streamed duration is decode time, not the generation's", async () => {
      // A stream is decoded a chunk at a time with the model's latency in between, and the same
      // field on the generated path answers for the decode alone
      const onDecode = vi.fn();
      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const middleware = createMiddleware({ config: defaultConfig, debug: true, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const chunks: LanguageModelV4StreamPart[] = [
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "Found ~000~" },
        { type: "text-end", id: "1" },
        { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
      ];

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            async start(controller) {
              for (const chunk of chunks) {
                await new Promise((resolve) => setTimeout(resolve, 40));
                controller.enqueue(chunk);
              }
              controller.close();
            },
          }),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamText(result.stream);

      expect(onDecode.mock.calls[0][0].debugData.durationMs).toBeLessThan(100);
    });

    test("an escaped mapping keeps a placeholder spelled like a prototype member", async () => {
      // The escaped copy is only built when an identifier carries a character JSON escapes, and
      // it is built key by key, so a key of `__proto__` would be dropped from it alone
      const ids = Array.from({ length: 51 }, (_, i) => `ID"${String(i).padStart(3, "0")}`);
      const middleware = createMiddleware({
        config: {
          inputFormat: /ID"\d{3}/g,
          outputFormat: { template: "__prot{i:base62}__" },
        },
      });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(ids.join(" "))]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: '{"id":"__proto__"}',
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect((result.content[0] as { input: string }).input).toBe('{"id":"ID\\"050"}');
    });

    test("a placeholder spelled like a prototype member survives a tool call", async () => {
      // `__prot{i:base62}__` writes `__proto__` at index 50, and the escaped mapping the tool
      // input decoder reads is built key by key
      const ids = Array.from(
        { length: 51 },
        (_, i) => `123e4567-e89b-42d3-a456-4266554400${String(i).padStart(2, "0")}`
      );
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: { template: "__prot{i:base62}__" } },
      });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(ids.join(" "))]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: '{"id":"__proto__"}',
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect((result.content[0] as { input: string }).input).toBe(`{"id":"${ids[50]}"}`);
    });

    test("debugData is absent when debug is false", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        debug: false,
        onEncode,
        onDecode,
      });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult: LanguageModelV4GenerateResult = {
        content: [{ type: "text", text: "Found ~000~." }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();
      expect(onDecode.mock.calls[0][0].output).toBeDefined();
      expect(onDecode.mock.calls[0][0].mapping).toBeDefined();
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });
  });

  describe("instruction", () => {
    function getSystemContent(prompt: LanguageModelV4Message[]): string {
      const msg = prompt.find((m) => m.role === "system");
      return msg?.role === "system" ? (msg.content as string) : "";
    }

    const instruction = "Identifiers look like {format}. Pass them verbatim.";

    test("appends the caller's instruction to the system message", async () => {
      const middleware = createMiddleware({ config: defaultConfig, instruction });

      const params = createParams([
        systemMessage("System prompt."),
        userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe(
        "System prompt.\n\nIdentifiers look like ~000~. Pass them verbatim."
      );
    });

    test("appends the same instruction when the call carries no ID, so the system message stays byte-identical across calls and the provider's prompt cache still matches", async () => {
      const middleware = createMiddleware({ config: defaultConfig, instruction });

      const withoutId = await middleware.transformParams({
        params: createParams([systemMessage("System prompt."), userMessage("Hello there")]),
        type: "generate",
        model: mockModel,
      });
      const withId = await middleware.transformParams({
        params: createParams([
          systemMessage("System prompt."),
          userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
        ]),
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(withoutId.prompt)).toBe(getSystemContent(withId.prompt));
    });

    test("leaves the prompt alone when no instruction is given", async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        systemMessage("You are a helpful assistant."),
        userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe("You are a helpful assistant.");
    });

    test("keeps providerOptions on the system message, so a cache breakpoint survives", async () => {
      const middleware = createMiddleware({ config: defaultConfig, instruction });

      const params = createParams([
        {
          role: "system",
          content: "System prompt.",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(result.prompt[0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: "ephemeral" } },
      });
    });

    test("appends to the last system message, leaving earlier ones alone", async () => {
      const middleware = createMiddleware({ config: defaultConfig, instruction });

      const params = createParams([
        systemMessage("First."),
        userMessage("Hello"),
        systemMessage("Second."),
        userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(result.prompt[0].content).toBe("First.");
      expect(result.prompt[2].content).toBe(
        "Second.\n\nIdentifiers look like ~000~. Pass them verbatim."
      );
    });

    test("a placeholder carrying $ reaches the instruction as the model will see it", async () => {
      // String.replace reads $ patterns in a string replacement, so $$000$$ would arrive as $000$
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: { template: "$${i:03}$$" } },
        instruction: "Identifiers look like {format}.",
      });

      const result = await middleware.transformParams({
        params: createParams([
          systemMessage("System prompt."),
          userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
        ]),
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe(
        "System prompt.\n\nIdentifiers look like $$000$$."
      );
    });

    test("replaces every {format} in the instruction", async () => {
      const middleware = createMiddleware({
        config: defaultConfig,
        instruction: "Use {format}, e.g. {format}, verbatim.",
      });

      const result = await middleware.transformParams({
        params: createParams([
          systemMessage("System prompt."),
          userMessage("Find user 123e4567-e89b-42d3-a456-426655440000"),
        ]),
        type: "generate",
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe(
        "System prompt.\n\nUse ~000~, e.g. ~000~, verbatim."
      );
    });

    test("creates a system message when none exists", async () => {
      const middleware = createMiddleware({ config: defaultConfig, instruction });

      const params = createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      expect(result.prompt[0].role).toBe("system");
      expect(getSystemContent(result.prompt)).toContain("~000~");
    });
  });

  describe("decode warnings", () => {
    /** Runs one answer through wrapGenerate and returns the warnings onDecode saw. */
    async function warningsFor(format: OutputFormat, answer: string) {
      const onDecode = vi.fn();
      const config: EncodeConfig = { inputFormat: "UUID", outputFormat: format };
      const middleware = createMiddleware({ config, onDecode });
      const uuid = "123e4567-e89b-42d3-a456-426655440000";

      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`creator ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: answer }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const { warnings } = onDecode.mock.calls[0][0];
      return (warnings ?? []).map((w: { type: string; value: string }) => [w.type, w.value]);
    }

    test("a stripped delimiter is a quoted JSON value, not a number in prose", async () => {
      expect(await warningsFor("SafeNumeric", '{"creatorId": "000"}')).toEqual([
        ["stripped_delimiter", "000"],
      ]);
      expect(await warningsFor("SafeNumeric", "row 000 of the table, up 000 since May")).toEqual(
        []
      );
      expect(await warningsFor("SafeNumeric", "revenue was 1000 EUR across 2000 posts")).toEqual(
        []
      );
    });

    test("a formatter padded wider than the probes still reports a stripped body", async () => {
      // A formatter function cannot be read, only probed, and a probe that stops at nine digits
      // has the padding of a wider one read as part of its prefix. Core's half of this is pinned
      // by its own probe table; this is the middleware's half
      expect(
        await warningsFor(
          (i: number) => `ID${String(i).padStart(12, "0")}`,
          '{"ref": "000000000000"}'
        )
      ).toEqual([["stripped_delimiter", "000000000000"]]);
    });

    test("a format whose body carries a regex metacharacter is scanned, not compiled", async () => {
      // The body is whatever sits between the affixes, so a formatter that writes its index twice
      // puts a metacharacter in it, and the scan matches that body rather than compiling it
      expect(await warningsFor((i: number) => `id(${i})-${i}`, '{"ref": "0)-0"}')).toEqual([
        ["stripped_delimiter", "0)-0"],
      ]);
      // `.` would otherwise match any character, so an ordinary value reads as a stripped one
      expect(await warningsFor((i: number) => `<${i}.${i}>`, '{"ref": "010"}')).toEqual([]);
    });

    test("an identifier written between two delimiter fragments reports nothing", async () => {
      // The restored identifier is masked before the scan, and a mask of nothing would close the
      // fragments on either side of it back into a placeholder the decode never missed
      expect(await warningsFor("SafeNumeric", "~00~000~0~")).toEqual([]);
    });

    test("a format whose literal part carries a digit contributes no bare index", async () => {
      // No digit run spans the whole placeholder of `<v2:000>`, so "2" is not an index to miss
      expect(
        await warningsFor({ template: "<v2:{i:03}>" }, '{"page": "2", "limit": "50"}')
      ).toEqual([]);
      expect(await warningsFor({ template: "<v2:{i:03}>" }, "creator <v2:000> is fine")).toEqual(
        []
      );
      expect(await warningsFor({ template: "<id:{i:03}>" }, '{"page": "000"}')).toEqual([
        ["stripped_delimiter", "000"],
      ]);
    });

    test("a format whose literal part carries a digit still reports a stripped body", async () => {
      // The digit in the literal is not an index, but the body between the affixes is
      expect(await warningsFor({ template: "<v2:{i:03}>" }, '{"page": "000"}')).toEqual([
        ["stripped_delimiter", "000"],
      ]);
      expect(await warningsFor({ template: "v1_{i:03}" }, '{"orderId": "000"}')).toEqual([
        ["stripped_delimiter", "000"],
      ]);
      expect(await warningsFor({ template: "<1:{i:03}:2>" }, '{"ref": "000"}')).toEqual([
        ["stripped_delimiter", "000"],
      ]);
    });

    test("a template's affixes are its literals at any pad width", async () => {
      expect(
        await warningsFor({ template: "ID{i:020}" }, '{"ref": "00000000000000000000"}')
      ).toEqual([["stripped_delimiter", "00000000000000000000"]]);
    });

    test("a template padded wider than a probe reports the whole stripped body", async () => {
      // A template's affixes come from its own literal rather than from probes, so the pad is body
      // at any width and the warning carries every digit the model wrote
      expect(await warningsFor({ template: "ID{i:012}" }, '{"ref": "000000000000"}')).toEqual([
        ["stripped_delimiter", "000000000000"],
      ]);
    });

    test("a formatter that refuses a high index still decodes the answer", async () => {
      // The probe asks a custom formatter for an index far past anything the call minted, and a
      // lookup table that runs out throws there. Decoding is not the place to surface that.
      const table = ["<<zero>>", "<<one>>"];
      const outputFormat = (index: number) => {
        if (index >= table.length) throw new RangeError("no entry for that index");
        return table[index];
      };

      expect(await warningsFor(outputFormat, "the record is <<zero>>")).toEqual([]);
      expect(await warningsFor(outputFormat, 'the record is "zero"')).toEqual([]);
    });

    test("detects stripped delimiters in tool call arguments via wrapGenerate", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find campaign ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // Simulate LLM stripping delimiters: outputs "000" instead of "~000~"
      const mockResult: LanguageModelV4GenerateResult = {
        content: [
          { type: "text", text: "Looking up campaign." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_campaigns",
            input: '{"campaignId":"000"}',
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const result = onDecode.mock.calls[0][0];
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContainEqual({
        type: "stripped_delimiter",
        value: "000",
        source: "tool_call",
        toolName: "get_campaigns",
      });
    });

    test("a placeholder that decodes cleanly raises no surviving-placeholder warning", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      // ~000~ is the placeholder transformParams minted for this uuid, so decode restores it and
      // nothing is left for the scan to report
      const mockResult: LanguageModelV4GenerateResult = {
        content: [{ type: "text", text: "Found user ~000~ in the database." }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // ~000~ should be decoded to UUID, so no surviving placeholder warning
      const result = onDecode.mock.calls[0][0];
      expect(result.warnings).toBeUndefined();
    });

    test("no warnings when decode succeeds", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });

      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const params = createParams([userMessage(`Find user ${uuid}`)]);

      const transformedParams = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const mockResult: LanguageModelV4GenerateResult = {
        content: [
          { type: "text", text: "Found user ~000~." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_user",
            input: '{"userId":"~000~"}',
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue(mockResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const result = onDecode.mock.calls[0][0];
      expect(result.warnings).toBeUndefined();
    });

    async function decodeWith(content: LanguageModelV4GenerateResult["content"]) {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content,
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      return onDecode.mock.calls[0][0];
    }

    test("detects a placeholder the model invented in text", async () => {
      const result = await decodeWith([
        { type: "text", text: "See [A](creator://~000~) and [B](creator://~053~)." },
      ]);

      expect(result.output).toBe(
        "See [A](creator://123e4567-e89b-42d3-a456-426655440000) and [B](creator://~053~)."
      );
      expect(result.warnings).toEqual([
        { type: "unknown_placeholder", value: "~053~", source: "text" },
      ]);
    });

    test("detects an invented placeholder that drops the padding", async () => {
      const result = await decodeWith([
        {
          type: "text",
          text: "See [A](creator://~1~), [B](creator://~2~) and [C](creator://~13~)",
        },
      ]);

      expect(result.warnings).toEqual([
        { type: "unknown_placeholder", value: "~1~", source: "text" },
        { type: "unknown_placeholder", value: "~2~", source: "text" },
        { type: "unknown_placeholder", value: "~13~", source: "text" },
      ]);
    });

    test("does not report a restored ID that carries the format's own delimiters", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: { template: "-{i}-" } },
        onDecode,
      });
      const transformedParams = await middleware.transformParams({
        // An all-digit group, so the restored ID itself carries the format's delimiters
        params: createParams([userMessage("Find user 123e4567-4567-42d3-a456-426655440000")]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "That is -0-." }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const result = onDecode.mock.calls[0][0];
      expect(result.output).toBe("That is 123e4567-4567-42d3-a456-426655440000.");
      expect(result.warnings).toBeUndefined();
    });

    test("scans every text part of an answer", async () => {
      const result = await decodeWith([
        { type: "text", text: "First ~000~." },
        { type: "text", text: "Then ~777~." },
      ]);

      expect(result.warnings).toEqual([
        { type: "unknown_placeholder", value: "~777~", source: "text" },
      ]);
    });

    test.each(["generate", "stream"] as const)(
      "a %s call whose prompt carried no ID reports nothing",
      async (type) => {
        const onDecode = vi.fn();
        const middleware = createMiddleware({ config: defaultConfig, onDecode });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage("No identifiers here")]),
          type,
          model: mockModel,
        });
        const content = [{ type: "text" as const, text: "See ~777~ and ~13~." }];

        if (type === "generate") {
          await middleware.wrapGenerate({
            doGenerate: vi.fn().mockResolvedValue({
              content,
              finishReason: mockFinishReason(),
              usage: mockUsage(),
              warnings: [],
            }),
            doStream: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
        } else {
          const result = await middleware.wrapStream({
            doStream: vi.fn().mockResolvedValue({
              stream: createMockStream([
                { type: "text-delta", id: "1", delta: content[0].text },
                { type: "text-end", id: "1" },
              ]),
            }),
            doGenerate: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
          await collectStreamText(result.stream);
        }

        expect(onDecode).not.toHaveBeenCalled();
      }
    );

    test("detects a placeholder the model invented in tool call arguments", async () => {
      const result = await decodeWith([
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "evaluate_results",
          input: '{"ids":["~000~","~081~"]}',
        },
      ]);

      expect(result.warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~081~",
          source: "tool_call",
          toolName: "evaluate_results",
        },
      ]);
    });

    async function streamDecodeWith(parts: Parameters<typeof createMockStream>[0]) {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]),
        type: "stream",
        model: mockModel,
      });

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: createMockStream(parts) }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });
      await collectStreamText(result.stream);

      return onDecode.mock.calls[0][0];
    }

    test("names the tool for each tool call in a stream", async () => {
      const result = await streamDecodeWith([
        { type: "tool-call", toolCallId: "c1", toolName: "get_user", input: '{"id":"~000~"}' },
        {
          type: "tool-call",
          toolCallId: "c2",
          toolName: "evaluate_results",
          input: '{"ids":["~081~"]}',
        },
      ]);

      expect(result.warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~081~",
          source: "tool_call",
          toolName: "evaluate_results",
        },
      ]);
    });

    test("detects an invented placeholder in a stream", async () => {
      const result = await streamDecodeWith([
        { type: "text-delta", id: "1", delta: "Also [B](creator://~0" },
        { type: "text-delta", id: "1", delta: "53~)." },
        { type: "text-end", id: "1" },
      ]);

      expect(result.warnings).toEqual([
        { type: "unknown_placeholder", value: "~053~", source: "text" },
      ]);
    });

    test("a stream that ends mid-placeholder still reports the buffered tail", async () => {
      const result = await streamDecodeWith([
        { type: "text-delta", id: "1", delta: "See ~000~ and also ~13" },
      ]);

      expect(result.output).toBe("See 123e4567-e89b-42d3-a456-426655440000 and also ~13");
    });

    test("reports text the consumer already holds when the stream dies", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: defaultConfig, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage("Find user 123e4567-e89b-42d3-a456-426655440000")]),
        type: "stream",
        model: mockModel,
      });
      let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        start: (c) => {
          controller = c;
        },
      });

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });
      const reader = result.stream.getReader();
      controller.enqueue({ type: "text-delta", id: "1", delta: "See ~000~ and ~053~" });
      await reader.read();
      controller.error(new Error("upstream ended"));
      await expect(reader.read()).rejects.toThrow("upstream ended");

      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        { type: "unknown_placeholder", value: "~053~", source: "text" },
      ]);
    });

    test.each<OutputFormat>(["SafeNumeric", "Numeric", "IdToken"])(
      "no warnings on a clean round trip with the %s output format",
      async (outputFormat) => {
        const onDecode = vi.fn();
        const config: EncodeConfig = { inputFormat: "UUID", outputFormat };
        const middleware = createMiddleware({ config, onDecode });

        const uuid = "123e4567-e89b-42d3-a456-426655440000";
        const params = createParams([userMessage(`Find user ${uuid}`)]);

        const transformedParams = await middleware.transformParams({
          params,
          type: "generate",
          model: mockModel,
        });

        const mockResult: LanguageModelV4GenerateResult = {
          content: [{ type: "text", text: encode(`Found user ${uuid}.`, config).encoded }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        };

        await middleware.wrapGenerate({
          doGenerate: vi.fn().mockResolvedValue(mockResult),
          doStream: vi.fn(),
          params: transformedParams,
          model: mockModel,
        });

        const result = onDecode.mock.calls[0][0];
        expect(result.output).toBe(`Found user ${uuid}.`);
        expect(result.warnings).toBeUndefined();
      }
    );
  });
  describe("An identifier JSON escapes", () => {
    // A custom input format can match anything, including characters JSON writes with a backslash.
    // Tool input is rewritten as serialised text, so a raw one would break the JSON the SDK parses.
    const config: EncodeConfig = {
      inputFormat: /REF\\[a-z]+/g,
      outputFormat: "SafeNumeric",
    };
    const identifier = "REF\\qbeta";

    async function decodedToolInput(input: string) {
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${identifier}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      return (result.content[0] as { input: string }).input;
    }

    test("it is escaped back into tool call input, which stays parseable", async () => {
      const input = await decodedToolInput('{"id":"~000~"}');

      expect(JSON.parse(input)).toEqual({ id: identifier });
    });

    test("the answer's own text carries the identifier unescaped", async () => {
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${identifier}`)]),
        type: "stream",
        model: mockModel,
      });

      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "found ~000~" },
            { type: "text-end", id: "a" },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // Prose is not JSON, so escaping it would show the reader a backslash the model never wrote
      expect(await collectStreamText(streamed.stream)).toBe(`found ${identifier}`);
    });

    test("the streamed deltas reassemble to what the tool call carries", async () => {
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${identifier}`)]),
        type: "stream",
        model: mockModel,
      });

      const wire = '{"id":"~000~"}';
      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "tool-input-start", id: "call-1", toolName: "lookup" },
            ...wire.split("").map((piece) => ({
              type: "tool-input-delta" as const,
              id: "call-1",
              delta: piece,
            })),
            { type: "tool-input-end", id: "call-1" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: wire,
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const parts = await collectStreamParts(streamed.stream);
      const reassembled = parts
        .filter((part) => part.type === "tool-input-delta")
        .map((part) => (part as { delta: string }).delta)
        .join("");
      const call = parts.find((part) => part.type === "tool-call") as { input: string };

      expect(JSON.parse(reassembled)).toEqual({ id: identifier });
      expect(reassembled).toBe(call.input);
    });

    test("an identifier JSON carries unchanged is written unchanged", async () => {
      const plain: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
      const uuid = "123e4567-e89b-42d3-a456-426655440000";
      const middleware = createMiddleware({ config: plain });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: '{"id":"~000~"}',
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect((result.content[0] as { input: string }).input).toBe(`{"id":"${uuid}"}`);
    });
  });

  describe("A tool the provider ran itself", () => {
    const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
    const uuid = "123e4567-e89b-42d3-a456-426655440000";

    test("its result is decoded and scanned on the generated path", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { query: "~000~", hits: [{ owner: "~000~", note: "also saw ~777~" }] },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(result.content[0]).toMatchObject({
        result: { query: uuid, hits: [{ owner: uuid, note: `also saw ~777~` }] },
      });
      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("its result is decoded and scanned on the streamed path", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { query: "~000~", note: "also saw ~777~" },
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const parts = await collectStreamParts(streamed.stream);

      expect(parts[0]).toMatchObject({ result: { query: uuid, note: "also saw ~777~" } });
      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("a placeholder in a result key is decoded", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { "~000~": { hits: 3 } },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(result.content[0]).toMatchObject({ result: { [uuid]: { hits: 3 } } });
    });

    test("a result the provider left undefined is passed through", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Nothing came back." },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: undefined,
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(result.content[1]).toMatchObject({ result: undefined });
      expect(onDecode.mock.calls[0][0].warnings).toBeUndefined();
    });

    test("a preliminary result and its replacement report one warning", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      // A provider streaming previews sends the same content again under a final result
      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const parts = await collectStreamParts(streamed.stream);

      expect(parts[0]).toMatchObject({ result: { note: "saw ~777~" }, preliminary: true });
      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("two calls to one tool each report their own result", async () => {
      // Keyed by tool name rather than by call, the second call's result would stand for both and
      // the first call's warning would never be reported
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
            },
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "web_search",
              result: { note: "saw ~888~" },
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamParts(streamed.stream);

      expect(onDecode.mock.calls[0][0].warnings.map((w: { value: string }) => w.value)).toEqual([
        "~777~",
        "~888~",
      ]);
    });

    test("two result keys that decode to one identifier are refused", async () => {
      // The encode half refuses the mirror of this. Collapsing them here drops a whole entry from
      // what the caller is handed, with nothing said
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      // Both orders, because a guard on the raw key still refuses one of them
      for (const result of [
        { "~000~": { rank: 1 }, [uuid]: { rank: 2 } },
        { [uuid]: { rank: 2 }, "~000~": { rank: 1 } },
      ]) {
        await expect(
          middleware.wrapGenerate({
            doGenerate: vi.fn().mockResolvedValue({
              content: [{ type: "tool-result", toolCallId: "call-1", toolName: "rank", result }],
              finishReason: mockFinishReason(),
              usage: mockUsage(),
              warnings: [],
            }),
            doStream: vi.fn(),
            params: transformedParams,
            model: mockModel,
          })
        ).rejects.toThrow(/same identifier/i);
      }
    });

    test("an assistant's reasoning part is encoded like its text", async () => {
      // A reasoning part carries the model's own words back into the next prompt, so an
      // identifier in one reaches the model unless the part is encoded with the rest
      const middleware = createMiddleware({ config });
      const result = await middleware.transformParams({
        params: createParams([
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: `the creator is ${uuid}` },
              { type: "text", text: `answering for ${uuid}` },
            ],
          } as LanguageModelV4Message,
        ]),
        type: "generate",
        model: mockModel,
      });

      const parts = (result.prompt[0] as { content: { text: string }[] }).content;
      expect(parts[0].text).toBe("the creator is ~000~");
      expect(parts[1].text).toBe("answering for ~000~");
    });

    test("a tool result keeps an own __proto__ key and an ordinary toString key", async () => {
      // JSON.parse produces `__proto__` as an own key, and every object inherits a `toString`,
      // so a membership test that walks the prototype chain refuses a well-formed result
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "rank",
              result: JSON.parse('{"toString":"x","__proto__":{"seen":"~000~"}}'),
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const decoded = (result.content[0] as { result: Record<string, unknown> }).result;
      expect(Object.getOwnPropertyNames(decoded)).toEqual(["toString", "__proto__"]);
      expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
      expect(
        (Object.getOwnPropertyDescriptor(decoded, "__proto__")?.value as { seen: string }).seen
      ).toBe(uuid);
    });

    test("a replaced preliminary result reports the content it was replaced with", async () => {
      // A preview is not the content the answer was built from, so the last result for a call is
      // the one that speaks for it
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~888~" },
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamParts(streamed.stream);

      expect(onDecode.mock.calls[0][0].warnings.map((w: { value: string }) => w.value)).toEqual([
        "~888~",
      ]);
    });

    test("a preliminary result with no final one still reports", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      // The stream ends before the final result the provider promised
      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamParts(streamed.stream);

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("a generated preliminary result and its replacement report one warning", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("a generated answer carrying only a preliminary result still reports", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("a streamed result the provider left undefined is passed through", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const streamed = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: undefined,
            },
            { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const parts = await collectStreamParts(streamed.stream);

      expect(parts[0]).toMatchObject({ result: undefined });
      expect(onDecode.mock.calls[0][0].warnings).toBeUndefined();
    });

    test("a streamed result is not serialised when nothing is listening", async () => {
      async function stringifyCalls(onDecode?: () => void) {
        const middleware = createMiddleware({ config, ...(onDecode && { onDecode }) });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage(`Look up ${uuid}`)]),
          type: "stream",
          model: mockModel,
        });

        const realStringify = JSON.stringify;
        let calls = 0;
        JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
          calls++;
          return realStringify(...args);
        }) as typeof JSON.stringify;
        try {
          const streamed = await middleware.wrapStream({
            doStream: vi.fn().mockResolvedValue({
              stream: createMockStream([
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "web_search",
                  result: { note: "~000~" },
                },
                { type: "finish", finishReason: mockFinishReason(), usage: mockUsage() },
              ] as LanguageModelV4StreamPart[]),
            }),
            doGenerate: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
          await collectStreamParts(streamed.stream);
        } finally {
          JSON.stringify = realStringify;
        }
        return calls;
      }

      expect(await stringifyCalls()).toBe(0);
      expect(await stringifyCalls(vi.fn())).toBeGreaterThan(0);
    });

    test("a result reaching the same object twice is not a cycle", async () => {
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const shared = { note: "~000~" };
      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { from: shared, to: shared },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(result.content[0]).toMatchObject({
        result: { from: { note: uuid }, to: { note: uuid } },
      });
    });

    test("two parallel calls to one tool each report", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
            },
            {
              type: "tool-result",
              toolCallId: "call-2",
              toolName: "web_search",
              result: { note: "saw ~888~" },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~777~",
          source: "tool_result",
          toolName: "web_search",
        },
        {
          type: "unknown_placeholder",
          value: "~888~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("the final result replaces what the preview said", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      // A preview is a guess at the answer, so only what replaced it describes the response
      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~777~" },
              preliminary: true,
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { note: "saw ~888~" },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings).toEqual([
        {
          type: "unknown_placeholder",
          value: "~888~",
          source: "tool_result",
          toolName: "web_search",
        },
      ]);
    });

    test("a tool result that references itself says so", async () => {
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const cyclic: Record<string, unknown> = { note: "~000~" };
      cyclic.self = cyclic;

      await expect(
        middleware.wrapGenerate({
          doGenerate: vi.fn().mockResolvedValue({
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "web_search",
                result: cyclic,
              },
            ],
            finishReason: mockFinishReason(),
            usage: mockUsage(),
            warnings: [],
          }),
          doStream: vi.fn(),
          params: transformedParams,
          model: mockModel,
        })
      ).rejects.toThrow(/circular/i);
    });

    test("a large result is not serialised when nothing is listening", async () => {
      async function stringifyCalls(onDecode?: () => void) {
        const middleware = createMiddleware({ config, ...(onDecode && { onDecode }) });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage(`Look up ${uuid}`)]),
          type: "generate",
          model: mockModel,
        });

        const realStringify = JSON.stringify;
        let calls = 0;
        JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
          calls++;
          return realStringify(...args);
        }) as typeof JSON.stringify;
        try {
          await middleware.wrapGenerate({
            doGenerate: vi.fn().mockResolvedValue({
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "web_search",
                  result: { note: "~000~" },
                },
              ],
              finishReason: mockFinishReason(),
              usage: mockUsage(),
              warnings: [],
            }),
            doStream: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
        } finally {
          JSON.stringify = realStringify;
        }
        return calls;
      }

      expect(await stringifyCalls()).toBe(0);
      expect(await stringifyCalls(vi.fn())).toBeGreaterThan(0);
    });

    test("a result holding no placeholder is handed back unchanged", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      const result = await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "web_search",
              result: { count: 3, ok: true, rows: [null, "plain"] },
            },
          ],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(result.content[0]).toMatchObject({
        result: { count: 3, ok: true, rows: [null, "plain"] },
      });
      expect(onDecode.mock.calls[0][0].warnings).toBeUndefined();
    });
  });

  describe("Ids inside a JSON payload", () => {
    const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
    const ids = Array.from(
      { length: 5 },
      (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`
    );

    // JSON.stringify writes a newline as a backslash and an 'n'. The id patterns open on a word
    // boundary, and 'n' is a word character, so encoding the serialised text loses the boundary.
    test.each([
      ["a newline", "\n"],
      ["a tab", "\t"],
      ["a carriage return", "\r"],
    ])("a tool result separated by %s compresses every id", async (_label, separator) => {
      const middleware = createMiddleware({ config });

      const result = await middleware.transformParams({
        params: createParams([
          userMessage("Here are the records."),
          toolMessage("call-1", "lookup", { type: "json", value: { list: ids.join(separator) } }),
        ]),
        type: "generate",
        model: mockModel,
      });

      const wire = JSON.stringify(result.prompt);
      for (const id of ids) expect(wire).not.toContain(id);
    });

    async function toolCallInputOnTheWire(input: unknown) {
      const middleware = createMiddleware({ config });
      const result = await middleware.transformParams({
        params: createParams([
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input }],
          } as LanguageModelV4Message,
        ]),
        type: "generate",
        model: mockModel,
      });

      const part = (result.prompt[0] as { content: { input: unknown }[] }).content[0];
      // The provider serialises what it is handed, so this is what the model sees
      return JSON.stringify(part.input);
    }

    test("a payload that references itself says so", async () => {
      const input: Record<string, unknown> = { note: `see ${ids[0]}` };
      input.self = input;

      await expect(toolCallInputOnTheWire(input)).rejects.toThrow(/circular/i);
    });

    test("a value behind toJSON is encoded, not carried past the encoder", async () => {
      const wire = await toolCallInputOnTheWire({
        note: { toJSON: () => `see ${ids[0]}` },
      });

      expect(wire).not.toContain(ids[0]);
    });

    test("two keys that encode to one placeholder are refused", async () => {
      // One entry standing for two is data lost before the model sees it, and the payload is the
      // caller's, so the caller is the one who can fix it
      await expect(
        toolCallInputOnTheWire({ [ids[0]]: "a", [ids[0].toUpperCase()]: "b" })
      ).rejects.toThrow(/same placeholder/i);

      await expect(toolCallInputOnTheWire({ [ids[0]]: "a", "~000~": "b" })).rejects.toThrow(
        /same placeholder/i
      );
    });

    test("a payload key named __proto__ stays an own key on the wire", async () => {
      // JSON.parse produces `__proto__` as an own key, and plain assignment would hand it to the
      // prototype setter instead: the field never reaches the model and the payload's prototype
      // becomes whatever was under it
      const wire = await toolCallInputOnTheWire(
        JSON.parse(`{"note":"see ${ids[0]}","__proto__":{"id":"${ids[0]}"}}`)
      );

      expect(wire).toBe('{"note":"see ~000~","__proto__":{"id":"~000~"}}');
    });

    test("an invented placeholder spelled like a prototype member is still reported", async () => {
      // The mapping is a plain record, so reading a model-controlled token off it finds whatever
      // Object.prototype carries and the token is taken for one this call minted
      const seen: unknown[] = [];
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: { template: "__prot{i:base62}__" } },
        onDecode: (result) => seen.push(result.warnings),
      });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${ids[0]}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "saw __proto__ and __protZ__" }],
          finishReason: mockFinishReason(),
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // `__protZ__` is the control: the same shape, spelling nothing Object.prototype carries
      expect(seen[0]).toEqual([
        { type: "unknown_placeholder", value: "__proto__", source: "text" },
        { type: "unknown_placeholder", value: "__protZ__", source: "text" },
      ]);
    });

    test("a payload key named toString is not read as a collision", async () => {
      // Every object inherits one, so a membership test that walks the prototype chain refuses a
      // payload that is perfectly well formed
      expect(await toolCallInputOnTheWire({ toString: "x", note: `see ${ids[0]}` })).toBe(
        '{"toString":"x","note":"see ~000~"}'
      );
    });

    test("an ordinary key spelled like a bare placeholder is refused too", async () => {
      // Numeric mints `000` and IdToken mints `0`, so a counter map or an array serialised as an
      // object holds a key the call is about to mint. The delimited formats have no such pair
      const middleware = createMiddleware({
        config: { inputFormat: "UUID", outputFormat: "Numeric" },
      });
      const wire = () =>
        middleware.transformParams({
          params: createParams([
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "lookup",
                  input: { "000": 1, [ids[0]]: 2 },
                },
              ],
            } as LanguageModelV4Message,
          ]),
          type: "generate",
          model: mockModel,
        });

      await expect(wire()).rejects.toThrow(/same placeholder "000"/);
      expect(await toolCallInputOnTheWire({ "000": 1, [ids[0]]: 2 })).toBe('{"000":1,"~000~":2}');
    });

    test("a payload that reaches the same object twice is not a cycle", async () => {
      const shared = { note: `see ${ids[0]}` };

      expect(await toolCallInputOnTheWire({ from: shared, to: shared })).toBe(
        '{"from":{"note":"see ~000~"},"to":{"note":"see ~000~"}}'
      );
    });

    // The provider stringifies what the walk hands back, so anything the walk leaves behind is
    // serialised a second time by rules the walk has already applied
    test.each([
      [
        "a toJSON whose result carries its own toJSON",
        { v: { toJSON: () => ({ toJSON: () => `see ${ids[0]}` }) } },
        '{"v":{}}',
      ],
      [
        "a toJSON returning a boxed string",
        { v: { toJSON: () => new String(ids[0]) } },
        '{"v":"~000~"}',
      ],
      ["a toJSON returning a boxed number", { v: { toJSON: () => new Number(42) } }, '{"v":42}'],
      ["a boxed false", { v: new Boolean(false) }, '{"v":false}'],
      ["a boxed empty string", { v: new String("") }, '{"v":""}'],
      ["a boxed zero", { v: new Number(0) }, '{"v":0}'],
      ["a property holding a function", { v: () => ids[0], n: 1 }, '{"n":1}'],
    ])("%s serialises the way the provider would", async (_label, input, expected) => {
      expect(await toolCallInputOnTheWire(input)).toBe(expected);
    });

    test("a Date survives as the string the provider would have written", async () => {
      const when = new Date("2026-01-02T03:04:05.000Z");

      expect(await toolCallInputOnTheWire({ when })).toBe('{"when":"2026-01-02T03:04:05.000Z"}');
    });

    test("a tool call input separated by a newline compresses every id", async () => {
      const middleware = createMiddleware({ config });
      const params = createParams([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: { list: ids.join("\n") },
            },
          ],
        } as LanguageModelV4Message,
      ]);

      const result = await middleware.transformParams({
        params,
        type: "generate",
        model: mockModel,
      });

      const wire = JSON.stringify(result.prompt);
      for (const id of ids) expect(wire).not.toContain(id);
    });
  });

  describe("A core too old to serve the middleware", () => {
    test("is refused where the middleware is built", async () => {
      // A peer range is a warning under pnpm and CJS resolves a missing export to undefined, so a
      // stale core otherwise runs a whole billed turn before anything notices
      const core = await import("prompt-identifiers");
      const real = core.findPlaceholders;
      Object.defineProperty(core, "findPlaceholders", { value: undefined, configurable: true });
      try {
        expect(() =>
          promptIdentifiersMiddleware({
            config: { inputFormat: "UUID", outputFormat: "SafeNumeric" },
            instruction: false,
          })
        ).toThrow(/prompt-identifiers 0\.2\.0 or later/);
      } finally {
        Object.defineProperty(core, "findPlaceholders", { value: real, configurable: true });
      }
    });
  });

  describe("An output format JSON cannot carry", () => {
    test.each([
      ["a double quote", '"{i:03}"'],
      ["a backslash", "\\\\{i:03}"],
      ["a control character", "\u0001{i:03}"],
    ])("%s in a placeholder is refused when the middleware is built", (_label, template) => {
      expect(() =>
        promptIdentifiersMiddleware({
          config: { inputFormat: "UUID", outputFormat: { template } },
          instruction: false,
        })
      ).toThrow(/tool call/i);
    });

    test("a format JSON carries unchanged is accepted", () => {
      expect(() =>
        promptIdentifiersMiddleware({
          config: { inputFormat: "UUID", outputFormat: { template: "[ID:{i:03}]" } },
          instruction: false,
        })
      ).not.toThrow();
    });
  });

  describe("Work nobody asked for", () => {
    const config: EncodeConfig = { inputFormat: "UUID", outputFormat: "SafeNumeric" };
    const ids = Array.from(
      { length: 20 },
      (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`
    );

    test("the warning scan does not run when nothing is listening for it", async () => {
      async function regexpsBuiltWith(onDecode?: () => void) {
        const middleware = createMiddleware({ config, ...(onDecode && { onDecode }) });
        const transformedParams = await middleware.transformParams({
          params: createParams([userMessage(`Look up ${ids.join(" ")}`)]),
          type: "generate",
          model: mockModel,
        });

        const RealRegExp = globalThis.RegExp;
        let built = 0;
        globalThis.RegExp = new Proxy(RealRegExp, {
          construct(target, args: ConstructorParameters<typeof RegExp>) {
            built++;
            return new target(...args);
          },
        });
        try {
          await middleware.wrapGenerate({
            doGenerate: vi.fn().mockResolvedValue({
              content: [{ type: "text", text: "~000~ and ~001~" }],
              finishReason: mockFinishReason(),
              usage: mockUsage(),
              warnings: [],
            } satisfies LanguageModelV4GenerateResult),
            doStream: vi.fn(),
            params: transformedParams,
            model: mockModel,
          });
        } finally {
          globalThis.RegExp = RealRegExp;
        }
        return built;
      }

      // core memoises a format's shape pattern on first use, so measure only once it is warm
      await regexpsBuiltWith(vi.fn());

      // The scan builds one RegExp per bare index, and only a listener can ever see the result
      const listening = await regexpsBuiltWith(vi.fn());
      const silent = await regexpsBuiltWith();

      expect(listening - silent).toBe(ids.length);
    });

    test("a mapping too large to spread does not crash the streaming decoder", async () => {
      const many = Array.from(
        { length: 150_000 },
        (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`
      );
      const middleware = createMiddleware({ config });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(many.join(" "))]),
        type: "stream",
        model: mockModel,
      });

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-delta", id: "1", delta: "found ~000~" },
            { type: "text-end", id: "1" },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await expect(collectStreamText(result.stream)).resolves.toBe(`found ${many[0]}`);
      // 150,000 ids is what it takes to pass the spread limit, and encoding them runs about 2.5s
      // on a quiet machine, which leaves nothing against vitest's default on a loaded one
    }, 20_000);
  });

  describe("An answer cut off mid-placeholder", () => {
    // A format with an opener and no closer cannot tell a cut-off placeholder from a short one
    const prefixOnly: EncodeConfig = {
      inputFormat: "UUID",
      outputFormat: { template: "ID_{i:04}" },
    };
    const uuid = "123e4567-e89b-42d3-a456-426655440000";

    async function warningsFromGenerate(
      text: string,
      unified: LanguageModelV4FinishReason["unified"]
    ) {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text }],
          finishReason: { unified, raw: unified },
          usage: mockUsage(),
          warnings: [],
        } satisfies LanguageModelV4GenerateResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      return onDecode.mock.calls[0][0].warnings ?? [];
    }

    test("the token limit cut the last placeholder in half, so it is not an invented one", async () => {
      // ID_0000 arrived as ID_000. Nothing closes the placeholder, so the scan reads the
      // shortened digit run as a whole one, though the format never writes a body that short.
      expect(await warningsFromGenerate("The record is ID_000", "length")).toEqual([]);
    });

    test("the same token in an answer that finished is still reported", async () => {
      expect(await warningsFromGenerate("The record is ID_000", "stop")).toEqual([
        { type: "unknown_placeholder", value: "ID_000", source: "text" },
      ]);
    });

    test.each([
      ["a content filter", "content-filter"],
      ["an error", "error"],
    ] as const)(
      "%s stopping the model mid-placeholder is a cut, not an invention",
      async (_l, unified) => {
        expect(await warningsFromGenerate("The record is ID_000", unified)).toEqual([]);
      }
    );

    test.each([
      ["the model finished", "stop"],
      ["the model called a tool", "tool-calls"],
    ] as const)("%s, so a half-written placeholder is the model's own", async (_l, unified) => {
      expect(await warningsFromGenerate("The record is ID_000", unified)).toEqual([
        { type: "unknown_placeholder", value: "ID_000", source: "text" },
      ]);
    });

    test("a longer invention alongside a cut token is still reported", async () => {
      // ID_000 starts the minted ID_0000, so a cut could have made it. ID_0009 starts nothing.
      expect(await warningsFromGenerate("ID_0009 then ID_000", "length")).toEqual([
        { type: "unknown_placeholder", value: "ID_0009", source: "text" },
      ]);
    });

    test("a truncated answer still reports a token that no placeholder could have been cut into", async () => {
      // The call minted ID_0000 .. ID_0059. ID_9999 starts none of them, so no cut produced it.
      const ids = Array.from(
        { length: 60 },
        (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`
      );

      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${ids.join(" ")}`)]),
        type: "generate",
        model: mockModel,
      });

      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "The record is ID_9999" }],
          finishReason: { unified: "length", raw: "length" },
          usage: mockUsage(),
          warnings: [],
        } satisfies LanguageModelV4GenerateResult),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings ?? []).toEqual([
        { type: "unknown_placeholder", value: "ID_9999", source: "text" },
      ]);
    });

    test("a stream ending at finish with no text-end still emits the held tail", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      // The buffer holds ID_00 back because it could still grow into ID_0000, and only the block
      // ending releases it. A provider that closes on finish alone never sends that ending.
      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "alpha ID_00" },
            {
              type: "finish",
              finishReason: { unified: "length", raw: "length" },
              usage: mockUsage(),
            },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const parts = await collectStreamParts(result.stream);

      expect(parts.filter((part) => part.type === "reasoning-delta")).toEqual([]);
      expect(
        parts
          .filter((part) => part.type === "text-delta")
          .map((part) => (part as { delta: string }).delta)
          .join("")
      ).toBe("alpha ID_00");
      expect(onDecode.mock.calls[0][0].output).toBe("alpha ID_00");
    });

    test("a generated answer with no finish reason is read as complete", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "generate",
        model: mockModel,
      });

      // A provider that omits the reason has still handed back the whole answer it means to send
      await middleware.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "The record is ID_000" }],
          usage: mockUsage(),
          warnings: [],
        }),
        doStream: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode.mock.calls[0][0].warnings ?? []).toEqual([
        { type: "unknown_placeholder", value: "ID_000", source: "text" },
      ]);
    });

    test("a stream that ends without a finish part is read as cut", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      // A stream that stops without saying why stopped somewhere the model did not choose
      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "The record is ID_000" },
            { type: "text-end", id: "a" },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamText(result.stream);

      expect(onDecode.mock.calls[0][0].warnings ?? []).toEqual([]);
    });

    test("two blocks cut by the same stop report neither half-written placeholder", async () => {
      const first = "123e4567-e89b-42d3-a456-426655440000";
      const second = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${first} and ${second}`)]),
        type: "stream",
        model: mockModel,
      });

      // Both blocks are holding half of a placeholder when the token limit ends the stream
      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "alpha ID_00" },
            { type: "text-start", id: "b" },
            { type: "text-delta", id: "b", delta: "beta ID_000" },
            {
              type: "finish",
              finishReason: { unified: "length", raw: "length" },
              usage: mockUsage(),
            },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamText(result.stream);

      expect(onDecode.mock.calls[0][0].warnings ?? []).toEqual([]);
    });

    test("a stream that stops at the token limit reports no invented placeholder", async () => {
      const onDecode = vi.fn();
      const middleware = createMiddleware({ config: prefixOnly, onDecode });
      const transformedParams = await middleware.transformParams({
        params: createParams([userMessage(`Look up ${uuid}`)]),
        type: "stream",
        model: mockModel,
      });

      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({
          stream: createMockStream([
            { type: "text-delta", id: "1", delta: "The record is ID_" },
            { type: "text-delta", id: "1", delta: "000" },
            {
              type: "finish",
              finishReason: { unified: "length", raw: "length" },
              usage: mockUsage(),
            },
          ] as LanguageModelV4StreamPart[]),
        }),
        doGenerate: vi.fn(),
        params: transformedParams,
        model: mockModel,
      });

      await collectStreamText(result.stream);

      expect(onDecode.mock.calls[0][0].warnings ?? []).toEqual([]);
    });
  });
});
