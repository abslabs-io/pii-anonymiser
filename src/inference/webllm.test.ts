import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebLlmDetector } from './webllm';
import { systemPrompt } from './prompt';
import { ModelResponseError } from './types';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  complete: vi.fn(),
  unload: vi.fn(),
  terminate: vi.fn(),
  workerCreated: vi.fn(),
}));
vi.mock('@mlc-ai/web-llm', () => ({ CreateWebWorkerMLCEngine: mocks.create }));

const small = 'Qwen3-0.6B-q4f16_1-MLC' as const;
const report = () => {};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: vi
        .fn()
        .mockResolvedValue({ features: new Set(['shader-f16']) }),
    },
  });
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        mocks.workerCreated();
      }

      terminate = mocks.terminate;
      onerror: unknown;
    },
  );
  mocks.create.mockResolvedValue({
    chat: { completions: { create: mocks.complete } },
    unload: mocks.unload,
  });
  mocks.complete.mockResolvedValue({
    choices: [
      { finish_reason: 'stop', message: { content: '{"entities":[]}' } },
    ],
    usage: { completion_tokens: 5 },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('keeps the same model size when selecting a compatible float32 export', async () => {
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter: vi.fn().mockResolvedValue({ features: new Set() }) },
  });
  const detector = new WebLlmDetector();
  expect(await detector.load(small, report)).toBe('Qwen3-0.6B-q4f32_1-MLC');
  await detector.dispose();
  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('requests a high-performance adapter before creating the worker', async () => {
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const requestAdapter = (
    navigator as Navigator & {
      gpu: { requestAdapter: ReturnType<typeof vi.fn> };
    }
  ).gpu.requestAdapter;
  expect(requestAdapter).toHaveBeenCalledWith({
    powerPreference: 'high-performance',
  });
  expect(mocks.workerCreated).toHaveBeenCalledOnce();
  await detector.dispose();
});

it('guides the user when no adapter is available without creating a worker', async () => {
  const requestAdapter = vi.fn().mockResolvedValue(null);
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  const detector = new WebLlmDetector();

  await expect(detector.load(small, report)).rejects.toThrow(
    /restart|chrome:\/\/gpu|edge:\/\/gpu/i,
  );
  expect(requestAdapter).toHaveBeenCalledWith({
    powerPreference: 'high-performance',
  });
  expect(mocks.workerCreated).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('unloads an idle engine before terminating its worker', async () => {
  const order: string[] = [];
  mocks.unload.mockImplementation(async () => {
    order.push('unload-start');
    await Promise.resolve();
    order.push('unload-end');
  });
  mocks.terminate.mockImplementation(() => order.push('terminate'));
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  await detector.dispose();

  expect(order).toEqual(['unload-start', 'unload-end', 'terminate']);
  expect(mocks.unload).toHaveBeenCalledOnce();
  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('falls back to worker termination when engine unload rejects', async () => {
  mocks.unload.mockRejectedValue(new Error('unload failed'));
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  await expect(detector.dispose()).resolves.toBeUndefined();

  expect(mocks.unload).toHaveBeenCalledOnce();
  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('falls back to worker termination when engine unload misses its deadline', async () => {
  vi.useFakeTimers();
  mocks.unload.mockReturnValue(new Promise(() => {}));
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const disposing = detector.dispose();
  await vi.waitFor(() => expect(mocks.unload).toHaveBeenCalledOnce());
  expect(mocks.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_001);
  await disposing;

  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('makes a pending disposal idempotent', async () => {
  let resolveUnload!: () => void;
  mocks.unload.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveUnload = resolve;
    }),
  );
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const first = detector.dispose();
  const second = detector.dispose();
  await vi.waitFor(() => expect(mocks.unload).toHaveBeenCalledOnce());
  expect(mocks.terminate).not.toHaveBeenCalled();
  resolveUnload();
  await Promise.all([first, second]);

  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('force-finishes an idle disposal without waiting for engine unload', async () => {
  let resolveUnload!: () => void;
  mocks.unload.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveUnload = resolve;
    }),
  );
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const disposing = detector.dispose();
  await vi.waitFor(() => expect(mocks.unload).toHaveBeenCalledOnce());
  await detector.dispose({ force: true });

  expect(mocks.terminate).toHaveBeenCalledOnce();
  resolveUnload();
  await disposing;
  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('cancels busy work without attempting engine unload', async () => {
  mocks.complete.mockReturnValue(new Promise(() => {}));
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const detection = detector.detect('Alice');
  await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());

  await detector.dispose();

  await expect(detection).rejects.toThrow('cancelled');
  expect(mocks.unload).not.toHaveBeenCalled();
  expect(mocks.terminate).toHaveBeenCalledOnce();
});

it('waits for a pending disposal before creating another worker', async () => {
  let resolveUnload!: () => void;
  mocks.unload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveUnload = resolve;
    }),
  );
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const disposing = detector.dispose();
  const loading = detector.load(small, report);

  await vi.waitFor(() => expect(mocks.unload).toHaveBeenCalledOnce());
  await Promise.resolve();
  expect(mocks.create).toHaveBeenCalledOnce();
  resolveUnload();
  await disposing;
  await loading;

  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.workerCreated).toHaveBeenCalledTimes(2);
});

it('cancels a load waiting for cleanup without creating a worker', async () => {
  let resolveUnload!: () => void;
  mocks.unload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveUnload = resolve;
    }),
  );
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const disposing = detector.dispose();
  const loading = detector.load(small, report);
  await vi.waitFor(() => expect(mocks.unload).toHaveBeenCalledOnce());

  await detector.dispose();
  resolveUnload();
  await disposing;
  await expect(loading).rejects.toThrow('cancelled');
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('does not create a worker after cancellation while checking the adapter', async () => {
  let resolveAdapter!: (value: unknown) => void;
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: () =>
        new Promise((resolve) => {
          resolveAdapter = resolve;
        }),
    },
  });
  const detector = new WebLlmDetector();
  const loading = detector.load(small, report);
  await vi.waitFor(() => expect(resolveAdapter).toBeDefined());
  await detector.dispose();
  resolveAdapter({ features: new Set(['shader-f16']) });
  await expect(loading).rejects.toThrow('cancelled');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('settles a pending download promise when cancelled', async () => {
  mocks.create.mockReturnValue(new Promise(() => {}));
  const detector = new WebLlmDetector();
  const loading = detector.load(small, report);
  const rejected = expect(loading).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
  await detector.dispose();
  await rejected;
});

