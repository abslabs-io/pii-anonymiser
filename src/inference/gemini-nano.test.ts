import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeminiNanoDetector } from './gemini-nano';
import { systemPrompt } from './prompt';
import { ModelResponseError } from './types';

const baseDestroy = vi.fn();
const requestDestroy = vi.fn();
const clone = vi.fn();
const prompt = vi.fn();
const availability = vi.fn();
const create = vi.fn();
let downloadListener: ((event: Event & { loaded: number }) => void) | null;

const requestSession = { prompt, clone: vi.fn(), destroy: requestDestroy };
const baseSession = { prompt: vi.fn(), clone, destroy: baseDestroy };

beforeEach(() => {
  vi.resetAllMocks();
  downloadListener = null;
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('LanguageModel', { availability, create });
  availability.mockResolvedValue('available');
  create.mockImplementation(async (options) => {
    options.monitor({
      addEventListener: (_type: string, listener: typeof downloadListener) => {
        downloadListener = listener;
      },
    });
    return baseSession;
  });
  clone.mockResolvedValue(requestSession);
  prompt.mockResolvedValue('{"entities":[]}');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('checks availability and creates a Chrome-managed session on demand', async () => {
  const progress = vi.fn();
  availability.mockResolvedValue('downloadable');
  const detector = new GeminiNanoDetector();

  await expect(detector.load('gemini-nano', progress)).resolves.toBe(
    'gemini-nano@chrome-managed',
  );

  expect(availability).toHaveBeenCalledWith({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  const options = create.mock.calls[0][0];
  expect(options.initialPrompts).toEqual([
    { role: 'system', content: systemPrompt },
  ]);
  downloadListener?.({ loaded: 0.42 } as Event & { loaded: number });
  expect(progress).toHaveBeenLastCalledWith({
    progress: 0.42,
    text: 'Downloading Gemini Nano · 42%',
  });
  await detector.dispose();
  expect(baseDestroy).toHaveBeenCalledOnce();
});

it('uses a clean clone and the entity JSON Schema for every detection', async () => {
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});

  await detector.detect('First passage');
  await detector.detect('Second passage');

  expect(clone).toHaveBeenCalledTimes(2);
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(prompt.mock.calls[1][0]).toBe('{"text":"Second passage"}');
  expect(prompt.mock.calls[1][1].responseConstraint).toMatchObject({
    type: 'object',
    required: ['entities'],
  });
  expect(requestDestroy).toHaveBeenCalledTimes(2);
  expect(baseSession.prompt).not.toHaveBeenCalled();
  await detector.dispose();
});

it('parses strict JSON and records only diagnostics exposed by Chrome', async () => {
  const rawContent = '{"entities":[{"text":"Alice","category":"PERSON"}]}';
  prompt.mockResolvedValue(rawContent);
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});

  const detection = await detector.detect('Alice');

  expect(detection.entities).toEqual([{ text: 'Alice', category: 'PERSON' }]);
  expect(detection.diagnostics).toMatchObject({
    model: 'gemini-nano@chrome-managed',
    rawContent,
    finishReason: null,
    outputTokens: null,
  });
  expect(detection.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  await detector.dispose();
});

it('rejects invalid output while retaining the raw response', async () => {
  const rawContent = '```json\n{"entities":[]}\n```';
  prompt.mockResolvedValue(rawContent);
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});

  const caught = await detector.detect('Alice').catch((error) => error);

  expect(caught).toBeInstanceOf(ModelResponseError);
  expect(caught).toMatchObject({
    message: expect.stringContaining('invalid JSON'),
    diagnostics: { rawContent, finishReason: null, outputTokens: null },
  });
  await detector.dispose();
});

it('reports an ineligible device without creating a session', async () => {
  availability.mockResolvedValue('unavailable');
  const detector = new GeminiNanoDetector();

  await expect(detector.load('gemini-nano', () => {})).rejects.toThrow(
    'unavailable on this device',
  );
  expect(create).not.toHaveBeenCalled();
});

it('destroys a session if creation resolves after cancellation', async () => {
  let resolveCreate!: (session: typeof baseSession) => void;
  create.mockReturnValue(
    new Promise((resolve) => {
      resolveCreate = resolve;
    }),
  );
  const detector = new GeminiNanoDetector();
  const loading = detector.load('gemini-nano', () => {});
  const rejected = expect(loading).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

  await detector.dispose();
  resolveCreate(baseSession);

  await rejected;
  await vi.waitFor(() => expect(baseDestroy).toHaveBeenCalledOnce());
});

it('cancels an active prompt and destroys both sessions', async () => {
  prompt.mockReturnValue(new Promise(() => {}));
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});
  const detection = detector.detect('Alice');
  const rejected = expect(detection).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

  await detector.dispose();

  await rejected;
  expect(requestDestroy).toHaveBeenCalledOnce();
  expect(baseDestroy).toHaveBeenCalledOnce();
});

it('rejects oversized input before cloning a session', async () => {
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});

  await expect(detector.detect('é'.repeat(1001))).rejects.toThrow('2,000');
  expect(clone).not.toHaveBeenCalled();
  await detector.dispose();
});

it('times out a stalled prompt and releases it on disposal', async () => {
  vi.useFakeTimers();
  prompt.mockReturnValue(new Promise(() => {}));
  const detector = new GeminiNanoDetector();
  await detector.load('gemini-nano', () => {});
  const pending = expect(detector.detect('Alice')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120_001);

  await pending;
  await detector.dispose();
  expect(requestDestroy).toHaveBeenCalledOnce();
  expect(baseDestroy).toHaveBeenCalledOnce();
});
