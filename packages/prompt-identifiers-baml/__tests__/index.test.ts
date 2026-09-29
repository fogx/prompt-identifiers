import { describe, test, expect, vi } from "vitest";
import type { EncodeConfig } from "prompt-identifiers";
import {
  decodeObject,
  encodeObject,
  wrapBamlFunction,
  wrapBamlStreamingFunction,
} from "../src/index";
import type { BamlStreamFunction } from "../src/index";

describe("prompt-identifiers-baml", () => {
  const defaultConfig: EncodeConfig = {
    inputFormat: "UUID",
    outputFormat: "SafeNumeric",
  };

  const uuid1 = "123e4567-e89b-42d3-a456-426655440000";
  const uuid2 = "987fcdeb-51a2-43f7-8d9c-0123456789ab";

  describe("wrapBamlFunction", () => {
    test("encodes UUIDs in input and decodes in output", async () => {
      // Mock BAML function that echoes input in output
      const mockFn = vi.fn(async (input: { user_id: string }) => ({
        summary: `Analysis for user ${input.user_id}`,
        user_id: input.user_id,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ user_id: uuid1 });

      // Verify mock was called with encoded input
      expect(mockFn).toHaveBeenCalledWith({ user_id: "~000~" });

      // Verify output is decoded
      expect(result.summary).toBe(`Analysis for user ${uuid1}`);
      expect(result.user_id).toBe(uuid1);
    });

    test("handles nested objects", async () => {
      interface Input {
        data: {
          user: {
            id: string;
            name: string;
          };
        };
      }

      interface Output {
        result: {
          user_id: string;
          message: string;
        };
      }

      const mockFn = vi.fn(async (input: Input): Promise<Output> => ({
        result: {
          user_id: input.data.user.id,
          message: `Hello ${input.data.user.name}, your ID is ${input.data.user.id}`,
        },
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({
        data: {
          user: {
            id: uuid1,
            name: "John",
          },
        },
      });

      // Verify encoding
      expect(mockFn).toHaveBeenCalledWith({
        data: {
          user: {
            id: "~000~",
            name: "John",
          },
        },
      });

      // Verify decoding
      expect(result.result.user_id).toBe(uuid1);
      expect(result.result.message).toBe(`Hello John, your ID is ${uuid1}`);
    });

    test("handles arrays of objects", async () => {
      interface Input {
        items: Array<{ id: string; name: string }>;
      }

      const mockFn = vi.fn(async (input: Input) => ({
        processed: input.items.map((item) => `${item.id}: ${item.name}`),
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({
        items: [
          { id: uuid1, name: "Item 1" },
          { id: uuid2, name: "Item 2" },
        ],
      });

      // Verify encoding
      expect(mockFn).toHaveBeenCalledWith({
        items: [
          { id: "~000~", name: "Item 1" },
          { id: "~001~", name: "Item 2" },
        ],
      });

      // Verify decoding
      expect(result.processed).toEqual([`${uuid1}: Item 1`, `${uuid2}: Item 2`]);
    });

    test("deduplicates repeated UUIDs", async () => {
      const mockFn = vi.fn(async (input: { ids: string[] }) => ({
        summary: input.ids.join(", "),
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({
        ids: [uuid1, uuid2, uuid1], // uuid1 appears twice
      });

      // Verify encoding uses same placeholder for duplicate
      expect(mockFn).toHaveBeenCalledWith({
        ids: ["~000~", "~001~", "~000~"],
      });

      // Verify decoding
      expect(result.summary).toBe(`${uuid1}, ${uuid2}, ${uuid1}`);
    });

    test("calls onEncode and onDecode callbacks", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: `Found: ${input.id}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        onEncode,
        onDecode,
      });

      await wrapped({ id: uuid1 });

      expect(onEncode).toHaveBeenCalledWith({
        mapping: { "~000~": uuid1 },
      });
      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();

      expect(onDecode).toHaveBeenCalledWith({});
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });

    test("handles null and undefined values", async () => {
      interface Input {
        id: string;
        optional?: string | null;
      }

      const mockFn = vi.fn(async (input: Input) => ({
        id: input.id,
        optional: input.optional,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ id: uuid1, optional: null });

      expect(mockFn).toHaveBeenCalledWith({ id: "~000~", optional: null });
      expect(result.id).toBe(uuid1);
      expect(result.optional).toBeNull();
    });

    test("preserves non-string primitives", async () => {
      interface Input {
        id: string;
        count: number;
        active: boolean;
      }

      const mockFn = vi.fn(async (input: Input) => ({
        ...input,
        message: `ID: ${input.id}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ id: uuid1, count: 42, active: true });

      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.message).toBe(`ID: ${uuid1}`);
    });
  });

  describe("encodeFields option", () => {
    test("only encodes specified top-level fields", async () => {
      const mockFn = vi.fn(async (input: { user_id: string; owner_id: string; code: string }) => ({
        result: `${input.user_id} - ${input.code}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        // Two paths are a union, not an intersection: no value sits at both
        encodeFields: ["user_id", "owner_id"],
      });

      // code looks like a UUID but shouldn't be encoded
      const codeUuid = "11111111-1111-4111-8111-111111111111";

      await wrapped({ user_id: uuid1, owner_id: uuid2, code: codeUuid });

      expect(mockFn).toHaveBeenCalledWith({
        user_id: "~000~",
        owner_id: "~001~",
        code: codeUuid, // Not encoded
      });
    });

    test("encodes nested fields with dot notation", async () => {
      interface Input {
        data: {
          user_id: string;
          other_id: string;
        };
      }

      const mockFn = vi.fn(async (input: Input) => ({
        result: input.data.user_id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ["data.user_id"],
      });

      await wrapped({
        data: {
          user_id: uuid1,
          other_id: uuid2,
        },
      });

      expect(mockFn).toHaveBeenCalledWith({
        data: {
          user_id: "~000~",
          other_id: uuid2, // Not encoded
        },
      });
    });

    test("encodes array fields with [] wildcard", async () => {
      interface Input {
        items: Array<{ id: string; code: string }>;
      }

      const mockFn = vi.fn(async (input: Input) => ({
        ids: input.items.map((i) => i.id),
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ["items[].id"],
      });

      await wrapped({
        items: [
          { id: uuid1, code: "ABC123" },
          { id: uuid2, code: "DEF456" },
        ],
      });

      expect(mockFn).toHaveBeenCalledWith({
        items: [
          { id: "~000~", code: "ABC123" },
          { id: "~001~", code: "DEF456" },
        ],
      });
    });

    test("encodes deeply nested array fields", async () => {
      interface Input {
        data: {
          users: Array<{
            profile: {
              id: string;
            };
          }>;
        };
      }

      const mockFn = vi.fn(async (input: Input) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ["data.users[].profile.id"],
      });

      await wrapped({
        data: {
          users: [{ profile: { id: uuid1 } }, { profile: { id: uuid2 } }],
        },
      });

      expect(mockFn).toHaveBeenCalledWith({
        data: {
          users: [{ profile: { id: "~000~" } }, { profile: { id: "~001~" } }],
        },
      });
    });
  });

  describe("wrapBamlStreamingFunction", () => {
    test("encodes input and decodes streaming output", async () => {
      // Mock streaming BAML function
      async function* mockStreamFn(input: { id: string }) {
        yield { partial: `Processing ${input.id}...` };
        yield { partial: `Almost done with ${input.id}...` };
        return { final: `Completed for ${input.id}` };
      }

      const wrapped = wrapBamlStreamingFunction(mockStreamFn, {
        config: defaultConfig,
      });

      const partials: any[] = [];
      let finalResult: any;

      const generator = wrapped({ id: uuid1 });

      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          finalResult = value;
          break;
        }
        partials.push(value);
      }

      // Verify partials are decoded
      expect(partials[0].partial).toBe(`Processing ${uuid1}...`);
      expect(partials[1].partial).toBe(`Almost done with ${uuid1}...`);

      // Verify final is decoded
      expect(finalResult.final).toBe(`Completed for ${uuid1}`);
    });

    test("calls callbacks for streaming function", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      async function* mockStreamFn(input: { id: string }) {
        yield { status: input.id };
        return { done: true };
      }

      const wrapped = wrapBamlStreamingFunction(mockStreamFn, {
        config: defaultConfig,
        onEncode,
        onDecode,
      });

      const generator = wrapped({ id: uuid1 });

      // Consume the generator
      while (!(await generator.next()).done) {}

      expect(onEncode).toHaveBeenCalledWith({
        mapping: { "~000~": uuid1 },
      });
      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();

      expect(onDecode).toHaveBeenCalledWith({});
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });
  });

  describe("encodeObject utility", () => {
    test("encodes object and returns mapping", () => {
      const { encoded, mapping } = encodeObject(
        {
          user_id: uuid1,
          data: { owner: uuid2 },
        },
        defaultConfig
      );

      expect(encoded).toEqual({
        user_id: "~000~",
        data: { owner: "~001~" },
      });

      expect(mapping).toEqual({
        "~000~": uuid1,
        "~001~": uuid2,
      });
    });

    test("respects encodeFields option", () => {
      const { encoded } = encodeObject(
        {
          user_id: uuid1,
          code: uuid2,
        },
        defaultConfig,
        ["user_id"]
      );

      expect(encoded).toEqual({
        user_id: "~000~",
        code: uuid2, // Not encoded
      });
    });
  });

  describe("decodeObject utility", () => {
    test("decodes object with mapping", () => {
      const decoded = decodeObject(
        {
          user_id: "~000~",
          summary: "User ~000~ is active",
        },
        { "~000~": uuid1 }
      );

      expect(decoded).toEqual({
        user_id: uuid1,
        summary: `User ${uuid1} is active`,
      });
    });

    test("handles nested structures", () => {
      const decoded = decodeObject(
        {
          data: {
            items: [{ id: "~000~" }, { id: "~001~" }],
          },
        },
        { "~000~": uuid1, "~001~": uuid2 }
      );

      expect(decoded).toEqual({
        data: {
          items: [{ id: uuid1 }, { id: uuid2 }],
        },
      });
    });
  });

  describe("Different output formats", () => {
    test("works with Numeric format", async () => {
      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: "UUID", outputFormat: "Numeric" },
      });

      await wrapped({ id: uuid1 });

      expect(mockFn).toHaveBeenCalledWith({ id: "000" });
    });

    test("works with custom template format", async () => {
      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: "UUID", outputFormat: { template: "[ID:{i}]" } },
      });

      await wrapped({ id: uuid1 });

      expect(mockFn).toHaveBeenCalledWith({ id: "[ID:0]" });
    });

    test("works with ULID input format", async () => {
      const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: "ULID", outputFormat: "SafeNumeric" },
      });

      const result = await wrapped({ id: ulid });

      expect(mockFn).toHaveBeenCalledWith({ id: "~000~" });
      expect(result.result).toBe(ulid);
    });
  });

  describe("Edge cases", () => {
    test("handles empty objects", async () => {
      const mockFn = vi.fn(async (input: {}) => ({ result: "ok" }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({});

      expect(result.result).toBe("ok");
    });

    test("handles input with no IDs", async () => {
      const mockFn = vi.fn(async (input: { name: string }) => ({
        greeting: `Hello, ${input.name}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ name: "Alice" });

      expect(mockFn).toHaveBeenCalledWith({ name: "Alice" });
      expect(result.greeting).toBe("Hello, Alice");
    });

    test("handles output with no placeholders", async () => {
      const mockFn = vi.fn(async (input: { id: string }) => ({
        message: "No IDs in response",
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ id: uuid1 });

      expect(result.message).toBe("No IDs in response");
    });
  });

  describe("debug mode", () => {
    test("wrapBamlFunction populates debugData when debug is true", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: `Found: ${input.id}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        debug: true,
        onEncode,
        onDecode,
      });

      const input = { id: uuid1 };
      await wrapped(input);

      // onEncode debugData
      const encodeResult = onEncode.mock.calls[0][0];
      expect(encodeResult.mapping).toEqual({ "~000~": uuid1 });
      expect(encodeResult.debugData).toBeDefined();
      expect(encodeResult.debugData.encodedCount).toBe(1);
      expect(encodeResult.debugData.input).toEqual({ id: uuid1 });
      expect(encodeResult.debugData.output).toEqual({ id: "~000~" });
      expect(typeof encodeResult.debugData.durationMs).toBe("number");

      // onDecode debugData
      const decodeResult = onDecode.mock.calls[0][0];
      expect(decodeResult.debugData).toBeDefined();
      expect(decodeResult.debugData.decodedCount).toBe(1);
      expect(decodeResult.debugData.input).toEqual({ result: "Found: ~000~" });
      expect(decodeResult.debugData.output).toEqual({ result: `Found: ${uuid1}` });
      expect(typeof decodeResult.debugData.durationMs).toBe("number");
    });

    test("wrapBamlStreamingFunction populates debugData when debug is true", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      async function* mockStreamFn(input: { id: string }) {
        yield { partial: `Processing ${input.id}...` };
        return { final: `Done for ${input.id}` };
      }

      const wrapped = wrapBamlStreamingFunction(mockStreamFn, {
        config: defaultConfig,
        debug: true,
        onEncode,
        onDecode,
      });

      const generator = wrapped({ id: uuid1 });
      while (!(await generator.next()).done) {}

      // onEncode debugData
      const encodeResult = onEncode.mock.calls[0][0];
      expect(encodeResult.debugData).toBeDefined();
      expect(encodeResult.debugData.encodedCount).toBe(1);
      expect(encodeResult.debugData.input).toEqual({ id: uuid1 });
      expect(encodeResult.debugData.output).toEqual({ id: "~000~" });

      // onDecode debugData
      const decodeResult = onDecode.mock.calls[0][0];
      expect(decodeResult.debugData).toBeDefined();
      expect(decodeResult.debugData.decodedCount).toBeGreaterThanOrEqual(1);
      expect(typeof decodeResult.debugData.durationMs).toBe("number");
    });

    test("debugData is absent when debug is false", async () => {
      const onEncode = vi.fn();
      const onDecode = vi.fn();

      const mockFn = vi.fn(async (input: { id: string }) => ({
        result: `Found: ${input.id}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        debug: false,
        onEncode,
        onDecode,
      });

      await wrapped({ id: uuid1 });

      expect(onEncode.mock.calls[0][0].debugData).toBeUndefined();
      expect(onDecode.mock.calls[0][0].debugData).toBeUndefined();
    });
  });

  // Own keys and internal slots are not exclusive: this carries both
  class TaggedMap extends Map<string, string> {
    label = "x";
  }

  describe("A value that is not a plain record", () => {
    // A BAML media argument is a native handle: prototype null, no own enumerable keys, all state
    // behind the handle. Rebuilding one from its entries hands the runtime an empty object.
    test.each([
      ["a native handle", Object.create(null)],
      ["a Date", new Date("2026-01-02T03:04:05.000Z")],
      ["a Map", new Map([["k", "v"]])],
      ["a Set", new Set(["v"])],
      ["a RegExp", /x/g],
      ["a typed array", new Uint8Array([1, 2, 3])],
      ["a Map subclass carrying a field", new TaggedMap([["k", "v"]])],
      ["an Error with an own field", Object.assign(new Error("boom"), { code: "E1" })],
    ])("%s reaches the function by identity", async (_label, value) => {
      const mockFn = vi.fn(async (_input: { arg: unknown }) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      await wrapped({ arg: value });

      expect(mockFn.mock.calls[0][0].arg).toBe(value);
    });

    // The same rows on the way back, because the decode side carries the same rule
    test.each([
      ["a native handle", Object.create(null)],
      ["a Date", new Date("2026-01-02T03:04:05.000Z")],
      ["a Map", new Map([["k", "v"]])],
      ["a Set", new Set(["v"])],
      ["a RegExp", /x/g],
      ["a typed array", new Uint8Array([1, 2, 3])],
      ["a Map subclass carrying a field", new TaggedMap([["k", "v"]])],
      ["an Error with an own field", Object.assign(new Error("boom"), { code: "E1" })],
    ])("%s in a result comes back by identity too", async (_label, value) => {
      const mockFn = vi.fn(async () => ({ held: value, note: "~000~" }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      const result = await wrapped({ id: uuid1 });

      expect(result.held).toBe(value);
      expect(result.note).toBe(uuid1);
    });

    test("a value with slots and a field keeps both", async () => {
      // Own keys and internal slots are not exclusive, and an Error carries both. Its tag is not
      // "[object Object]", so it is handed on as it is rather than rebuilt from its keys, which
      // would have carried the field across and left the slots behind
      const failure = Object.assign(new Error("boom"), { code: "E1" });
      const mockFn = vi.fn(async (_input: { failure: Error }) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      await wrapped({ failure });

      const sent = mockFn.mock.calls[0][0].failure;
      expect(sent).toBe(failure);
      expect(sent.message).toBe("boom");
    });

    test("a class instance has its fields encoded and keeps its prototype", async () => {
      class UserDto {
        constructor(public user_id: string) {}
        label() {
          return `user ${this.user_id}`;
        }
      }
      const mockFn = vi.fn(async (_input: UserDto) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      await wrapped(new UserDto(uuid1));

      const sent = mockFn.mock.calls[0][0];
      expect(sent.user_id).toBe("~000~");
      expect(sent).toBeInstanceOf(UserDto);
      expect(sent.label()).toBe("user ~000~");
    });

    test("a record built with no prototype has its fields encoded", async () => {
      const record: { user_id: string } = Object.create(null);
      record.user_id = uuid1;
      const mockFn = vi.fn(async (_input: { user_id: string }) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      await wrapped(record);

      expect(mockFn.mock.calls[0][0].user_id).toBe("~000~");
    });

    test("a class instance in a result is decoded and keeps its prototype", async () => {
      class Answer {
        constructor(public note: string) {}
      }
      const mockFn = vi.fn(async () => new Answer("~000~"));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      const result = await wrapped({ id: uuid1 });

      expect(result.note).toBe(uuid1);
      expect(result).toBeInstanceOf(Answer);
    });

    test("a plain record beside it is still encoded", async () => {
      const handle = Object.create(null);
      const mockFn = vi.fn(async (_input: { img: unknown; meta: { id: string } }) => ({
        ok: true,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      await wrapped({ img: handle, meta: { id: uuid1 } });

      expect(mockFn.mock.calls[0][0]).toEqual({ img: handle, meta: { id: "~000~" } });
    });
  });

  describe("An identifier in an object key", () => {
    test.each([
      [
        "wrapBamlFunction",
        async (input: { byId: Record<string, string> }) => {
          const wrapped = wrapBamlFunction(async (i: typeof input) => i, {
            config: defaultConfig,
          });
          return wrapped(input);
        },
      ],
      [
        "wrapBamlStreamingFunction",
        async (input: { byId: Record<string, string> }) => {
          const wrapped = wrapBamlStreamingFunction(
            // eslint-disable-next-line require-yield
            async function* (i: typeof input) {
              return i;
            },
            { config: defaultConfig }
          );
          const iterator = wrapped(input);
          let step = await iterator.next();
          while (!step.done) step = await iterator.next();
          return step.value;
        },
      ],
      [
        "encodeObject",
        async (input: { byId: Record<string, string> }) =>
          encodeObject(input, defaultConfig).encoded,
      ],
    ])("%s leaves a key alone unless the caller asks", async (_label, run) => {
      // A rewritten field name calls the BAML function with an object its class does not
      // describe, so nothing at runtime can tell a map key from a class's own field
      const sent = await run({ byId: { [uuid1]: "active" } });

      expect(Object.keys((sent as { byId: Record<string, string> }).byId)).toEqual([uuid1]);
    });

    test("a map keyed by identifier is encoded when the caller asks", async () => {
      const mockFn = vi.fn(async (input: { byId: Record<string, string> }) => ({
        seen: Object.keys(input.byId).join(" "),
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig, encodeKeys: true });
      await wrapped({ byId: { [uuid1]: "active", [uuid2]: "idle" } });

      expect(mockFn).toHaveBeenCalledWith({ byId: { "~000~": "active", "~001~": "idle" } });
    });

    test("one identifier in a key and in a value shares a placeholder", async () => {
      const mockFn = vi.fn(async () => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig, encodeKeys: true });
      await wrapped({ byId: { [uuid1]: `owner ${uuid1}` } });

      expect(mockFn).toHaveBeenCalledWith({ byId: { "~000~": "owner ~000~" } });
    });

    test("a field name is left alone unless the caller asks for keys", async () => {
      // A custom format can match a class's own field names, and rewriting one calls the BAML
      // function with an object its class does not describe
      const mockFn = vi.fn(async () => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: /cust_[a-z0-9]+/g, outputFormat: "SafeNumeric" },
      });
      await wrapped({ cust_identifier: "cust_abc123", note: "hello" });

      expect(mockFn).toHaveBeenCalledWith({ cust_identifier: "~000~", note: "hello" });
    });

    test("an encoded key named __proto__ stays an own property", async () => {
      const mockFn = vi.fn(async (_input: Record<string, string>) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig, encodeKeys: true });
      await wrapped(JSON.parse('{"__proto__": "x", "note": "y"}'));

      const sent = mockFn.mock.calls[0][0];
      expect(Object.getOwnPropertyNames(sent)).toEqual(["__proto__", "note"]);
      expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
    });

    test.each([
      ["one identifier in two cases", { [uuid1]: "a", [uuid1.toUpperCase()]: "b" }],
      ["a key already shaped like the placeholder", { [uuid1]: "a", "~000~": "b" }],
      ["that key first", { "~000~": "b", [uuid1]: "a" }],
    ])("two keys that encode to one placeholder are refused: %s", async (_label, byId) => {
      const mockFn = vi.fn(async () => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig, encodeKeys: true });

      await expect(wrapped({ byId })).rejects.toThrow(/same placeholder/i);
    });

    test("an explicit encodeFields leaves keys alone, since a path names a value", async () => {
      const mockFn = vi.fn(async () => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeKeys: true,
        encodeFields: ["note"],
      });
      await wrapped({ byId: { [uuid1]: "active" }, note: `owner ${uuid1}` });

      expect(mockFn).toHaveBeenCalledWith({
        byId: { [uuid1]: "active" },
        note: "owner ~000~",
      });
    });
  });

  describe("A placeholder in an object key", () => {
    test("a result grouped by id is decoded in its keys", async () => {
      const mockFn = vi.fn(async (input: { ids: string }) => ({
        byId: { "~000~": "active", "~001~": "idle" },
        summary: `Both seen: ${input.ids}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });
      const result = await wrapped({ ids: `${uuid1} ${uuid2}` });

      expect(result.byId).toEqual({ [uuid1]: "active", [uuid2]: "idle" });
    });

    test("decodeObject restores a key as well as a value", () => {
      expect(decodeObject({ "~000~": "active" }, { "~000~": uuid1 })).toEqual({
        [uuid1]: "active",
      });
    });

    test("a decoded key named __proto__ stays an own property", () => {
      const decoded = decodeObject<Record<string, unknown>>(
        { "~000~": "value" },
        { "~000~": "__proto__" }
      );

      expect(Object.getOwnPropertyNames(decoded)).toEqual(["__proto__"]);
      expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    });

    test("two keys that decode to one identifier are refused", async () => {
      // The encode half refuses the mirror of this, and a model asked to group its answer can put
      // the identifier in one key and the placeholder it was handed in another
      // Both orders, because a guard on the raw key still refuses one of them
      for (const byId of [
        { "~000~": "a", [uuid1]: "b" },
        { [uuid1]: "b", "~000~": "a" },
      ]) {
        expect(() => decodeObject<Record<string, unknown>>(byId, { "~000~": uuid1 })).toThrow(
          /same identifier/i
        );
      }
    });

    test("a decoded key counts towards the debug total", async () => {
      const onDecode = vi.fn();
      const mockFn = vi.fn(async () => ({ byId: { "~000~": "active" } }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        debug: true,
        onDecode,
      });
      await wrapped({ id: uuid1 });

      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(1);
    });
  });

  describe("A core too old to serve this package", () => {
    // Every export this package uses exists on 0.1.4, so nothing fails to link and nothing reads
    // undefined. What changed in 0.2.0 is behaviour, so the probe has to be behavioural, and it
    // sits on every entrance a consumer can come through
    test.each([
      ["wrapBamlFunction", () => wrapBamlFunction(async () => ({}), { config: defaultConfig })],
      [
        "wrapBamlStreamingFunction",
        () =>
          wrapBamlStreamingFunction(
            // eslint-disable-next-line require-yield
            async function* (): AsyncGenerator<unknown, unknown, unknown> {
              return {};
            },
            { config: defaultConfig }
          ),
      ],
      ["encodeObject", () => encodeObject({ id: uuid1 }, defaultConfig)],
    ])("is refused by %s", async (_label, build) => {
      const core = await import("prompt-identifiers");
      const real = core.encode;
      Object.defineProperty(core, "encode", {
        value: (text: string, config: unknown, state?: unknown) =>
          real(text.toLowerCase(), config as never, state as never),
        configurable: true,
      });
      try {
        expect(build).toThrow(/prompt-identifiers 0\.2\.0 or later/);
      } finally {
        Object.defineProperty(core, "encode", { value: real, configurable: true });
      }
    });

    test("a current core is accepted", () => {
      expect(() => wrapBamlFunction(async () => ({}), { config: defaultConfig })).not.toThrow();
    });
  });

  describe("A BAML stream, which is not a generator", () => {
    // b.stream.<Fn>(input) returns a BamlStream: async iterable, no next, and its final value
    // behind getFinalResponse
    function bamlStream(partials: unknown[], final: unknown) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const partial of partials) yield partial;
        },
        async getFinalResponse() {
          return final;
        },
      };
    }

    test("its partials and its final response are both decoded", async () => {
      const wrapped = wrapBamlStreamingFunction(
        () =>
          bamlStream([{ text: "~000~ first" }, { text: "~000~ second" }], { text: "~000~ done" }),
        { config: defaultConfig }
      );

      const stream = wrapped({ id: uuid1 });
      const seen: unknown[] = [];
      for await (const partial of stream) seen.push(partial);

      expect(seen).toEqual([{ text: `${uuid1} first` }, { text: `${uuid1} second` }]);
      expect(await stream.getFinalResponse()).toEqual({ text: `${uuid1} done` });
    });

    test("its final response is reported to onDecode", async () => {
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => bamlStream([{ text: "~000~ first" }], { text: "~000~ done" }),
        { config: defaultConfig, debug: true, onDecode }
      );

      const stream = wrapped({ id: uuid1 });
      for await (const _partial of stream) void _partial;
      await stream.getFinalResponse();

      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(2);
    });

    test("a consumer that only iterates is told what was decoded", async () => {
      // The generator protocol hands the final value back at the end of the loop, so that branch
      // reports there. A stream keeps its final behind a second call, which a consumer that only
      // iterates never makes
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => bamlStream([{ text: "~000~ first" }], { text: "~000~ done" }),
        { config: defaultConfig, debug: true, onDecode }
      );

      for await (const _partial of wrapped({ id: uuid1 })) void _partial;

      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(2);
    });

    test("asking for the final response twice decodes and reports it once", async () => {
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(() => bamlStream([], { text: "~000~ done" }), {
        config: defaultConfig,
        debug: true,
        onDecode,
      });

      const stream = wrapped({ id: uuid1 });
      const first = await stream.getFinalResponse();
      const second = await stream.getFinalResponse();

      expect(second).toEqual(first);
      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(1);
    });

    test("a final response that throws still reaches the consumer that asked for it", async () => {
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("coercion failed");
          },
        }),
        { config: defaultConfig }
      );

      const stream = wrapped({ id: uuid1 });
      for await (const _partial of stream) void _partial;

      await expect(stream.getFinalResponse()).rejects.toThrow("coercion failed");
    });

    test("toStreamable writes decoded NDJSON", async () => {
      // The Next.js path. Forwarding the source's own would serialise the partials and the final
      // as the model wrote them, placeholders and all
      const wrapped = wrapBamlStreamingFunction(
        () => bamlStream([{ text: "~000~ first" }], { text: "~000~ done" }),
        { config: defaultConfig }
      );

      const body = await new Response(wrapped({ id: uuid1 }).toStreamable()).text();

      expect(
        body
          .trimEnd()
          .split("\n")
          .map((entry) => JSON.parse(entry))
      ).toEqual([{ partial: { text: `${uuid1} first` } }, { final: { text: `${uuid1} done` } }]);
    });

    test("a consumer that only iterates is told what was decoded even when the final fails", async () => {
      // A failed final is an ordinary end to a generation, so the partials already read still count
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("coercion failed");
          },
        }),
        { config: defaultConfig, debug: true, onDecode }
      );

      for await (const _partial of wrapped({ id: uuid1 })) void _partial;

      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(1);
      expect(onDecode.mock.calls[0][0].debugData.output).toEqual({ text: `${uuid1} first` });
    });

    test("a consumer that reads the stream twice is still told once", async () => {
      // A failed final is memoised as a rejection, so the second loop reaches the catch again and
      // the guard on the report is what holds it to one
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("coercion failed");
          },
        }),
        { config: defaultConfig, debug: true, onDecode }
      );

      const stream = wrapped({ id: uuid1 });
      for await (const _partial of stream) void _partial;
      for await (const _partial of stream) void _partial;

      expect(onDecode).toHaveBeenCalledTimes(1);
    });

    test.each([
      [
        "a stream",
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
            throw new Error("the model stopped");
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("the model stopped");
          },
        }),
      ],
      [
        "a generator",
        async function* (): AsyncGenerator<{ text: string }, { text: string }, unknown> {
          yield { text: "~000~ first" };
          throw new Error("the model stopped");
        },
      ],
    ])("%s that dies mid-iteration still reports what it decoded", async (_label, fn) => {
      // The client raises a validation error, a timeout and an abort from inside its own iterator,
      // so this is the ordinary shape of a failed generation rather than a corner
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        fn as BamlStreamFunction<{ id: string }, { text: string }, { text: string }>,
        { config: defaultConfig, debug: true, onDecode }
      );

      const seen: unknown[] = [];
      await expect(async () => {
        for await (const partial of wrapped({ id: uuid1 })) seen.push(partial);
      }).rejects.toThrow("the model stopped");

      expect(seen).toEqual([{ text: `${uuid1} first` }]);
      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(1);
    });

    test("a consumer holding the final's promise while it iterates is told what it read", async () => {
      // Asking for the final before the loop is an ordinary shape, and the rejection lands while
      // the partials are still being read: the report belongs to the consumer that read them
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
            await new Promise((resolve) => setTimeout(resolve, 10));
            yield { text: "~000~ second" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("the model stopped");
          },
        }),
        { config: defaultConfig, debug: true, onDecode }
      );

      const stream = wrapped({ id: uuid1 });
      const final = stream.getFinalResponse();
      // Held across the loop, so the rejection needs a handler before the loop awaits anything
      final.catch(() => {});
      for await (const _partial of stream) void _partial;
      await expect(final).rejects.toThrow("the model stopped");

      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode.mock.calls[0][0].debugData.decodedCount).toBe(2);
    });

    test("a final that rejects for a consumer that never iterated still reports", async () => {
      // The other door of the same case: the consumption ended, and it ended in an error
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("the model stopped");
          },
        }),
        { config: defaultConfig, debug: true, onDecode }
      );

      await expect(wrapped({ id: uuid1 }).getFinalResponse()).rejects.toThrow("the model stopped");

      expect(onDecode).toHaveBeenCalledTimes(1);
    });

    test.each([
      [
        "a stream",
        () => bamlStream([{ text: "~000~ first" }, { text: "~000~ second" }], { text: "done" }),
      ],
      [
        "a generator",
        async function* (): AsyncGenerator<{ text: string }, { text: string }, unknown> {
          yield { text: "~000~ first" };
          yield { text: "~000~ second" };
          return { text: "done" };
        },
      ],
    ])("a consumer that breaks out of %s early is not reported to", async (_label, fn) => {
      // Breaking returns the iterator rather than throwing through it, so it reaches neither the
      // catch that reports a failed generation nor the end of the loop
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        fn as BamlStreamFunction<{ id: string }, { text: string }, { text: string }>,
        { config: defaultConfig, debug: true, onDecode }
      );

      for await (const _partial of wrapped({ id: uuid1 })) break;

      expect(onDecode).not.toHaveBeenCalled();
    });

    test("the reported duration is decode time, not the model's latency", async () => {
      const onDecode = vi.fn();
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise((resolve) => setTimeout(resolve, 120));
            yield { text: "~000~ first" };
          },
          async getFinalResponse() {
            return { text: "~000~ done" };
          },
        }),
        { config: defaultConfig, debug: true, onDecode }
      );

      for await (const _partial of wrapped({ id: uuid1 })) void _partial;

      expect(onDecode.mock.calls[0][0].debugData.durationMs).toBeLessThan(100);
      expect(onDecode.mock.calls[0][0].debugData.durationMs).toBeGreaterThan(0);
    });

    test("an error frame carries what the error itself carries", async () => {
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {},
          async getFinalResponse(): Promise<{ text: string }> {
            throw Object.assign(new Error("failed to parse ~000~"), {
              type: "BamlValidationError",
              raw_output: "~000~ half",
            });
          },
        }),
        { config: defaultConfig }
      );

      const body = await new Response(wrapped({ id: uuid1 }).toStreamable()).text();

      // The frame is the reader's copy of what the model wrote, so it is decoded like everything
      // else the wrapper hands back
      expect(JSON.parse(body.trim())).toEqual({
        error: {
          type: "BamlValidationError",
          message: `failed to parse ${uuid1}`,
          prompt: "",
          raw_output: `${uuid1} half`,
        },
      });
    });

    test("toStreamable writes an error frame when the generation fails", async () => {
      // The error frame is the only signal a reader of the NDJSON gets that no answer is coming
      const wrapped = wrapBamlStreamingFunction(
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~ first" };
          },
          async getFinalResponse(): Promise<{ text: string }> {
            throw new Error("coercion failed");
          },
        }),
        { config: defaultConfig }
      );

      const body = await new Response(wrapped({ id: uuid1 }).toStreamable()).text();

      expect(
        body
          .trimEnd()
          .split("\n")
          .map((entry) => JSON.parse(entry))
      ).toEqual([
        { partial: { text: `${uuid1} first` } },
        { error: { type: "StreamError", message: "coercion failed", prompt: "", raw_output: "" } },
      ]);
    });

    test("its input is encoded the same way", async () => {
      const seen: unknown[] = [];
      const wrapped = wrapBamlStreamingFunction(
        (input: unknown) => {
          seen.push(input);
          return bamlStream([], {});
        },
        { config: defaultConfig }
      );

      const stream = wrapped({ id: uuid1 });
      for await (const _partial of stream) void _partial;

      expect(seen[0]).toEqual({ id: "~000~" });
    });
  });

  describe("A wrapped streaming function that returns something else", () => {
    // A consumer putting a step in front of the call writes `async (input) => { await
    // authorise(); return b.stream.F(input); }`, which hands back a promise, not the stream
    test.each([
      ["a promise", () => Promise.resolve({})],
      ["undefined", () => undefined],
      ["a string", () => "nope"],
      [
        "an async iterable with no final",
        () => ({
          async *[Symbol.asyncIterator]() {
            yield { text: "~000~" };
          },
        }),
      ],
    ])("%s is refused where the call is made", (_label, fn) => {
      // The types forbid every row, which is the point: this is the shape a JavaScript consumer
      // reaches the wrapper with
      const wrapped = wrapBamlStreamingFunction(
        fn as unknown as BamlStreamFunction<{ id: string }, unknown, unknown>,
        { config: defaultConfig }
      );

      expect(() => wrapped({ id: uuid1 })).toThrow(/returns the stream itself/);
    });
  });

  describe("A consumer that stops reading a stream early", () => {
    test("the wrapped generator is closed", async () => {
      let closed = false;
      async function* source() {
        try {
          yield { text: "~000~ first" };
          yield { text: "~000~ second" };
          return { text: "~000~ done" };
        } finally {
          closed = true;
        }
      }

      const wrapped = wrapBamlStreamingFunction(() => source(), { config: defaultConfig });

      for await (const partial of wrapped({ id: uuid1 })) {
        expect(partial.text).toBe(`${uuid1} first`);
        break;
      }

      expect(closed).toBe(true);
    });

    test("a consumer throwing inside the loop closes the generator", async () => {
      let closed = false;
      async function* source() {
        try {
          yield { text: "~000~ first" };
          return { text: "~000~ done" };
        } finally {
          closed = true;
        }
      }

      const wrapped = wrapBamlStreamingFunction(() => source(), { config: defaultConfig });

      await expect(
        (async () => {
          for await (const _partial of wrapped({ id: uuid1 })) {
            throw new Error("the consumer gave up");
          }
        })()
      ).rejects.toThrow("the consumer gave up");

      expect(closed).toBe(true);
    });

    test("a consumer holding the final and then breaking is still reported to", async () => {
      // Breaking stops one consumption. The promise the consumer is holding is another, and it
      // finishes on its own
      const onDecode = vi.fn();
      const source = {
        async *[Symbol.asyncIterator]() {
          yield { text: "~000~ first" };
          yield { text: "~000~ second" };
        },
        async getFinalResponse() {
          return { text: "~000~ done" };
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, {
        config: defaultConfig,
        onDecode,
      });
      const stream = wrapped({ id: uuid1 });
      const final = stream.getFinalResponse();

      for await (const _partial of stream) break;
      await final;

      expect(onDecode).toHaveBeenCalledTimes(1);
    });

    test("a consumer that breaks and then meets a rejecting final is still reported to", async () => {
      // Breaking returns the wrapper's generator and puts the loop count back, so the consumer
      // that asks afterwards is the only one left to answer for the error
      const onDecode = vi.fn();
      const source = {
        async *[Symbol.asyncIterator]() {
          yield { text: "~000~ first" };
          yield { text: "~000~ second" };
        },
        async getFinalResponse(): Promise<{ text: string }> {
          throw new Error("the generation failed");
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, {
        config: defaultConfig,
        onDecode,
      });
      const stream = wrapped({ id: uuid1 });

      for await (const _partial of stream) break;
      await expect(stream.getFinalResponse()).rejects.toThrow("the generation failed");

      expect(onDecode).toHaveBeenCalledTimes(1);
    });

    // The stream branch closes its source by a different mechanism: the generator branch calls
    // `return` on it in a finally, and this one leaves the for-await to close it when the
    // wrapper's own generator is returned
    test("a stream source is closed too", async () => {
      let closed = false;
      let finalAsked = false;
      const source = {
        async *[Symbol.asyncIterator]() {
          try {
            yield { text: "~000~ first" };
            yield { text: "~000~ second" };
          } finally {
            closed = true;
          }
        },
        async getFinalResponse() {
          finalAsked = true;
          return { text: "~000~ done" };
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, { config: defaultConfig });

      for await (const partial of wrapped({ id: uuid1 })) {
        expect(partial.text).toBe(`${uuid1} first`);
        break;
      }

      expect(closed).toBe(true);
      expect(finalAsked).toBe(false);
    });

    test("a consumer throwing inside the loop closes a stream source", async () => {
      let closed = false;
      const source = {
        async *[Symbol.asyncIterator]() {
          try {
            yield { text: "~000~ first" };
          } finally {
            closed = true;
          }
        },
        async getFinalResponse() {
          return { text: "~000~ done" };
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, { config: defaultConfig });

      await expect(
        (async () => {
          for await (const _partial of wrapped({ id: uuid1 })) {
            throw new Error("the consumer gave up");
          }
        })()
      ).rejects.toThrow("the consumer gave up");

      expect(closed).toBe(true);
    });
  });
  describe("A generation that fails with an error carrying the model's text", () => {
    // The shape the BAML client raises: `prompt` is the text the model was sent and `raw_output`
    // is the text it wrote back, both own and enumerable, so both hold this call's placeholders
    class ValidationError extends Error {
      prompt: string;
      raw_output: string;

      constructor(prompt: string, rawOutput: string, message: string) {
        super(message);
        this.name = "ValidationError";
        this.prompt = prompt;
        this.raw_output = rawOutput;
      }
    }

    function failing() {
      return new ValidationError(
        "Summarise ~000~",
        '{"owner": "~000~"}',
        "could not parse ~000~ out of the response"
      );
    }

    function expectDecoded(error: unknown) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.prompt).toBe(`Summarise ${uuid1}`);
      expect(validation.raw_output).toBe(`{"owner": "${uuid1}"}`);
      expect(validation.message).toBe(`could not parse ${uuid1} out of the response`);
    }

    test("a rejecting call hands back the identifiers it was given", async () => {
      const wrapped = wrapBamlFunction(
        async () => {
          throw failing();
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toSatisfy((error: unknown) => {
        expectDecoded(error);
        return true;
      });
    });

    test("a stream that dies mid-iteration hands back the identifiers it was given", async () => {
      const source = {
        async *[Symbol.asyncIterator]() {
          yield { text: "~000~ so far" };
          throw failing();
        },
        async getFinalResponse() {
          throw failing();
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, { config: defaultConfig });

      let caught: unknown;
      try {
        for await (const _partial of wrapped({ id: uuid1 })) {
          // read
        }
      } catch (error) {
        caught = error;
      }

      expectDecoded(caught);
    });

    test("a rejecting final hands back the identifiers it was given", async () => {
      const source = {
        async *[Symbol.asyncIterator]() {
          yield { text: "~000~ so far" };
        },
        async getFinalResponse() {
          throw failing();
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, { config: defaultConfig });

      await expect(wrapped({ id: uuid1 }).getFinalResponse()).rejects.toSatisfy(
        (error: unknown) => {
          expectDecoded(error);
          return true;
        }
      );
    });

    test("a generator that dies mid-iteration hands back the identifiers it was given", async () => {
      async function* source() {
        yield { text: "~000~ so far" };
        throw failing();
      }

      const wrapped = wrapBamlStreamingFunction(() => source(), { config: defaultConfig });

      let caught: unknown;
      try {
        for await (const _partial of wrapped({ id: uuid1 })) {
          // read
        }
      } catch (error) {
        caught = error;
      }

      expectDecoded(caught);
    });

    test("a thrown string is decoded too", async () => {
      const wrapped = wrapBamlFunction(
        async () => {
          throw "the model refused ~000~";
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toBe(`the model refused ${uuid1}`);
    });

    test("the NDJSON frame decodes an error that could not be written to", async () => {
      // A frozen error keeps its placeholders, so the frame the reader gets is the only place
      // left that can put the identifiers back for them
      const source = {
        async *[Symbol.asyncIterator]() {
          yield { text: "~000~ so far" };
          throw Object.freeze(failing());
        },
        async getFinalResponse(): Promise<{ text: string }> {
          throw Object.freeze(failing());
        },
      };

      const wrapped = wrapBamlStreamingFunction(() => source, { config: defaultConfig });
      const body = await new Response(wrapped({ id: uuid1 }).toStreamable()).text();
      const frame = body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((message) => message.error);

      expect(frame.error.raw_output).toBe(`{"owner": "${uuid1}"}`);
      expect(frame.error.prompt).toBe(`Summarise ${uuid1}`);
    });

    test("a field that is not a string is left alone", async () => {
      // decode() takes text. Handing it a number would throw in place of the failure the
      // consumer is waiting for
      class WithNumbers extends Error {
        status = 500;
        retries = 0;
        raw_output = '{"owner": "~000~"}';
      }

      const wrapped = wrapBamlFunction(
        async () => {
          throw new WithNumbers("failed on ~000~");
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toSatisfy((error: unknown) => {
        const withNumbers = error as WithNumbers;
        expect(withNumbers.status).toBe(500);
        expect(withNumbers.retries).toBe(0);
        expect(withNumbers.raw_output).toBe(`{"owner": "${uuid1}"}`);
        return true;
      });
    });

    test("a rejection that is not an object is handed on as it is", async () => {
      // Object.keys on null throws, and a rejected promise carrying nothing is an ordinary way
      // for a generation to end
      const wrapped = wrapBamlFunction(
        async () => {
          throw null;
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toBe(null);

      const numeric = wrapBamlFunction(
        async () => {
          throw 404;
        },
        { config: defaultConfig }
      );

      await expect(numeric({ id: uuid1 })).rejects.toBe(404);
    });

    test("the stack a consumer logs carries the identifiers too", async () => {
      // V8 builds the stack lazily off the message, so reading it before the decode would hand
      // back a string that never had a placeholder in it. Materialising it first is the test
      const wrapped = wrapBamlFunction(
        async () => {
          const error = failing();
          void error.stack;
          throw error;
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toSatisfy((error: unknown) => {
        expect((error as Error).stack).toContain(uuid1);
        expect((error as Error).stack).not.toContain("~000~");
        return true;
      });
    });

    test("an error that refuses to be written keeps its own text", async () => {
      const wrapped = wrapBamlFunction(
        async () => {
          throw Object.freeze(failing());
        },
        { config: defaultConfig }
      );

      await expect(wrapped({ id: uuid1 })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).raw_output).toBe('{"owner": "~000~"}');
        return true;
      });
    });
  });
  describe("A value that refers back to itself", () => {
    test("encoding names the cycle rather than running out of stack", () => {
      const input: Record<string, unknown> = { id: uuid1 };
      input.self = input;

      expect(() => encodeObject(input, defaultConfig)).toThrow(
        /circular structure.*BAML argument/i
      );
    });

    test("encoding names a cycle two hops away", () => {
      const parent: Record<string, unknown> = { id: uuid1 };
      const child: Record<string, unknown> = { parent };
      parent.child = child;

      expect(() => encodeObject(parent, defaultConfig)).toThrow(/circular structure/i);
    });

    test("decoding names the cycle rather than running out of stack", () => {
      const output: Record<string, unknown> = { id: "~000~" };
      output.self = output;

      expect(() => decodeObject(output, { "~000~": uuid1 })).toThrow(
        /circular structure.*BAML answer/i
      );
    });

    test("a wrapped call names the cycle it was handed", async () => {
      const input: Record<string, unknown> = { id: uuid1 };
      input.self = input;
      const wrapped = wrapBamlFunction(async () => ({ ok: true }), { config: defaultConfig });

      await expect(wrapped(input)).rejects.toThrow(/circular structure/i);
    });

    test("encoding names a cycle that closes through an array", () => {
      // The array branch runs before the object branch, so an array on the way round the loop is
      // the half of this that a guard sitting under the object branch never sees
      const list: unknown[] = [{ id: uuid1 }];
      list.push(list);

      expect(() => encodeObject({ list }, defaultConfig)).toThrow(/circular structure/i);
    });

    test("encoding names an array that holds itself", () => {
      const list: unknown[] = [];
      list[0] = list;

      expect(() => encodeObject({ list }, defaultConfig)).toThrow(/circular structure/i);
    });

    test("decoding names a cycle that closes through an array", () => {
      const list: unknown[] = [{ id: "~000~" }];
      list.push(list);

      expect(() => decodeObject({ list }, { "~000~": uuid1 })).toThrow(/circular structure/i);
    });

    test("the same array under two keys is not a cycle", () => {
      const shared = [{ id: uuid1 }];

      expect(encodeObject({ x: shared, y: shared }, defaultConfig).encoded).toEqual({
        x: [{ id: "~000~" }],
        y: [{ id: "~000~" }],
      });
    });

    test("the same array under two keys survives the decode too", () => {
      // The decode half has its own open set, so the encode half's pin says nothing about it
      const shared = [{ id: "~000~" }];

      expect(decodeObject({ x: shared, y: shared }, { "~000~": uuid1 })).toEqual({
        x: [{ id: uuid1 }],
        y: [{ id: uuid1 }],
      });
    });

    test("an array holding the same object twice decodes both", () => {
      const shared = { id: "~000~" };

      expect(decodeObject({ rows: [shared, shared] }, { "~000~": uuid1 })).toEqual({
        rows: [{ id: uuid1 }, { id: uuid1 }],
      });
    });

    test("the same object under two keys is not a cycle", () => {
      const shared = { id: uuid1 };

      const { encoded, mapping } = encodeObject({ x: shared, y: shared }, defaultConfig);

      expect(encoded).toEqual({ x: { id: "~000~" }, y: { id: "~000~" } });
      expect(mapping).toEqual({ "~000~": uuid1 });
    });

    test("the same object under two keys survives the decode too", () => {
      const shared = { id: "~000~" };

      expect(decodeObject({ x: shared, y: shared }, { "~000~": uuid1 })).toEqual({
        x: { id: uuid1 },
        y: { id: uuid1 },
      });
    });
  });
  describe("What a non-delimited format costs a key", () => {
    const withUuids = { alpha: 1, [uuid1]: 2, beta: 3, [uuid2]: 4 };

    test("an ordinary key spelled like a placeholder is refused", () => {
      expect(() =>
        encodeObject(
          { "0": "written by the caller", [uuid1]: "an identifier" },
          { inputFormat: "UUID", outputFormat: "IdToken" },
          undefined,
          true
        )
      ).toThrow(/Two keys encode to the same placeholder/);

      expect(() =>
        encodeObject(
          { "000": "written by the caller", [uuid1]: "an identifier" },
          { inputFormat: "UUID", outputFormat: "Numeric" },
          undefined,
          true
        )
      ).toThrow(/Two keys encode to the same placeholder/);
    });

    test("a delimited format needs the key written as a placeholder before it collides", () => {
      expect(() =>
        encodeObject(
          { "000": "written by the caller", [uuid1]: "an identifier" },
          defaultConfig,
          undefined,
          true
        )
      ).not.toThrow();
    });

    test("IdToken moves the key it encodes to the front, a delimited format does not", () => {
      // An IdToken placeholder for a low index is a canonical integer string, and an object orders
      // its integer-like keys first whatever order they were written in
      const idToken = encodeObject(
        withUuids,
        { inputFormat: "UUID", outputFormat: "IdToken" },
        undefined,
        true
      );
      expect(Object.keys(idToken.encoded)).toEqual(["0", "1", "alpha", "beta"]);

      const safe = encodeObject(withUuids, defaultConfig, undefined, true);
      expect(Object.keys(safe.encoded)).toEqual(["alpha", "~000~", "beta", "~001~"]);
    });
  });
});
