/**
 * prompt-identifiers-ai-sdk - Vercel AI SDK middleware for automatic ID encoding/decoding
 *
 * Automatically encodes IDs in prompts before LLM calls and decodes them in responses.
 */

import type {
    LanguageModelV3GenerateResult,
    LanguageModelV3Middleware,
    LanguageModelV3Prompt,
    LanguageModelV3StreamPart,
    LanguageModelV3StreamResult
} from '@ai-sdk/provider';
import { decode, encode, EncodeConfig } from 'prompt-identifiers';

// =============================================================================
// Types
// =============================================================================

/** Configuration options for the middleware */
export interface PromptIdentifiersMiddlewareOptions {
  /** Encoding configuration (inputFormat and outputFormat) */
  config: EncodeConfig;

  /**
   * Optional callback fired after encoding IDs in the prompt.
   * Useful for logging or debugging.
   */
  onEncode?: (result: {
    mapping: Record<string, string>;
    encodedCount: number;
  }) => void;

  /**
   * Optional callback fired after decoding IDs in the response.
   * Useful for logging or debugging.
   */
  onDecode?: (result: { decodedCount: number }) => void;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Merge encode result mappings into accumulated mapping.
 * Deduplicates by original ID to ensure consistent placeholder assignment.
 */
function mergeMapping(
  result: { mapping: Record<string, string> },
  idToPlaceholder: Map<string, string>,
  mapping: Record<string, string>
): void {
  for (const [placeholder, id] of Object.entries(result.mapping)) {
    if (!idToPlaceholder.has(id)) {
      idToPlaceholder.set(id, placeholder);
      mapping[placeholder] = id;
    }
  }
}

/**
 * Encode IDs in tool result output.
 * Handles both text and json output types.
 */
function encodeToolResultOutput(
  output: unknown,
  config: EncodeConfig,
  idToPlaceholder: Map<string, string>,
  mapping: Record<string, string>
): unknown {
  if (typeof output !== 'object' || output === null) {
    return output;
  }

  const typedOutput = output as { type?: string; value?: unknown };

  // For text output, encode the string value directly
  if (typedOutput.type === 'text' && typeof typedOutput.value === 'string') {
    const result = encode(typedOutput.value, config);
    mergeMapping(result, idToPlaceholder, mapping);
    return { ...typedOutput, value: result.encoded };
  }

  // For json output, stringify → encode → parse
  if (typedOutput.type === 'json' && typedOutput.value !== undefined) {
    const stringified = JSON.stringify(typedOutput.value);
    const result = encode(stringified, config);
    mergeMapping(result, idToPlaceholder, mapping);
    return { ...typedOutput, value: JSON.parse(result.encoded) };
  }

  return output;
}

/**
 * Encode IDs in message content.
 * Handles plain string content, multi-part content arrays (TextPart, ToolResultPart, etc.).
 */
function encodeMessageContent(
  content: unknown,
  config: EncodeConfig,
  idToPlaceholder: Map<string, string>,
  mapping: Record<string, string>
): unknown {
  if (typeof content === 'string') {
    const result = encode(content, config);
    mergeMapping(result, idToPlaceholder, mapping);
    return result.encoded;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part !== 'object' || part === null) {
        return part;
      }

      const typedPart = part as Record<string, unknown>;

      // Handle TextPart: { type: 'text', text: string }
      if ('text' in typedPart && typeof typedPart.text === 'string') {
        return {
          ...typedPart,
          text: encodeMessageContent(typedPart.text, config, idToPlaceholder, mapping),
        };
      }

      // Handle ToolResultPart: { type: 'tool-result', output: { type, value } }
      if (typedPart.type === 'tool-result' && 'output' in typedPart) {
        return {
          ...typedPart,
          output: encodeToolResultOutput(typedPart.output, config, idToPlaceholder, mapping),
        };
      }

      return part;
    });
  }

  return content;
}

/**
 * Encode IDs in all messages of the params.
 * Returns the mapping separately - the caller handles merging with original params.
 */
