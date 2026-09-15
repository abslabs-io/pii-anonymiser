import {
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import { systemPrompt } from './prompt';
import type { TransformersJsModelId } from './types';

type DType = 'q4f16' | 'q4';
type Request =
  | {
      type: 'load';
      requestId: number;
      model: TransformersJsModelId;
      dtype: DType;
    }
  | { type: 'detect'; requestId: number; text: string }
  | { type: 'dispose'; requestId: number };

let generator: TextGenerationPipeline | null = null;
const stoppingCriteria = new InterruptableStoppingCriteria();

function post(requestId: number, message: Record<string, unknown>) {
  self.postMessage({ requestId, ...message });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'The Transformers.js worker failed.';
}

async function load(
  requestId: number,
  model: TransformersJsModelId,
  dtype: DType,
) {
  generator = await pipeline('text-generation', model, {
    device: 'webgpu',
    dtype,
    progress_callback: (progress) => {
      if (progress.status === 'progress_total') {
        post(requestId, {
          type: 'progress',
          progress: progress.progress / 100,
          text: `Downloading model files · ${(progress.loaded / 1_000_000).toFixed(0)} / ${(progress.total / 1_000_000).toFixed(0)} MB`,
        });
      } else if (progress.status === 'progress') {
        post(requestId, {
          type: 'progress',
          progress: progress.progress / 100,
          text: `Downloading ${progress.file}`,
        });
      }
    },
  });
  post(requestId, {
    type: 'progress',
    progress: 1,
    text: 'Compiling shaders and warming up the model…',
  });
  await generator('a', {
    max_new_tokens: 1,
    do_sample: false,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });
  post(requestId, { type: 'loaded' });
}

async function detect(requestId: number, text: string) {
  if (!generator) throw new Error('Load a model first.');
  stoppingCriteria.reset();
  let outputTokens = 0;
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: () => {},
    token_callback_function: () => {
      outputTokens++;
    },
  });
  const output = await generator(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ text }) },
    ],
    {
      max_new_tokens: 1024,
      do_sample: false,
      tokenizer_encode_kwargs: { enable_thinking: false },
      stopping_criteria: stoppingCriteria,
      streamer,
    },
  );
  const generated = output[0]?.generated_text;
  const assistant = Array.isArray(generated) ? generated.at(-1) : undefined;
  if (!assistant || assistant.role !== 'assistant')
    throw new Error('The model returned no assistant response.');
  post(requestId, {
    type: 'detected',
    rawContent: assistant.content,
    outputTokens,
    finishReason: outputTokens >= 1024 ? 'length' : 'stop',
  });
}

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === 'load')
        await load(request.requestId, request.model, request.dtype);
      if (request.type === 'detect')
        await detect(request.requestId, request.text);
      if (request.type === 'dispose') {
        stoppingCriteria.interrupt();
        await generator?.dispose();
        generator = null;
        post(request.requestId, { type: 'disposed' });
      }
    } catch (error) {
      post(request.requestId, { type: 'error', error: errorMessage(error) });
    }
  })();
});
