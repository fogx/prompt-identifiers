import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { describe, expect, test } from "vitest";

import { promptIdentifiersMiddleware } from "../src/index";
import { createMockModel } from "./test-helpers";

const config = { inputFormat: "UUID", outputFormat: "SafeNumeric" } as const;
const uuids = [
  "123e4567-e89b-42d3-a456-426655440000",
  "987fcdeb-51a2-43f7-8d9c-0123456789ab",
  "3f1c1a2a-60a6-444f-915f-7960a929fb78",
];

/** Turns carrying no ID, the first ID, more IDs, and back to none */
const turns = [
  "Hello there",
  `Look at ${uuids[0]}`,
  `Compare ${uuids[0]} with ${uuids[1]}`,
  "Thanks",
  `And ${uuids[2]}`,
];

describe("instruction stability", () => {
  test("the system message reads the same on every call of a conversation", async () => {
    const middleware = promptIdentifiersMiddleware({
      config,
      instruction: "Identifiers look like {format}. Pass them verbatim.",
    });

    const systemMessages = new Set<string>();
    for (const text of turns) {
      const prompt: LanguageModelV4Prompt = [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: [{ type: "text", text }] },
      ];
      const result = await middleware.transformParams?.({
        params: { prompt },
        type: "generate",
        model: createMockModel(),
      });
      systemMessages.add(JSON.stringify(result?.prompt[0]));
    }

    expect([...systemMessages]).toEqual([
      JSON.stringify({
        role: "system",
        content: "You are an assistant.\n\nIdentifiers look like ~000~. Pass them verbatim.",
      }),
    ]);
  });

  test("Passthrough leaves the prompt alone, since it encodes nothing", async () => {
    const middleware = promptIdentifiersMiddleware({
      config: { inputFormat: "UUID", outputFormat: "Passthrough" },
      instruction: "Identifiers look like {format}. Pass them verbatim.",
    });
    const prompt: LanguageModelV4Prompt = [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: [{ type: "text", text: `Look at ${uuids[0]}` }] },
    ];

    const result = await middleware.transformParams?.({
      params: { prompt },
      type: "generate",
      model: createMockModel(),
    });

    expect(result?.prompt).toEqual(prompt);
  });
  async function systemMessageOf(options: Record<string, unknown>) {
    const middleware = promptIdentifiersMiddleware({ config, ...options } as never);
    const result = await middleware.transformParams?.({
      params: {
        prompt: [
          { role: "user", content: [{ type: "text", text: `Look at ${uuids[0]}` }] },
        ] as LanguageModelV4Prompt,
      },
      type: "generate",
      model: createMockModel(),
    });
    const first = result?.prompt[0];
    return first?.role === "system" ? (first.content as string) : undefined;
  }

  test("omitting the instruction sends the default one", async () => {
    // Without an instruction most models strip the delimiters out of tool call arguments, so the
    // option defaulting to nothing would be the wrong way round
    expect(await systemMessageOf({})).toBe(
      "UUIDs have been replaced with short identifiers like ~000~. Always pass these identifiers verbatim"
    );
  });

  test("the option a caller used before this one still works", async () => {
    expect(await systemMessageOf({ injectInstruction: false })).toBeUndefined();
    expect(await systemMessageOf({ customInstruction: "Keep {format} as written." })).toBe(
      "Keep ~000~ as written."
    );
  });

  test("the new option wins over the pair it replaced", async () => {
    expect(
      await systemMessageOf({
        instruction: "The new one.",
        customInstruction: "The old one.",
        injectInstruction: true,
      })
    ).toBe("The new one.");
  });

  test("false sends no instruction, leaving the prompt's own messages alone", async () => {
    const middleware = promptIdentifiersMiddleware({ config, instruction: false });
    const prompt: LanguageModelV4Prompt = [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: [{ type: "text", text: `Look at ${uuids[0]}` }] },
    ];

    const result = await middleware.transformParams?.({
      params: { prompt },
      type: "generate",
      model: createMockModel(),
    });

    expect(result?.prompt[0]).toEqual({ role: "system", content: "You are an assistant." });
    expect(result?.prompt).toHaveLength(2);
  });
});
