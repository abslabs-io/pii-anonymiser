import { parseGeminiNanoEntities } from './gemini-nano-response';
import { entitySchema, systemPrompt } from './prompt';
import {
  byteLength,
  MAX_INPUT_BYTES,
  ModelResponseError,
  type Detector,
  type ModelId,
  type Progress,
  type RuntimeModelId,
} from './types';

type Availability =
  'unavailable' | 'downloadable' | 'downloading' | 'available';

type DownloadProgressEvent = Event & { loaded: number };
type DownloadMonitor = {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: DownloadProgressEvent) => void,
  ): void;
};

type PromptOptions = {
  signal: AbortSignal;
  responseConstraint: object;
};

type LanguageModelSession = {
  prompt(input: string, options: PromptOptions): Promise<string>;
  clone(options: { signal: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
};

type SessionOptions = {
  expectedInputs: Array<{ type: 'text'; languages: ['en'] }>;
  expectedOutputs: Array<{ type: 'text'; languages: ['en'] }>;
};

type CreateOptions = SessionOptions & {
  initialPrompts: Array<{ role: 'system'; content: string }>;
  signal: AbortSignal;
  monitor(monitor: DownloadMonitor): void;
};

type LanguageModelFactory = {
  availability(options: SessionOptions): Promise<Availability>;
  create(options: CreateOptions): Promise<LanguageModelSession>;
};

const sessionOptions: SessionOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
const responseConstraint = JSON.parse(entitySchema) as object;
const runtimeModel: RuntimeModelId = 'gemini-nano@chrome-managed';

function languageModelFactory() {
  return (
    globalThis as typeof globalThis & {
      LanguageModel?: LanguageModelFactory;
    }
  ).LanguageModel;
}

export class GeminiNanoDetector implements Detector {
  private session: LanguageModelSession | null = null;
  private requestSession: LanguageModelSession | null = null;
  private controller: AbortController | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private busy = false;
  private generation = 0;

  private async operation<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    if (this.busy)
      throw new Error('Another model operation is already running.');
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise<never>((_, reject) => {
          this.rejectPending = reject;
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.controller = null;
      this.rejectPending = null;
      this.busy = false;
    }
  }

  async load(model: ModelId, onProgress: (progress: Progress) => void) {
    await this.dispose();
    const generation = this.generation;
    if (!window.isSecureContext)
      throw new Error(
        'Chrome built-in AI needs HTTPS or localhost. Open this app using a secure origin.',
      );
    if (model !== 'gemini-nano')
      throw new Error(
        'The selected model is not available through Chrome built-in AI.',
      );
    const factory = languageModelFactory();
    if (!factory)
      throw new Error(
        'The current LanguageModel API is unavailable. Use a supported current desktop Chrome release on an eligible device.',
      );

    try {
      const session = await this.operation(
        async (signal) => {
          const availability = await factory.availability(sessionOptions);
          if (generation !== this.generation)
            throw new Error('Operation cancelled.');
          if (availability === 'unavailable')
            throw new Error(
              'Gemini Nano is unavailable on this device. Current Chrome requires an eligible desktop system, sufficient memory and storage, and an unmetered connection for the initial download.',
            );
          onProgress({
            progress: availability === 'available' ? 1 : 0,
            text:
              availability === 'available'
                ? 'Starting the Chrome-managed model…'
                : 'Waiting for Chrome to download Gemini Nano…',
          });
          const session = await factory.create({
            ...sessionOptions,
            initialPrompts: [{ role: 'system', content: systemPrompt }],
            signal,
            monitor(monitor) {
              monitor.addEventListener('downloadprogress', (event) => {
                onProgress({
                  progress: event.loaded,
                  text:
                    event.loaded === 1
                      ? 'Download complete; preparing Gemini Nano…'
                      : `Downloading Gemini Nano · ${Math.round(event.loaded * 100)}%`,
                });
              });
            },
          });
          if (generation !== this.generation) {
            session.destroy();
            throw new Error('Operation cancelled.');
          }
          return session;
        },
        10 * 60_000,
        'Gemini Nano took too long to become ready. Cancel it and try again.',
      );
      if (generation !== this.generation) {
        session.destroy();
        throw new Error('Operation cancelled.');
      }
      this.session = session;
      return runtimeModel;
    } catch (error) {
      if (generation === this.generation) await this.dispose();
      throw error;
    }
  }

  async detect(text: string) {
    if (!this.session) throw new Error('Load a model first.');
    if (!text.trim()) throw new Error('Enter some text first.');
    if (byteLength(text) > MAX_INPUT_BYTES)
      throw new Error(
        'This experiment accepts up to 2,000 UTF-8 bytes per passage. Try a shorter passage.',
      );
    const baseSession = this.session;
    const start = performance.now();
    const rawContent = await this.operation(
      async (signal) => {
        const requestSession = await baseSession.clone({ signal });
        this.requestSession = requestSession;
        try {
          return await requestSession.prompt(JSON.stringify({ text }), {
            signal,
            responseConstraint,
          });
        } finally {
          if (this.requestSession === requestSession) {
            this.requestSession = null;
            requestSession.destroy();
          }
        }
      },
      120_000,
      'Gemini Nano timed out. Unload it and try again with a shorter passage.',
    );
    const diagnostics = {
      model: runtimeModel,
      rawContent,
      finishReason: null,
      durationMs: performance.now() - start,
      outputTokens: null,
    };
    let entities;
    try {
      entities = parseGeminiNanoEntities(rawContent);
    } catch (error) {
      throw new ModelResponseError(
        error instanceof Error
          ? error.message
          : 'The model response could not be parsed.',
        diagnostics,
      );
    }
    return {
      entities,
      durationMs: diagnostics.durationMs,
      outputTokens: null,
      diagnostics,
    };
  }

  async dispose() {
    this.generation++;
    this.controller?.abort();
    this.rejectPending?.(new Error('Operation cancelled.'));
    const requestSession = this.requestSession;
    const session = this.session;
    this.requestSession = null;
    this.session = null;
    requestSession?.destroy();
    session?.destroy();
  }
}
