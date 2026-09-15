# Evidence index

This directory contains reviewed summaries of real browser-model runs. Raw app exports are not committed because they can contain user-entered workbench text; the checked-in summaries contain only invented fixtures.

## Current comparison: fixture set v2

| Technology path                | Reviewed evidence                                                                          | End-to-end F1 | Notes                              |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------: | ---------------------------------- |
| Gemini Nano, Chrome Prompt API | [Gemini Nano v2](fixture-v2/2026-09-15-gemini-nano-fixture-v2.json)                        |         71.2% | 26/30 correct, 4 missed, 17 extra  |
| Qwen3-1.7B, WebLLM             | [WebLLM 1.7B v2](fixture-v2/2026-09-15-qwen3-1.7b-webllm-fixture-v2.json)                  |         52.8% | 19/30 correct, 11 missed, 23 extra |
| Qwen3-0.6B, WebLLM             | [WebLLM 0.6B v2](fixture-v2/2026-09-15-qwen3-0.6b-webllm-fixture-v2.json)                  |         45.3% | 17/30 correct, 13 missed, 28 extra |
| Qwen3-0.6B, Transformers.js    | [Transformers.js 0.6B v2](fixture-v2/2026-09-15-qwen3-0.6b-transformersjs-fixture-v2.json) |         15.4% | 5/30 correct, 25 missed, 30 extra  |

All four runs used fixture set v2, prompt v2, Windows Chrome 152, and the same machine. They compare complete technology paths, not isolated model or inference-engine performance. Gemini ran manually in an eligible normal headed profile; the Qwen runs used automated headless dedicated profiles. Chrome does not expose Gemini Nano's exact model variant, execution device, or numeric sampling controls.

## Historical baseline: fixture set v1

These summaries underpin decisions recorded in the experiment journal and remain useful evidence. Do not mix their five-case metrics with fixture-v2 metrics.

- [WebLLM 0.6B, prompt v2](fixture-v1/2026-09-11-qwen3-0.6b-prompt-v2.json)
- [WebLLM 1.7B after the runtime rollback](fixture-v1/2026-09-11-qwen3-1.7b-prompt-v2-webllm-0.2.82.json)
- [Transformers.js 0.6B with parser v1](fixture-v1/2026-09-15-qwen3-0.6b-transformersjs-4.2.0.json)
- [Transformers.js 0.6B with parser v2](fixture-v1/2026-09-15-qwen3-0.6b-transformersjs-parser-v2.json)
- [Gemini Nano, prompt v2](fixture-v1/2026-09-15-gemini-nano-prompt-v2.json)

## Runtime limitations

These runs timed out under software WebGPU and provide no detection-quality evidence.

- [Qwen3-0.6B software-GPU run](runtime-limitations/2026-09-10-software-gpu.json)
- [Qwen3-1.7B software-GPU run](runtime-limitations/2026-09-11-qwen3-1.7b-software-gpu.json)

## Evidence policy

- Evidence summaries must identify the fixture set, prompt, runtime, model or managed-model limitation, environment, scoring method, and validation failures where known.
- Test fixtures must be invented. Do not commit real personal data, raw workbench exports, browser profiles, caches, or model weights.
- Simulated detector and mocked browser tests verify application behavior; they are not model-quality evidence.
- Detection results, end-to-end published output, timing, and runtime failures are distinct measurements and should not be conflated.
