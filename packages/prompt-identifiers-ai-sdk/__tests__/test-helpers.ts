/**
 * Shared test helpers for AI SDK middleware tests.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { promptIdentifiersMiddleware, PromptIdentifiersMiddlewareOptions } from "../src/index";

// =============================================================================
// Mock Data Factories
// =============================================================================

export function mockUsage(input = 10, output = 5): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: input,
      noCache: input,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output,
      reasoning: undefined,
    },
  };
}

export function mockFinishReason(): LanguageModelV4FinishReason {
  return { unified: "stop", raw: "stop" };
}

// =============================================================================
// Mock Model
// =============================================================================

export const mockModel: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test-model",
  supportedUrls: {},
  doGenerate: async () => {
    throw new Error("Not implemented");
  },
  doStream: async () => {
    throw new Error("Not implemented");
  },
};

// =============================================================================
// Stream Helpers
// =============================================================================

export function createMockStream(
  parts: LanguageModelV4StreamPart[]
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

export async function collectStreamParts(
  stream: ReadableStream<LanguageModelV4StreamPart>
): Promise<LanguageModelV4StreamPart[]> {
  const reader = stream.getReader();
  const parts: LanguageModelV4StreamPart[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }

  return parts;
}

export async function collectStreamText(
  stream: ReadableStream<LanguageModelV4StreamPart>
): Promise<string> {
  const reader = stream.getReader();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "text-delta" && value.delta) {
      text += value.delta;
    }
  }

  return text;
}

// =============================================================================
// Message Factories
// =============================================================================

export function userMessage(text: string): LanguageModelV4Message {
  return { role: "user", content: [{ type: "text", text }] };
}

export function systemMessage(content: string): LanguageModelV4Message {
  return { role: "system", content };
}

export function toolMessage(
  toolCallId: string,
  toolName: string,
  output: { type: string; value: unknown }
): LanguageModelV4Message {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output,
      },
    ],
  } as LanguageModelV4Message;
}

// =============================================================================
// Params Helper
// =============================================================================

export function createParams(messages: LanguageModelV4Message[]): LanguageModelV4CallOptions {
  return {
    prompt: messages,
  };
}

// =============================================================================
// Content Extractors
// =============================================================================

export function getTextFromContent(content: LanguageModelV4GenerateResult["content"]): string {
  const textItem = content.find((item) => item.type === "text");
  return textItem?.type === "text" ? textItem.text : "";
}

// Type for our custom tool result output shape (text or json)
interface ToolResultOutput<T = unknown> {
  type: "text" | "json";
  value: T;
}

export function getToolResultOutput<T>(
  msg: LanguageModelV4Message
): ToolResultOutput<T> | undefined {
  if (msg.role !== "tool") return undefined;
  const toolResult = msg.content.find((p) => p.type === "tool-result");
  if (!toolResult || !("output" in toolResult)) return undefined;
  return toolResult.output as ToolResultOutput<T>;
}

export function getUserMessageText(msg: LanguageModelV4Message): string | undefined {
  if (msg.role !== "user") return undefined;
  const textPart = msg.content.find((p) => p.type === "text");
  return textPart?.type === "text" ? textPart.text : undefined;
}

export function getResultText(result: LanguageModelV4GenerateResult): string | undefined {
  const textContent = result.content.find((c) => c.type === "text");
  return textContent?.type === "text" ? textContent.text : undefined;
}

export function getToolCall(result: LanguageModelV4GenerateResult, index = 0) {
  const toolCalls = result.content.filter((c) => c.type === "tool-call");
  return toolCalls[index] as
    { type: "tool-call"; toolCallId: string; toolName: string; input: string } | undefined;
}

// =============================================================================
// Middleware Helper
// =============================================================================

type RequiredMiddleware = Required<
  Pick<LanguageModelV4Middleware, "transformParams" | "wrapGenerate" | "wrapStream">
>;

/**
 * Creates middleware and asserts all hooks are defined.
 * Throws at runtime if any hook is missing.
 */
export function createMiddleware(options: PromptIdentifiersMiddlewareOptions): RequiredMiddleware {
  const middleware = promptIdentifiersMiddleware({
    injectInstruction: false,
    ...options,
  });
  if (!middleware.transformParams || !middleware.wrapGenerate || !middleware.wrapStream) {
    throw new Error("Middleware hooks are required but not defined");
  }
  return {
    transformParams: middleware.transformParams,
    wrapGenerate: middleware.wrapGenerate,
    wrapStream: middleware.wrapStream,
  };
}

// =============================================================================
// Configurable Mock Model Factory
// =============================================================================

interface MockModelConfig {
  onGenerate?: (prompt: LanguageModelV4Message[]) => LanguageModelV4GenerateResult;
  onStream?: (prompt: LanguageModelV4Message[]) => LanguageModelV4StreamPart[];
}

export function createMockModel(config: MockModelConfig = {}): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},

    doGenerate: async (
      options: LanguageModelV4CallOptions
    ): Promise<LanguageModelV4GenerateResult> => {
      if (config.onGenerate) {
        return config.onGenerate(options.prompt);
      }
      return {
        content: [{ type: "text", text: "Default response" }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };
    },

    doStream: async (options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> => {
      if (config.onStream) {
        return { stream: createMockStream(config.onStream(options.prompt)) };
      }
      return {
        stream: createMockStream([{ type: "text-delta", id: "1", delta: "Default response" }]),
      };
    },
  };
}
