import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TransformersJsDetector } from './transformersjs';
import { ModelResponseError } from './types';

const small = 'onnx-community/Qwen3-0.6B-ONNX' as const;
const messages: Record<string, unknown>[] = [];
const terminate = vi.fn();
let holdLoad = false;
let holdDetect = false;
let rawContent = '{"entities":[]}';
let finishReason = 'stop';
let outputTokens = 5;

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  postMessage(message: Record<string, unknown>) {
    messages.push(message);
    const requestId = message.requestId as number;
    if (message.type === 'load' && !holdLoad)
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            requestId,
            type: 'progress',
            progress: 0.5,
            text: 'Downloading model files',
          },
        } as MessageEvent);
        this.onmessage?.({
          data: { requestId, type: 'loaded' },
        } as MessageEvent);
      });
    if (message.type === 'detect' && !holdDetect)
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            requestId,
            type: 'detected',
            rawContent,
            finishReason,
            outputTokens,
          },
        } as MessageEvent),
      );
    if (message.type === 'dispose')
      queueMicrotask(() =>
        this.onmessage?.({
          data: { requestId, type: 'disposed' },
        } as MessageEvent),
      );
  }

  terminate = terminate;
}

beforeEach(() => {
  vi.resetAllMocks();
  messages.length = 0;
  holdLoad = false;
  holdDetect = false;
  rawContent = '{"entities":[]}';
  finishReason = 'stop';
  outputTokens = 5;
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: vi
        .fn()
        .mockResolvedValue({ features: new Set(['shader-f16']) }),
    },
  });
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('loads the matching Qwen model as q4f16 in a worker', async () => {
  const progress = vi.fn();
  const detector = new TransformersJsDetector();

  await expect(detector.load(small, progress)).resolves.toBe(`${small}#q4f16`);

  expect(messages[0]).toMatchObject({
    type: 'load',
    model: small,
    dtype: 'q4f16',
  });
  expect(progress).toHaveBeenCalledWith({
    progress: 0.5,
    text: 'Downloading model files',
  });
  await detector.dispose();
  expect(messages.at(-1)).toMatchObject({ type: 'dispose' });
  expect(terminate).toHaveBeenCalledOnce();
});

it('uses the q4 compatibility export without shader-f16', async () => {
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter: vi.fn().mockResolvedValue({ features: new Set() }) },
  });
  const detector = new TransformersJsDetector();

  await expect(detector.load(small, () => {})).resolves.toBe(`${small}#q4`);
  expect(messages[0]).toMatchObject({ dtype: 'q4' });
  await detector.dispose();
});

it('parses strict JSON and preserves response diagnostics', async () => {
  rawContent = '{"entities":[{"text":"Alice","category":"PERSON"}]}';
  outputTokens = 12;
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});

  const detection = await detector.detect('Alice');

  expect(messages.find((message) => message.type === 'detect')).toMatchObject({
    type: 'detect',
    text: 'Alice',
  });
  expect(detection.entities).toEqual([{ text: 'Alice', category: 'PERSON' }]);
  expect(detection.diagnostics).toMatchObject({
    model: `${small}#q4f16`,
    rawContent,
    finishReason: 'stop',
    outputTokens: 12,
  });
  await detector.dispose();
});

it('accepts one exact JSON fence while preserving raw diagnostics', async () => {
  rawContent =
    '```json\n{"entities":[{"text":"Alice","category":"PERSON"}]}\n```';
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});

  const detection = await detector.detect('Alice');

  expect(detection.entities).toEqual([{ text: 'Alice', category: 'PERSON' }]);
  expect(detection.diagnostics.rawContent).toBe(rawContent);
  await detector.dispose();
});

it('rejects malformed or unfinished output with diagnostics', async () => {
  rawContent = '```json\n{"entities":[}\n```';
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});

  const malformed = await detector.detect('Alice').catch((error) => error);
  expect(malformed).toBeInstanceOf(ModelResponseError);
  expect(malformed).toMatchObject({
    message: expect.stringContaining('invalid JSON'),
    diagnostics: { rawContent },
  });

  rawContent = '{"entities":[';
  finishReason = 'length';
  outputTokens = 1024;
  const unfinished = await detector.detect('Alice').catch((error) => error);
  expect(unfinished).toBeInstanceOf(ModelResponseError);
  expect(unfinished).toMatchObject({
    message: expect.stringContaining('did not finish'),
    diagnostics: { finishReason: 'length', outputTokens: 1024 },
  });
  await detector.dispose();
});

it('rejects commentary, reasoning, and non-JSON Markdown fences', async () => {
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});

  for (const response of [
    'Here is the result:\n```json\n{"entities":[]}\n```',
    '<think>checking</think>\n{"entities":[]}',
    '```\n{"entities":[]}\n```',
  ]) {
    rawContent = response;
    await expect(detector.detect('Alice')).rejects.toBeInstanceOf(
      ModelResponseError,
    );
  }
  await detector.dispose();
});

it('cancels busy inference by terminating the worker', async () => {
  holdDetect = true;
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});
  const detection = detector.detect('Alice');
  const rejected = expect(detection).rejects.toThrow('cancelled');

  await detector.dispose();

  await rejected;
  expect(messages.some((message) => message.type === 'dispose')).toBe(false);
  expect(terminate).toHaveBeenCalledOnce();
});

it('rejects oversized input before sending it to the worker', async () => {
  const detector = new TransformersJsDetector();
  await detector.load(small, () => {});

  await expect(detector.detect('é'.repeat(1001))).rejects.toThrow('2,000');
  expect(messages.some((message) => message.type === 'detect')).toBe(false);
  await detector.dispose();
});

it('times out stalled generation and force-terminates on disposal', async () => {
  vi.useFakeTimers();
  holdDetect = true;
  const detector = new TransformersJsDetector();
  const loading = detector.load(small, () => {});
  await vi.runAllTicks();
  await loading;
  const pending = expect(detector.detect('Alice')).rejects.toThrow('timed out');

  await vi.advanceTimersByTimeAsync(120_001);
  await pending;
  await detector.dispose();
  expect(terminate).toHaveBeenCalledOnce();
});
