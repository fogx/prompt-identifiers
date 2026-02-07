/**
 * OpenAI API provider for LLM accuracy benchmark
 *
 * Requires OPENAI_API_KEY environment variable.
 */

// Dynamic import to avoid hard dependency
let OpenAI: typeof import("openai").default | undefined;

/**
 * Supported OpenAI models for the benchmark
 */
export const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;
export type OpenAIModel = (typeof OPENAI_MODELS)[number];

/**
 * Check if the OpenAI SDK is available
 */
export async function isOpenAIAvailable(): Promise<boolean> {
  try {
    const module = await import("openai");
    OpenAI = module.default;
    return !!process.env.OPENAI_API_KEY;
  } catch {
    return false;
  }
}

/**
 * Call OpenAI API with a prompt.
 *
 * @param prompt - The prompt to send
 * @param model - The OpenAI model to use
 * @returns The model's response text
 * @throws Error if API key is missing or API call fails
 */
export async function callOpenAI(prompt: string, model: OpenAIModel): Promise<string> {
  if (!OpenAI) {
    const module = await import("openai");
    OpenAI = module.default;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 16384,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content in response");
  }

  return content;
}

/**
 * Get model display name
 */
export function getModelDisplayName(model: OpenAIModel): string {
  const names: Record<OpenAIModel, string> = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
  };
  return names[model] || model;
}