function encodePromptMessages(
  prompt: LanguageModelV3Prompt,
  config: EncodeConfig
): { encodedPrompt: LanguageModelV3Prompt; mapping: Record<string, string> } {
  const idToPlaceholder = new Map<string, string>();
  const mapping: Record<string, string> = {};

  const encodedPrompt = prompt.map((message) => ({
    ...message,
    content: encodeMessageContent(
      message.content,
      config,
      idToPlaceholder,
      mapping
    ),
  })) as LanguageModelV3Prompt;

  return { encodedPrompt, mapping };
}

/**
 * Decode IDs in text content using the mapping.
 */
function decodeText(
  text: string,
  mapping: Record<string, string>
): { decoded: string; count: number } {
  const decoded = decode(text, mapping);
  // Count how many placeholders were replaced
  const count = Object.keys(mapping).reduce((acc, placeholder) => {
    const regex = new RegExp(
      placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    );
    return acc + (text.match(regex)?.length ?? 0);
  }, 0);
  return { decoded, count };
}

/**
 * Decode IDs in tool call input string.
 * The input is always a stringified JSON in tool calls.
 */
function decodeToolInputString(
  input: string,
  mapping: Record<string, string>
): string {
  return decode(input, mapping);
}

// =============================================================================
// Streaming Buffer
// =============================================================================

/**
 * Creates a streaming buffer that handles placeholders split across chunks.
 *
 * For delimited formats like SafeNumeric (<000>, <001>, etc.), placeholders
 * may arrive split across chunks: "<00" | "0>" or "<" | "000" | ">"
 *
 * Strategy: Buffer content when we see an opening delimiter,
 * flush when we see the closing delimiter.
 *
 * For non-delimited formats (Numeric, IdToken), buffering isn't possible
 * so we decode immediately.
 */