it('uses fresh messages, structured extraction, and disabled thinking', async () => {
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  await detector.detect('First passage');
  await detector.detect('Second passage');
  const request = mocks.complete.mock.calls[1][0];
  expect(request.messages).toEqual([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '{"text":"Second passage"}' },
  ]);
  expect(request.extra_body.enable_thinking).toBe(false);
  expect(JSON.parse(request.response_format.schema).required).toEqual([
    'entities',
  ]);
  await detector.dispose();
});

it('attaches response diagnostics to completed detections', async () => {
  mocks.complete.mockResolvedValue({
    choices: [
      {
        finish_reason: 'stop',
        message: { content: '{"entities":[]}' },
      },
    ],
    usage: { completion_tokens: 7 },
  });
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const detection = await detector.detect('Alice');

  expect(detection.diagnostics).toMatchObject({
    model: small,
    rawContent: '{"entities":[]}',
    finishReason: 'stop',
    outputTokens: 7,
  });
  expect(detection.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  await detector.dispose();
});

it('parses WebLLM empty-thinking prefix while preserving raw diagnostics', async () => {
  const rawContent =
    '<think>\n\n</think>\n\n{"entities":[{"text":"Alice","category":"PERSON"}]}';
  mocks.complete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: rawContent } }],
    usage: { completion_tokens: 12 },
  });
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const detection = await detector.detect('Alice');

  expect(detection.entities).toEqual([{ text: 'Alice', category: 'PERSON' }]);
  expect(detection.diagnostics.rawContent).toBe(rawContent);
  expect(detection.diagnostics.finishReason).toBe('stop');
  await detector.dispose();
});

it('rejects truncated generation instead of accepting partial detections', async () => {
  const rawContent = '<think>\n\n</think>\n\n{"entities":[';
  mocks.complete.mockResolvedValue({
    choices: [{ finish_reason: 'length', message: { content: rawContent } }],
  });
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const caught = await detector
    .detect('Alice')
    .catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(ModelResponseError);
  expect(caught).toMatchObject({
    message: expect.stringContaining('did not finish'),
    diagnostics: {
      model: small,
      rawContent,
      finishReason: 'length',
      outputTokens: null,
    },
  });
  await detector.dispose();
});

it('preserves raw response diagnostics when JSON parsing fails', async () => {
  const rawContent = '<img src=x onerror=alert(1)>'; // synthetic model output
  mocks.complete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: rawContent } }],
  });
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const caught = await detector
    .detect('Alice')
    .catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(ModelResponseError);
  expect(caught).toMatchObject({
    message: expect.stringContaining('invalid JSON'),
    diagnostics: {
      model: small,
      rawContent,
      finishReason: 'stop',
      outputTokens: null,
    },
  });
  await detector.dispose();
});

it('rejects nonempty thinking text instead of stripping arbitrary reasoning', async () => {
  const rawContent = '<think>the answer is Alice</think>\n\n{"entities":[]}';
  mocks.complete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: rawContent } }],
  });
  const detector = new WebLlmDetector();
  await detector.load(small, report);

  const caught = await detector
    .detect('Alice')
    .catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(ModelResponseError);
  expect(caught).toMatchObject({
    diagnostics: { rawContent, finishReason: 'stop' },
  });
  await detector.dispose();
});

it('rejects input beyond the byte limit before invoking inference', async () => {
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  await expect(detector.detect('é'.repeat(1001))).rejects.toThrow('2,000');
  expect(mocks.complete).not.toHaveBeenCalled();
  await detector.dispose();
});

it('rejects a concurrent generation and settles the first on cancellation', async () => {
  mocks.complete.mockReturnValue(new Promise(() => {}));
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const first = detector.detect('Alice');
  const rejected = expect(first).rejects.toThrow('cancelled');
  await expect(detector.detect('Bob')).rejects.toThrow('already running');
  await detector.dispose();
  await rejected;
});

it('times out a stalled generation', async () => {
  vi.useFakeTimers();
  mocks.complete.mockReturnValue(new Promise(() => {}));
  const detector = new WebLlmDetector();
  await detector.load(small, report);
  const pending = expect(detector.detect('Alice')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120_001);
  await pending;
  await detector.dispose();
  expect(mocks.unload).not.toHaveBeenCalled();
  expect(mocks.terminate).toHaveBeenCalledOnce();
});
