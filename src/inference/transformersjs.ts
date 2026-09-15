import { parseTransformersJsEntities } from './transformersjs-response';
import {
  byteLength,
  MAX_INPUT_BYTES,
  ModelResponseError,
  type Detector,
  type ModelId,
  type Progress,
  type RuntimeModelId,
  type TransformersJsModelId,
} from './types';

type WorkerResponse = {
  requestId: number;
  type: 'progress' | 'loaded' | 'detected' | 'disposed' | 'error';
  progress?: number;
  text?: string;
  rawContent?: string;
  outputTokens?: number;
  finishReason?: string;
  error?: string;
};

type Pending = {
  requestId: number;
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: Progress) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class TransformersJsDetector implements Detector {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private busy = false;
  private generation = 0;
  private requestId = 0;
  private model: RuntimeModelId | null = null;
  private disposal: Promise<void> | null = null;
  private finishDisposal: (() => void) | null = null;
  private forceDisposal = false;

  private settle(
    requestId: number,
    outcome: { response: WorkerResponse } | { error: Error },
  ) {
    if (!this.pending || this.pending.requestId !== requestId) return;
    const pending = this.pending;
    this.pending = null;
    this.busy = false;
    clearTimeout(pending.timer);
    if ('response' in outcome) pending.resolve(outcome.response);
    else pending.reject(outcome.error);
  }

  private connect(worker: Worker) {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (
        message.type === 'progress' &&
        this.pending?.requestId === message.requestId
      ) {
        this.pending.onProgress?.({
          progress: message.progress ?? 0,
          text: message.text ?? 'Preparing model…',
        });
        return;
      }
      if (message.type === 'error') {
        this.settle(message.requestId, {
          error: new Error(
            message.error || 'The Transformers.js worker failed.',
          ),
        });
        return;
      }
      this.settle(message.requestId, { response: message });
    };
    worker.onerror = () => {
      this.forceDisposal = true;
      if (this.pending)
        this.settle(this.pending.requestId, {
          error: new Error(
            'The inference worker stopped unexpectedly. Unload the model and try again.',
          ),
        });
    };
  }

  private request(
    worker: Worker,
    message: Record<string, unknown>,
    timeoutMs: number,
    timeoutMessage: string,
    onProgress?: (progress: Progress) => void,
  ) {
    if (this.busy)
      return Promise.reject(
        new Error('Another model operation is already running.'),
      );
    this.busy = true;
    const requestId = ++this.requestId;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.forceDisposal = true;
        this.settle(requestId, { error: new Error(timeoutMessage) });
      }, timeoutMs);
      this.pending = { requestId, resolve, reject, onProgress, timer };
      worker.postMessage({ ...message, requestId });
    });
  }

  async load(model: ModelId, onProgress: (progress: Progress) => void) {
    const disposal = this.dispose();
    const generation = this.generation;
    await disposal;
    if (generation !== this.generation) throw new Error('Operation cancelled.');
    if (!window.isSecureContext)
      throw new Error(
        'WebGPU needs HTTPS or localhost. Open this app using a secure origin.',
      );
    if (!model.startsWith('onnx-community/'))
      throw new Error(
        'The selected model is not available through Transformers.js.',
      );
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter(options: {
            powerPreference: 'high-performance';
          }): Promise<{ features: Set<string> } | null>;
        };
      }
    ).gpu;
    if (!gpu)
      throw new Error(
        'WebGPU is unavailable. Try a current desktop browser with graphics acceleration enabled.',
      );
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (generation !== this.generation) throw new Error('Operation cancelled.');
    if (!adapter)
      throw new Error(
        'No WebGPU adapter is available. If this worked earlier, save any text you need, close other model tabs, and fully quit and reopen the browser. If it persists, check graphics acceleration and WebGPU status in your browser diagnostics. Model files can stay cached.',
      );
    const dtype = adapter.features.has('shader-f16') ? 'q4f16' : 'q4';
    const worker = new Worker(
      new URL('./transformersjs.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;
    this.connect(worker);
    try {
      await this.request(
        worker,
        {
          type: 'load',
          model: model as TransformersJsModelId,
          dtype,
        },
        10 * 60_000,
        'The model took too long to load. Cancel it and try again.',
        onProgress,
      );
      if (generation !== this.generation)
        throw new Error('Operation cancelled.');
      this.model = `${model as TransformersJsModelId}#${dtype}`;
      return this.model;
    } catch (error) {
      if (generation === this.generation) await this.dispose({ force: true });
      throw error;
    }
  }

  async detect(text: string) {
    if (!this.worker || !this.model) throw new Error('Load a model first.');
    if (!text.trim()) throw new Error('Enter some text first.');
    if (byteLength(text) > MAX_INPUT_BYTES)
      throw new Error(
        'This experiment accepts up to 2,000 UTF-8 bytes per passage. Try a shorter passage.',
      );
    const start = performance.now();
    const response = await this.request(
      this.worker,
      { type: 'detect', text },
      120_000,
      'The model timed out. Unload it and try again with a shorter passage.',
    );
    const diagnostics = {
      model: this.model,
      rawContent: response.rawContent ?? null,
      finishReason: response.finishReason ?? null,
      durationMs: performance.now() - start,
      outputTokens: response.outputTokens ?? null,
    };
    if (diagnostics.finishReason !== 'stop')
      throw new ModelResponseError(
        'The model did not finish its response. No output was produced. Inspect the response or try a shorter passage.',
        diagnostics,
      );
    let entities;
    try {
      entities = parseTransformersJsEntities(diagnostics.rawContent ?? '');
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
      outputTokens: diagnostics.outputTokens,
      diagnostics,
    };
  }

  async dispose(options?: { force?: boolean }) {
    this.generation++;
    if (this.disposal) {
      if (options?.force) this.finishDisposal?.();
      return this.disposal;
    }
    const worker = this.worker;
    const force = options?.force || this.busy || this.forceDisposal;
    this.forceDisposal = false;
    if (this.pending)
      this.settle(this.pending.requestId, {
        error: new Error('Operation cancelled.'),
      });
    this.worker = null;
    this.model = null;
    if (!worker) return;
    if (force) {
      worker.terminate();
      return;
    }
    this.disposal = new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (this.pending)
          this.settle(this.pending.requestId, {
            error: new Error('Operation cancelled.'),
          });
        worker.terminate();
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      this.finishDisposal = finish;
      void this.request(
        worker,
        { type: 'dispose' },
        2000,
        'Model cleanup timed out.',
      ).then(finish, finish);
    });
    try {
      await this.disposal;
    } finally {
      this.disposal = null;
      this.finishDisposal = null;
    }
  }
}
