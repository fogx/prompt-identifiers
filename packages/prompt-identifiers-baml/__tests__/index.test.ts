import {
  wrapBamlFunction,
  wrapBamlStreamingFunction,
  encodeObject,
  decodeObject,
  WrapBamlFunctionOptions,
} from '../src/index';
import type { EncodeConfig } from 'prompt-identifiers';

describe('prompt-identifiers-baml', () => {
  const defaultConfig: EncodeConfig = {
    inputFormat: 'UUIDv4',
    outputFormat: 'SafeNumeric',
  };

  const uuid1 = '123e4567-e89b-42d3-a456-426655440000';
  const uuid2 = '987fcdeb-51a2-43f7-8d9c-0123456789ab';

  describe('wrapBamlFunction', () => {
    test('encodes UUIDs in input and decodes in output', async () => {
      // Mock BAML function that echoes input in output
      const mockFn = jest.fn(async (input: { user_id: string }) => ({
        summary: `Analysis for user ${input.user_id}`,
        user_id: input.user_id,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ user_id: uuid1 });

      // Verify mock was called with encoded input
      expect(mockFn).toHaveBeenCalledWith({ user_id: '<000>' });

      // Verify output is decoded
      expect(result.summary).toBe(`Analysis for user ${uuid1}`);
      expect(result.user_id).toBe(uuid1);
    });

    test('handles nested objects', async () => {
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

      const mockFn = jest.fn(async (input: Input): Promise<Output> => ({
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
            name: 'John',
          },
        },
      });

      // Verify encoding
      expect(mockFn).toHaveBeenCalledWith({
        data: {
          user: {
            id: '<000>',
            name: 'John',
          },
        },
      });

      // Verify decoding
      expect(result.result.user_id).toBe(uuid1);
      expect(result.result.message).toBe(`Hello John, your ID is ${uuid1}`);
    });

    test('handles arrays of objects', async () => {
      interface Input {
        items: Array<{ id: string; name: string }>;
      }

      const mockFn = jest.fn(async (input: Input) => ({
        processed: input.items.map((item) => `${item.id}: ${item.name}`),
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({
        items: [
          { id: uuid1, name: 'Item 1' },
          { id: uuid2, name: 'Item 2' },
        ],
      });

      // Verify encoding
      expect(mockFn).toHaveBeenCalledWith({
        items: [
          { id: '<000>', name: 'Item 1' },
          { id: '<001>', name: 'Item 2' },
        ],
      });

      // Verify decoding
      expect(result.processed).toEqual([`${uuid1}: Item 1`, `${uuid2}: Item 2`]);
    });

    test('deduplicates repeated UUIDs', async () => {
      const mockFn = jest.fn(async (input: { ids: string[] }) => ({
        summary: input.ids.join(', '),
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({
        ids: [uuid1, uuid2, uuid1], // uuid1 appears twice
      });

      // Verify encoding uses same placeholder for duplicate
      expect(mockFn).toHaveBeenCalledWith({
        ids: ['<000>', '<001>', '<000>'],
      });

      // Verify decoding
      expect(result.summary).toBe(`${uuid1}, ${uuid2}, ${uuid1}`);
    });

    test('calls onEncode and onDecode callbacks', async () => {
      const onEncode = jest.fn();
      const onDecode = jest.fn();

      const mockFn = jest.fn(async (input: { id: string }) => ({
        result: `Found: ${input.id}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        onEncode,
        onDecode,
      });

      await wrapped({ id: uuid1 });

      expect(onEncode).toHaveBeenCalledWith({
        mapping: { '<000>': uuid1 },
        encodedCount: 1,
      });

      expect(onDecode).toHaveBeenCalledWith({ decodedCount: 1 });
    });

    test('handles null and undefined values', async () => {
      interface Input {
        id: string;
        optional?: string | null;
      }

      const mockFn = jest.fn(async (input: Input) => ({
        id: input.id,
        optional: input.optional,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ id: uuid1, optional: null });

      expect(mockFn).toHaveBeenCalledWith({ id: '<000>', optional: null });
      expect(result.id).toBe(uuid1);
      expect(result.optional).toBeNull();
    });

    test('preserves non-string primitives', async () => {
      interface Input {
        id: string;
        count: number;
        active: boolean;
      }

      const mockFn = jest.fn(async (input: Input) => ({
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

  describe('encodeFields option', () => {
    test('only encodes specified top-level fields', async () => {
      const mockFn = jest.fn(async (input: { user_id: string; code: string }) => ({
        result: `${input.user_id} - ${input.code}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ['user_id'], // Only encode user_id, not code
      });

      // code looks like a UUID but shouldn't be encoded
      const codeUuid = '11111111-1111-4111-8111-111111111111';

      await wrapped({ user_id: uuid1, code: codeUuid });

      expect(mockFn).toHaveBeenCalledWith({
        user_id: '<000>',
        code: codeUuid, // Not encoded
      });
    });

    test('encodes nested fields with dot notation', async () => {
      interface Input {
        data: {
          user_id: string;
          other_id: string;
        };
      }

      const mockFn = jest.fn(async (input: Input) => ({
        result: input.data.user_id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ['data.user_id'],
      });

      await wrapped({
        data: {
          user_id: uuid1,
          other_id: uuid2,
        },
      });

      expect(mockFn).toHaveBeenCalledWith({
        data: {
          user_id: '<000>',
          other_id: uuid2, // Not encoded
        },
      });
    });

    test('encodes array fields with [] wildcard', async () => {
      interface Input {
        items: Array<{ id: string; code: string }>;
      }

      const mockFn = jest.fn(async (input: Input) => ({
        ids: input.items.map((i) => i.id),
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ['items[].id'],
      });

      await wrapped({
        items: [
          { id: uuid1, code: 'ABC123' },
          { id: uuid2, code: 'DEF456' },
        ],
      });

      expect(mockFn).toHaveBeenCalledWith({
        items: [
          { id: '<000>', code: 'ABC123' },
          { id: '<001>', code: 'DEF456' },
        ],
      });
    });

    test('encodes deeply nested array fields', async () => {
      interface Input {
        data: {
          users: Array<{
            profile: {
              id: string;
            };
          }>;
        };
      }

      const mockFn = jest.fn(async (input: Input) => ({ ok: true }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: defaultConfig,
        encodeFields: ['data.users[].profile.id'],
      });

      await wrapped({
        data: {
          users: [{ profile: { id: uuid1 } }, { profile: { id: uuid2 } }],
        },
      });

      expect(mockFn).toHaveBeenCalledWith({
        data: {
          users: [{ profile: { id: '<000>' } }, { profile: { id: '<001>' } }],
        },
      });
    });
  });

  describe('wrapBamlStreamingFunction', () => {
    test('encodes input and decodes streaming output', async () => {
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

    test('calls callbacks for streaming function', async () => {
      const onEncode = jest.fn();
      const onDecode = jest.fn();

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
        mapping: { '<000>': uuid1 },
        encodedCount: 1,
      });

      expect(onDecode).toHaveBeenCalled();
    });
  });

  describe('encodeObject utility', () => {
    test('encodes object and returns mapping', () => {
      const { encoded, mapping } = encodeObject(
        {
          user_id: uuid1,
          data: { owner: uuid2 },
        },
        defaultConfig
      );

      expect(encoded).toEqual({
        user_id: '<000>',
        data: { owner: '<001>' },
      });

      expect(mapping).toEqual({
        '<000>': uuid1,
        '<001>': uuid2,
      });
    });

    test('respects encodeFields option', () => {
      const { encoded } = encodeObject(
        {
          user_id: uuid1,
          code: uuid2,
        },
        defaultConfig,
        ['user_id']
      );

      expect(encoded).toEqual({
        user_id: '<000>',
        code: uuid2, // Not encoded
      });
    });
  });

  describe('decodeObject utility', () => {
    test('decodes object with mapping', () => {
      const decoded = decodeObject(
        {
          user_id: '<000>',
          summary: 'User <000> is active',
        },
        { '<000>': uuid1 }
      );

      expect(decoded).toEqual({
        user_id: uuid1,
        summary: `User ${uuid1} is active`,
      });
    });

    test('handles nested structures', () => {
      const decoded = decodeObject(
        {
          data: {
            items: [{ id: '<000>' }, { id: '<001>' }],
          },
        },
        { '<000>': uuid1, '<001>': uuid2 }
      );

      expect(decoded).toEqual({
        data: {
          items: [{ id: uuid1 }, { id: uuid2 }],
        },
      });
    });
  });

  describe('Different output formats', () => {
    test('works with Numeric format', async () => {
      const mockFn = jest.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: 'UUIDv4', outputFormat: 'Numeric' },
      });

      await wrapped({ id: uuid1 });

      expect(mockFn).toHaveBeenCalledWith({ id: '000' });
    });

    test('works with custom template format', async () => {
      const mockFn = jest.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: 'UUIDv4', outputFormat: { template: '[ID:{i}]' } },
      });

      await wrapped({ id: uuid1 });

      expect(mockFn).toHaveBeenCalledWith({ id: '[ID:0]' });
    });

    test('works with ULID input format', async () => {
      const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

      const mockFn = jest.fn(async (input: { id: string }) => ({
        result: input.id,
      }));

      const wrapped = wrapBamlFunction(mockFn, {
        config: { inputFormat: 'ULID', outputFormat: 'SafeNumeric' },
      });

      const result = await wrapped({ id: ulid });

      expect(mockFn).toHaveBeenCalledWith({ id: '<000>' });
      expect(result.result).toBe(ulid.toLowerCase()); // ULIDs are normalized to lowercase
    });
  });

  describe('Edge cases', () => {
    test('handles empty objects', async () => {
      const mockFn = jest.fn(async (input: {}) => ({ result: 'ok' }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({});

      expect(result.result).toBe('ok');
    });

    test('handles input with no IDs', async () => {
      const mockFn = jest.fn(async (input: { name: string }) => ({
        greeting: `Hello, ${input.name}`,
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ name: 'Alice' });

      expect(mockFn).toHaveBeenCalledWith({ name: 'Alice' });
      expect(result.greeting).toBe('Hello, Alice');
    });

    test('handles output with no placeholders', async () => {
      const mockFn = jest.fn(async (input: { id: string }) => ({
        message: 'No IDs in response',
      }));

      const wrapped = wrapBamlFunction(mockFn, { config: defaultConfig });

      const result = await wrapped({ id: uuid1 });

      expect(result.message).toBe('No IDs in response');
    });
  });
});
