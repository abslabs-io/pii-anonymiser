import type { Entity } from '../core/anonymise';

export type ModelId = 'Qwen3-0.6B-q4f16_1-MLC' | 'Qwen3-1.7B-q4f16_1-MLC';
export type RuntimeModelId =
  `Qwen3-${'0.6B' | '1.7B'}-q4${'f16' | 'f32'}_1-MLC`;
export const models: { id: ModelId; label: string; download: string }[] = [
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 · 0.6B', download: '~352 MB' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 · 1.7B', download: '~984 MB' },
];
export const MAX_INPUT_BYTES = 2000;
export const WEBLLM_VERSION = '0.2.82';
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
