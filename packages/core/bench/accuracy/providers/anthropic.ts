/**
 * Anthropic Claude API provider for LLM accuracy benchmark
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

// Dynamic import to avoid hard dependency
let Anthropic: typeof import("@anthropic-ai/sdk").default | undefined;

/**
 * Supported Claude models for the benchmark
 */
export const CLAUDE_MODELS = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

/**
 * Check if the Anthropic SDK is available
 */
export async function isAnthropicAvailable(): Promise<boolean> {
  try {
    const module = await import("@anthropic-ai/sdk");
    Anthropic = module.default;
    return !!process.env.ANTHROPIC_API_KEY;
  } catch {
    return false;
  }
}

/**
 * Call Claude API with a prompt.
 *
 * @param prompt - The prompt to send
 * @param model - The Claude model to use
 * @returns The model's response text
 * @throws Error if API key is missing or API call fails
 */
export async function callClaude(prompt: string, model: ClaudeModel): Promise<string> {
  if (!Anthropic) {
    const module = await import("@anthropic-ai/sdk");
    Anthropic = module.default;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const client = new Anthropic({ apiKey });

  // Use structured outputs beta for JSON response
  const response = await client.beta.messages.create({
    model,
    max_tokens: 8192,
    betas: ["structured-outputs-2025-11-13"],
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    output_format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          aggregations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                class_id: { type: "string" },
                count: { type: "integer" },
                names: { type: "array", items: { type: "string" } },
              },
              required: ["class_id", "count", "names"],
              additionalProperties: false,
            },
          },
        },
        required: ["aggregations"],
        additionalProperties: false,
      },
    },
  });

  // Extract text from response
  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return textContent.text;
}

/**
 * Get model display name
 */
export function getModelDisplayName(model: ClaudeModel): string {
  const names: Record<ClaudeModel, string> = {
    "claude-sonnet-4-20250514": "Claude Sonnet 4",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  };
  return names[model] || model;
}
