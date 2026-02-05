import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import type { EncodeConfig } from 'prompt-identifiers';
import { promptIdentifiersMiddleware } from '../src/index';
import {
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
} from './test-helpers';

describe('prompt-identifiers-ai-sdk', () => {
  const defaultConfig: EncodeConfig = {
    inputFormat: 'UUID',
    outputFormat: 'SafeNumeric',
  };

  describe('promptIdentifiersMiddleware', () => {
    test('creates middleware with required hooks', () => {
      const middleware = promptIdentifiersMiddleware({ config: defaultConfig });

      expect(middleware.specificationVersion).toBe('v3');
      expect(middleware.transformParams).toBeDefined();
      expect(middleware.wrapGenerate).toBeDefined();
      expect(middleware.wrapStream).toBeDefined();
    });
  });

  describe('transformParams', () => {
    // Helper to extract user message text from prompt
    function getUserText(prompt: LanguageModelV3Message[], index = 0): string {
      const msg = prompt[index];
      if (msg.role === 'user') {
        const textPart = msg.content.find((p) => p.type === 'text');
        return textPart?.type === 'text' ? textPart.text : '';
      }
      return '';
    }

    // Helper to extract system message content
    function getSystemContent(prompt: LanguageModelV3Message[], index = 0): string {
      const msg = prompt[index];
      if (msg.role === 'system') {
        return typeof msg.content === 'string' ? msg.content : '';
      }
      return '';
    }

    test('encodes UUIDs in user message content', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000 in the database'),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getUserText(result.prompt)).toBe('Find user <000> in the database');
    });

    test('encodes UUIDs in system message content', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        systemMessage('User 123e4567-e89b-42d3-a456-426655440000 is an admin.'),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getSystemContent(result.prompt)).toBe('User <000> is an admin.');
    });

    test('encodes multiple UUIDs with deduplication', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = '123e4567-e89b-42d3-a456-426655440000';
      const uuid2 = '987fcdeb-51a2-43f7-8d9c-0123456789ab';

      const params = createParams([
        systemMessage(`User ${uuid1} is an admin.`),
        userMessage(`Compare ${uuid1} with ${uuid2}.`),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getSystemContent(result.prompt, 0)).toBe('User <000> is an admin.');
      expect(getUserText(result.prompt, 1)).toBe('Compare <000> with <001>.');
    });

    test('calls onEncode callback with mapping info', async () => {
      const onEncode = jest.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onEncode,
      });

      const params = createParams([
        userMessage('Find 123e4567-e89b-42d3-a456-426655440000 and 987fcdeb-51a2-43f7-8d9c-0123456789ab'),
      ]);

      await middleware.transformParams({ params, type: 'generate', model: mockModel });

      expect(onEncode).toHaveBeenCalledWith({
        mapping: expect.any(Object),
        encodedCount: 2,
      });
    });

    test('handles content with no IDs', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([userMessage('Hello, how are you?')]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getUserText(result.prompt)).toBe('Hello, how are you?');
    });
  });

  describe('wrapGenerate', () => {
    // Helper to create a mock generate result with proper V3 types
    function createMockGenerateResult(
      text: string
    ): LanguageModelV3GenerateResult {
      return {
        content: [{ type: 'text', text }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [], // V3 requires warnings array (can be empty)
      };
    }

    test('decodes placeholders in response content', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      // transformParams returns params with mapping attached
      const transformedParams = await middleware.transformParams({ params, type: 'generate', model: mockModel });

      const mockResult = createMockGenerateResult(
        'The user <000> was found in the database.'
      );

      const doGenerate = jest.fn().mockResolvedValue(mockResult);
      const doStream = jest.fn();

      const result = await middleware.wrapGenerate({
        doGenerate,
        doStream,
        params: transformedParams,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe(
        'The user 123e4567-e89b-42d3-a456-426655440000 was found in the database.'
      );
    });

    test('calls onDecode callback', async () => {
      const onDecode = jest.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onDecode,
      });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const transformedParams = await middleware.transformParams({ params, type: 'generate', model: mockModel });

      const mockResult = createMockGenerateResult('Found <000> in the system.');

      await middleware.wrapGenerate({
        doGenerate: jest.fn().mockResolvedValue(mockResult),
        doStream: jest.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(onDecode).toHaveBeenCalledWith({ decodedCount: 1 });
    });

    test('handles response with no placeholders', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const transformedParams = await middleware.transformParams({ params, type: 'generate', model: mockModel });

      const mockResult = createMockGenerateResult('No users found.');

      const result = await middleware.wrapGenerate({
        doGenerate: jest.fn().mockResolvedValue(mockResult),
        doStream: jest.fn(),
        params: transformedParams,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe('No users found.');
    });
  });

  describe('wrapStream', () => {
    // Helper to create stream result with proper V3 types
    function createMockStreamResult(
      parts: LanguageModelV3StreamPart[]
    ): LanguageModelV3StreamResult {
      return { stream: createMockStream(parts) };
    }

    test('decodes placeholders in streamed text', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const transformedParams = await middleware.transformParams({ params, type: 'stream', model: mockModel });

      const mockStreamResult = createMockStreamResult([
        { type: 'text-delta', id: '1', delta: 'Found user ' },
        { type: 'text-delta', id: '2', delta: '<000>' },
        { type: 'text-delta', id: '3', delta: ' in database.' },
      ]);
      const doStream = jest.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = jest.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params: transformedParams,
        model: mockModel,
      });

      const text = await collectStreamText(result.stream);
      expect(text).toBe('Found user 123e4567-e89b-42d3-a456-426655440000 in database.');
    });

    test('handles split placeholders across chunks', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const transformedParams = await middleware.transformParams({ params, type: 'stream', model: mockModel });

      // Simulate placeholder split across chunks: <0 | 00>
      const mockStreamResult = createMockStreamResult([
        { type: 'text-delta', id: '1', delta: 'User <0' },
        { type: 'text-delta', id: '2', delta: '00> found.' },
      ]);
      const doStream = jest.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = jest.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params: transformedParams,
        model: mockModel,
      });

      const text = await collectStreamText(result.stream);
      expect(text).toBe('User 123e4567-e89b-42d3-a456-426655440000 found.');
    });

    test('preserves non-text-delta stream parts', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        userMessage('Find user 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      await middleware.transformParams({ params, type: 'stream', model: mockModel });

      const mockStreamResult = createMockStreamResult([
        { type: 'text-delta', id: '1', delta: '<000>' },
        { type: 'text-end', id: '2' },
      ]);
      const doStream = jest.fn().mockResolvedValue(mockStreamResult);
      const doGenerate = jest.fn();

      const result = await middleware.wrapStream({
        doStream,
        doGenerate,
        params,
        model: mockModel,
      });

      const reader = result.stream.getReader();
      const parts: LanguageModelV3StreamPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts).toHaveLength(2);
      expect(parts[1].type).toBe('text-end');
    });
  });

  describe('Roundtrip encoding/decoding', () => {
    test('full roundtrip with multiple UUIDs', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = '123e4567-e89b-42d3-a456-426655440000';
      const uuid2 = '987fcdeb-51a2-43f7-8d9c-0123456789ab';

      const params = createParams([
        userMessage(`Compare user ${uuid1} with user ${uuid2}`),
      ]);

      // Transform params (encode)
      const encoded = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      // Access the encoded message content with proper type handling
      const encodedMsg = encoded.prompt[0];
      expect(encodedMsg.role).toBe('user');
      if (encodedMsg.role === 'user') {
        const textPart = encodedMsg.content.find((p) => p.type === 'text');
        expect(textPart?.type === 'text' && textPart.text).toBe('Compare user <000> with user <001>');
      }

      // Simulate LLM response with encoded IDs
      const mockResult: LanguageModelV3GenerateResult = {
        content: [{ type: 'text', text: 'User <000> has more activity than <001>. Recommending <000>.' }],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      // Wrap generate (decode) - use encoded params which has the mapping
      const result = await middleware.wrapGenerate({
        doGenerate: jest.fn().mockResolvedValue(mockResult),
        doStream: jest.fn(),
        params: encoded,
        model: mockModel,
      });

      expect(getTextFromContent(result.content)).toBe(
        `User ${uuid1} has more activity than ${uuid2}. Recommending ${uuid1}.`
      );
    });
  });

  describe('Tool result encoding', () => {
    // Helper to extract tool result output from encoded prompt
    function getToolResultOutput(prompt: LanguageModelV3Message[], index = 0): unknown {
      const msg = prompt[index];
      if (msg.role === 'tool') {
        const toolResult = msg.content.find((p) => p.type === 'tool-result');
        if (toolResult && 'output' in toolResult) {
          return (toolResult as { output: unknown }).output;
        }
      }
      return undefined;
    }

    test('encodes UUIDs in tool result with text output', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = '123e4567-e89b-42d3-a456-426655440000';
      const params = createParams([
        toolMessage('call-1', 'get_user', {
          type: 'text',
          value: `User ${uuid} found in database`,
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as { type: string; value: string };
      expect(output.type).toBe('text');
      expect(output.value).toBe('User <000> found in database');
    });

    test('encodes UUIDs in tool result with json output', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid1 = '123e4567-e89b-42d3-a456-426655440000';
      const uuid2 = '987fcdeb-51a2-43f7-8d9c-0123456789ab';
      const params = createParams([
        toolMessage('call-1', 'get_users', {
          type: 'json',
          value: {
            users: [
              { id: uuid1, name: 'Alice' },
              { id: uuid2, name: 'Bob' },
            ],
          },
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as { type: string; value: { users: Array<{ id: string; name: string }> } };
      expect(output.type).toBe('json');
      expect(output.value.users[0].id).toBe('<000>');
      expect(output.value.users[0].name).toBe('Alice');
      expect(output.value.users[1].id).toBe('<001>');
      expect(output.value.users[1].name).toBe('Bob');
    });

    test('encodes UUIDs in nested json structures', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = '123e4567-e89b-42d3-a456-426655440000';
      const params = createParams([
        toolMessage('call-1', 'get_data', {
          type: 'json',
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
        type: 'generate',
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as { type: string; value: { level1: { level2: { id: string } } } };
      expect(output.value.level1.level2.id).toBe('<000>');
    });

    test('handles tool result with no UUIDs', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        toolMessage('call-1', 'get_count', {
          type: 'json',
          value: { count: 42, status: 'ok' },
        }),
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      const output = getToolResultOutput(result.prompt) as { type: string; value: { count: number; status: string } };
      expect(output.value).toEqual({ count: 42, status: 'ok' });
    });

    test('deduplicates UUIDs across user messages and tool results', async () => {
      const onEncode = jest.fn();
      const middleware = createMiddleware({
        config: defaultConfig,
        onEncode,
      });

      const uuid = '123e4567-e89b-42d3-a456-426655440000';
      const params = createParams([
        userMessage(`Find user ${uuid}`),
        toolMessage('call-1', 'get_user', {
          type: 'text',
          value: `User ${uuid} found`,
        }),
      ]);

      await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      // Should only count as 1 unique UUID
      expect(onEncode).toHaveBeenCalledWith({
        mapping: expect.any(Object),
        encodedCount: 1,
      });
    });

    test('preserves non-tool-result parts in tool messages', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const params = createParams([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'test',
              output: { type: 'text', value: 'result' },
            },
          ],
        } as LanguageModelV3Message,
      ]);

      const result = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      const msg = result.prompt[0];
      expect(msg.role).toBe('tool');
    });
  });

  describe('Tool call input decoding', () => {
    test('decodes UUIDs in tool call input from wrapGenerate', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = '123e4567-e89b-42d3-a456-426655440000';
      const params = createParams([
        userMessage(`Create campaign for user ${uuid}`),
      ]);

      // First encode the prompt
      const transformedParams = await middleware.transformParams({ params, type: 'generate', model: mockModel });

      // Mock a generate result with a tool call containing encoded placeholder
      const mockResult: LanguageModelV3GenerateResult = {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'create_campaign',
            input: '{"user_id":"<000>","name":"Test Campaign"}',
          },
        ],
        finishReason: mockFinishReason(),
        usage: mockUsage(),
        warnings: [],
      };

      const result = await middleware.wrapGenerate({
        doGenerate: jest.fn().mockResolvedValue(mockResult),
        doStream: jest.fn(),
        params: transformedParams,
        model: mockModel,
      });

      // Tool call input should have decoded UUID
      const toolCall = result.content.find((c) => c.type === 'tool-call');
      expect(toolCall).toBeDefined();
      expect((toolCall as { input: string }).input).toBe(
        `{"user_id":"${uuid}","name":"Test Campaign"}`
      );
    });

    test('decodes UUIDs in tool call from wrapStream', async () => {
      const middleware = createMiddleware({ config: defaultConfig });

      const uuid = '123e4567-e89b-42d3-a456-426655440000';
      const params = createParams([
        userMessage(`Find user ${uuid}`),
      ]);

      const transformedParams = await middleware.transformParams({ params, type: 'stream', model: mockModel });

      // Mock stream with a tool-call chunk
      const mockStreamResult = {
        stream: createMockStream([
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_user',
            input: '{"id":"<000>"}',
          } as LanguageModelV3StreamPart,
        ]),
      };

      const result = await middleware.wrapStream({
        doStream: jest.fn().mockResolvedValue(mockStreamResult),
        doGenerate: jest.fn(),
        params: transformedParams,
        model: mockModel,
      });

      const reader = result.stream.getReader();
      const { value } = await reader.read();

      expect(value?.type).toBe('tool-call');
      expect((value as { input: string }).input).toBe(`{"id":"${uuid}"}`);
    });
  });

  describe('Different output formats', () => {
    // Helper to get user message text from encoded prompt
    function getUserMessageText(prompt: LanguageModelV3Message[]): string {
      const msg = prompt[0];
      if (msg.role === 'user') {
        const textPart = msg.content.find((p) => p.type === 'text');
        return textPart?.type === 'text' ? textPart.text : '';
      }
      return '';
    }

    test('works with Numeric format', async () => {
      const middleware = createMiddleware({
        config: { inputFormat: 'UUID', outputFormat: 'Numeric' },
      });

      const params = createParams([
        userMessage('Find 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const encoded = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe('Find 000');
    });

    test('works with custom template format', async () => {
      const middleware = createMiddleware({
        config: { inputFormat: 'UUID', outputFormat: { template: '[ID:{i}]' } },
      });

      const params = createParams([
        userMessage('Find 123e4567-e89b-42d3-a456-426655440000'),
      ]);

      const encoded = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe('Find [ID:0]');
    });

    test('works with ULID input format', async () => {
      const middleware = createMiddleware({
        config: { inputFormat: 'ULID', outputFormat: 'SafeNumeric' },
      });

      const params = createParams([
        userMessage('Find 01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      ]);

      const encoded = await middleware.transformParams({
        params,
        type: 'generate',
        model: mockModel,
      });

      expect(getUserMessageText(encoded.prompt)).toBe('Find <000>');
    });
  });
});