function createStreamingDecoder(mapping: Record<string, string>) {
  // Detect delimiter pattern from mapping keys
  const placeholders = Object.keys(mapping);
  if (placeholders.length === 0) {
    return {
      process: (text: string) => text,
      flush: () => '',
    };
  }

  // Detect delimiter pattern from the first placeholder
  // e.g., "<000>" -> open="<", close=">"
  // e.g., "[[000]]" -> open="[[", close="]]"
  // e.g., "000" -> no delimiters (can't buffer)
  const firstPlaceholder = placeholders[0];
  const match = firstPlaceholder.match(/^([^\d]*)\d+([^\d]*)$/);

  if (!match || (!match[1] && !match[2])) {
    // No delimiters found (e.g., pure "000", "A", "z")
    // Can't reliably buffer, just decode immediately
    return {
      process: (text: string) => decode(text, mapping),
      flush: () => '',
    };
  }

  const OPEN = match[1];
  const CLOSE = match[2];

  if (!OPEN) {
    // No opening delimiter means we can't detect incomplete placeholders
    return {
      process: (text: string) => decode(text, mapping),
      flush: () => '',
    };
  }

  // Buffer incomplete placeholders
  let buffer = '';

  return {
    process: (text: string): string => {
      buffer += text;

      // Find the last opening delimiter that doesn't have a matching close
      const lastOpen = buffer.lastIndexOf(OPEN);
      const lastClose = buffer.lastIndexOf(CLOSE);

      if (lastOpen > lastClose) {
        // We have an incomplete placeholder, hold it in buffer
        const complete = buffer.substring(0, lastOpen);
        buffer = buffer.substring(lastOpen);
        return decode(complete, mapping);
      }

      // All placeholders are complete, decode everything
      const result = decode(buffer, mapping);
      buffer = '';
      return result;
    },

    flush: (): string => {
      // Stream ended, decode whatever remains (might be incomplete placeholder)
      const result = decode(buffer, mapping);
      buffer = '';
      return result;
    },
  };
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Creates a Vercel AI SDK middleware that automatically encodes IDs in prompts
 * and decodes them in responses.
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { wrapLanguageModel } from 'ai';
 * import { promptIdentifiersMiddleware } from 'prompt-identifiers-ai-sdk';a
 *
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4o'),
 *   middleware: promptIdentifiersMiddleware({
 *     config: { inputFormat: 'UUIDv4', outputFormat: 'SafeNumeric' },
 *     onEncode: (result) => console.log(`Encoded ${result.encodedCount} IDs`),
 *   })
 * });
 *
 * // Use normally - IDs are auto-encoded/decoded
 * const result = await generateText({
 *   model,
 *   prompt: 'Summarize activity for user 123e4567-e89b-42d3-a456-426655440000'
 * });
 * ```
 */
// Symbol to attach mapping to params object - survives SDK transformations
const MAPPING_SYMBOL = Symbol('promptIdentifiersMapping');

interface ParamsWithMapping {
  [MAPPING_SYMBOL]?: Record<string, string>;
}

export function promptIdentifiersMiddleware(
  options: PromptIdentifiersMiddlewareOptions
): LanguageModelV3Middleware {
  const { config, onEncode, onDecode } = options;

  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const { encodedPrompt, mapping } = encodePromptMessages(params.prompt, config);

      onEncode?.({
        mapping,
        encodedCount: Object.keys(mapping).length,
      });

      // Attach mapping to params using Symbol - survives spread/clone operations
      const transformedParams = {
        ...params,
        prompt: encodedPrompt,
        [MAPPING_SYMBOL]: mapping,
      };

      return transformedParams;
    },

    wrapGenerate: async ({ doGenerate, params }): Promise<LanguageModelV3GenerateResult> => {
      const result = await doGenerate();
      const mapping = (params as ParamsWithMapping)[MAPPING_SYMBOL] ?? {};

      if (Object.keys(mapping).length === 0) {
        return result;
      }

      // Decode text and tool call inputs in content array
      let totalCount = 0;
      const decodedContent = result.content.map((item) => {
        if (item.type === 'text') {
          const { decoded, count } = decodeText(item.text, mapping);
          totalCount += count;
          return { ...item, text: decoded };
        }
        // Decode tool call inputs (input is stringified JSON)
        if (item.type === 'tool-call' && 'input' in item && typeof item.input === 'string') {
          return { ...item, input: decodeToolInputString(item.input, mapping) };
        }
        return item;
      });

      onDecode?.({ decodedCount: totalCount });
      return { ...result, content: decodedContent };
    },

    wrapStream: async ({ doStream, params }): Promise<LanguageModelV3StreamResult> => {
      const { stream, ...rest } = await doStream();
      const mapping = (params as ParamsWithMapping)[MAPPING_SYMBOL] ?? {};

      if (Object.keys(mapping).length === 0) {
        return { stream, ...rest };
      }

      const textDecoder = createStreamingDecoder(mapping);

      // Transform the stream to decode placeholders in text and tool calls
      const transformedStream = new TransformStream<
        LanguageModelV3StreamPart,
        LanguageModelV3StreamPart
      >({
        transform(chunk, controller) {
          // Decode text deltas
          if (chunk.type === 'text-delta' && chunk.delta) {
            const decoded = textDecoder.process(chunk.delta);
            if (decoded) {
              controller.enqueue({ ...chunk, delta: decoded });
            }
            return;
          }

          // Decode complete tool calls (input is stringified JSON)
          if (chunk.type === 'tool-call' && 'input' in chunk && typeof chunk.input === 'string') {
            controller.enqueue({ ...chunk, input: decodeToolInputString(chunk.input, mapping) });
            return;
          }

          // Decode tool input deltas (partial JSON strings)
          if (chunk.type === 'tool-input-delta' && 'delta' in chunk) {
            const decodedDelta = decode((chunk as { delta: string }).delta, mapping);
            controller.enqueue({ ...chunk, delta: decodedDelta });
            return;
          }

          controller.enqueue(chunk);
        },

        flush(controller) {
          const remaining = textDecoder.flush();
          if (remaining) {
            controller.enqueue({
              type: 'text-delta',
              id: '',
              delta: remaining,
            } as LanguageModelV3StreamPart);
          }
        },
      });

      return {
        stream: stream.pipeThrough(transformedStream),
        ...rest,
      };
    },
  };
}
