import type { Entity } from '../core/anonymise';

export type WebLlmModelId = 'Qwen3-0.6B-q4f16_1-MLC' | 'Qwen3-1.7B-q4f16_1-MLC';
export type TransformersJsModelId =
  'onnx-community/Qwen3-0.6B-ONNX' | 'onnx-community/Qwen3-1.7B-ONNX';
export type ModelId = WebLlmModelId | TransformersJsModelId;
export type RuntimeModelId =
  | `Qwen3-${'0.6B' | '1.7B'}-q4${'f16' | 'f32'}_1-MLC`
  | `${TransformersJsModelId}#${'q4f16' | 'q4'}`;
export type ModelOption = {
  id: ModelId;
  label: string;
  download: string;
};
export const webLlmModels: ModelOption[] = [
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 · 0.6B', download: '~352 MB' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 · 1.7B', download: '~984 MB' },
];
export const transformersJsModels: ModelOption[] = [
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 · 0.6B',
    download: '~570 MB',
  },
  {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    label: 'Qwen3 · 1.7B',
    download: '~1.43 GB',
  },
];
export const MAX_INPUT_BYTES = 2000;
export const WEBLLM_VERSION = '0.2.82';
export const TRANSFORMERS_JS_VERSION = '4.2.0';
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;
export type Progress = { progress: number; text: string };
export type ResponseDiagnostics = {
  model: RuntimeModelId;
  rawContent: string | null;
  finishReason: string | null;
  durationMs: number;
  outputTokens: number | null;
};

// In-memory response evidence, never a console log or a successful result.
export class ModelResponseError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ResponseDiagnostics,
  ) {
    super(message);
    this.name = 'ModelResponseError';
  }
}

export type Detection = {
  entities: Entity[];
  durationMs: number;
  outputTokens: number | null;
  diagnostics: ResponseDiagnostics;
};
export interface Detector {
  load(
    model: ModelId,
    onProgress: (progress: Progress) => void,
  ): Promise<RuntimeModelId>;
  detect(text: string): Promise<Detection>;
  dispose(options?: { force?: boolean }): Promise<void>;
}
