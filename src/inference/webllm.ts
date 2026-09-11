import {
  CreateWebWorkerMLCEngine,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { parseWebLlmEntities } from './webllm-response';
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

export class WebLlmDetector implements Detector {
  private worker: Worker | null = null;
  private engine: WebWorkerMLCEngine | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private busy = false;
  private generation = 0;
  private model: RuntimeModelId | null = null;
  private disposal: Promise<void> | null = null;
  private finishDisposal: (() => void) | null = null;
  private forceDisposal = false;

  // Worker termination alone leaves WebLLM RPC promises pending. Race them
  // against an explicit rejection for cancel, timeout, and worker failure.
  private async operation<T>(
    work: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    if (this.busy)
      throw new Error('Another model operation is already running.');
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          this.rejectPending = reject;
          timer = setTimeout(() => {
            // The RPC can still be executing after this wrapper times out.
            this.forceDisposal = true;
            reject(
              new Error(
                'The model timed out. Unload it and try again with a shorter passage.',
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.rejectPending = null;
      this.busy = false;
    }
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
        'WebGPU is unavailable. Try a current desktop Chrome or Edge browser with graphics acceleration enabled.',
      );
    // Match the adapter preference used by the pinned WebLLM runtime.
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (generation !== this.generation) throw new Error('Operation cancelled.');
    if (!adapter)
      throw new Error(
        'No WebGPU adapter is available. If this worked earlier, save any text you need, close other model tabs, and fully quit and reopen the browser. If it persists, check graphics acceleration and WebGPU status at chrome://gpu or edge://gpu. Model files can stay cached.',
      );
    const runtimeModel = (
      adapter.features.has('shader-f16')
        ? model
        : model.replace('q4f16', 'q4f32')
    ) as RuntimeModelId;
    const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onerror = () => {
      this.forceDisposal = true;
      this.rejectPending?.(
        new Error(
          'The inference worker stopped unexpectedly. Unload the model and try again.',
        ),
      );
    };
    try {
      const engine = await this.operation(
        () =>
          CreateWebWorkerMLCEngine(
            worker,
            runtimeModel,
            {
              initProgressCallback: onProgress,
              logLevel: 'SILENT',
            },
            { context_window_size: 4096 },
          ),
        10 * 60_000,
      );
      if (generation !== this.generation)
        throw new Error('Operation cancelled.');
      this.engine = engine;
      this.model = runtimeModel;
      return runtimeModel;
    } catch (error) {
      if (generation === this.generation) await this.dispose({ force: true });
      throw error;
    }
  }

  async detect(text: string) {
    if (!this.engine || !this.model) throw new Error('Load a model first.');
    if (!text.trim()) throw new Error('Enter some text first.');
    if (byteLength(text) > MAX_INPUT_BYTES)
      throw new Error(
        'This experiment accepts up to 2,000 UTF-8 bytes per passage. Try a shorter passage.',
      );
    const engine = this.engine;
    const model = this.model;
    const start = performance.now();
    const response = await this.operation(
      () =>
        engine.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify({ text }) },
          ],
          temperature: 0,
          max_tokens: 1024,
          stream: false,
          response_format: { type: 'json_object', schema: entitySchema },
          extra_body: { enable_thinking: false },
        }),
      120_000,
    );
    const choice = response.choices[0];
    const diagnostics = {
      model,
      rawContent: choice?.message.content ?? null,
      finishReason: choice?.finish_reason ?? null,
      durationMs: performance.now() - start,
      outputTokens: response.usage?.completion_tokens ?? null,
    };
    if (!choice || choice.finish_reason !== 'stop')
      throw new ModelResponseError(
        'The model did not finish its response. No output was produced. Inspect the response or try a shorter passage.',
        diagnostics,
      );
    let entities;
    try {
      entities = parseWebLlmEntities(diagnostics.rawContent ?? '');
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
    const engine = this.engine;
    const force = options?.force || this.busy || this.forceDisposal;
    this.forceDisposal = false;
    this.rejectPending?.(new Error('Operation cancelled.'));
    this.worker = null;
    this.engine = null;
    this.model = null;
    if (!worker) return;
    if (force || !engine) {
      // A busy worker cannot reliably service an unload RPC. Page exit also
      // cannot wait for asynchronous cleanup.
      worker.terminate();
      return;
    }
    // Give WebLLM a chance to destroy its GPU device explicitly. Always
    // terminate afterward, including when a lost device leaves unload pending.
    this.disposal = new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.terminate();
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      this.finishDisposal = finish;
      void Promise.resolve()
        .then(() => {
          if (!finished) return engine.unload();
        })
        .then(finish, finish);
    });
    try {
      await this.disposal;
    } finally {
      this.disposal = null;
      this.finishDisposal = null;
    }
  }
}
