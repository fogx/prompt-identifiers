import { vi } from "vitest";
import type { EncodeConfig } from "prompt-identifiers";
import {
  collectStreamText,
  createMiddleware,
  createMockStream,
  createParams,
  mockModel,
  userMessage,
} from "./test-helpers";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

interface Harness {
  mapping: Record<string, string>;
  /** Stream `chunks` as text deltas and hand back the text a consumer sees. */
  run: (chunks: string[]) => Promise<string>;
}

/**
 * Encode `promptText` once, then reuse the same params (and therefore the same mapping) for as
 * many streamed runs as we like. Each run gets its own decoder, exactly as a real call would.
 */
export async function makeHarness(config: EncodeConfig, promptText: string): Promise<Harness> {
  let mapping: Record<string, string> = {};
  const middleware = createMiddleware({
    config,
    onEncode: (result: { mapping: Record<string, string> }) => {
      mapping = result.mapping;
    },
  });
  const params = await middleware.transformParams({
    params: createParams([userMessage(promptText)]),
    type: "stream",
    model: mockModel,
  });

  return {
    get mapping() {
      return mapping;
    },
    run: async (chunks: string[]) => {
      const parts = [
        ...chunks.map((delta) => ({ type: "text-delta", id: "t", delta })),
        // Without a closing chunk the decoder never flushes, so a held tail would go missing
        // for reasons that have nothing to do with what we are measuring.
        { type: "text-end", id: "t" },
      ] as LanguageModelV4StreamPart[];
      const result = await middleware.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: createMockStream(parts) }),
        doGenerate: vi.fn(),
        params,
        model: mockModel,
      });
      return collectStreamText(result.stream);
    },
  };
}

/** Every way of cutting `text` into 1 or 2 chunks, plus per-character and the empty-chunk case. */
export function splits(text: string): string[][] {
  const out: string[][] = [[text], text.split("")];
  for (let i = 0; i <= text.length; i++) {
    out.push([text.slice(0, i), text.slice(i)]);
  }
  out.push(["", text, ""]);
  return out;
}
