# PII Lab

A desktop browser experiment: use a small local language model to detect personal information, then replace exact spans with tokens while preserving the rest of the text.

Three implementations compare **WebLLM**, **Transformers.js**, and Chrome's built-in **Gemini Nano** through the Prompt API. The first two offer Qwen3-0.6B and Qwen3-1.7B for deliberate, sequential comparisons; Chrome selects and updates its own model variant. This is an experimental detector, not a guarantee that all identifying information has been removed.

![The workbench with invented sample text, before model loading or inference](docs/workbench.png)

## Run locally

Requirements: Node.js 22.12+ (Node 24 recommended), npm, and a current desktop browser. The Qwen experiments require WebGPU and graphics acceleration. If the GPU lacks `shader-f16`, WebLLM selects the same model's `q4f32_1` export and Transformers.js selects its `q4` export. The page displays “compatibility mode”; this can consume more memory and run slower, but never switches to a larger model or remote service. Gemini Nano uses Chrome's separate hardware eligibility policy described below.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The welcome screen lists the browser-local experiments. No API key, environment file, or inference backend is needed.

1. Open an experiment, choose the model where a choice is available, and click **Load model**. The first visit downloads that runtime's model assets. Gemini Nano requires a supported current desktop Chrome release and an eligible device.
2. Paste a short passage or select an invented sample.
3. Click **Anonymise text** and review the highlighted detections and tokenised output.
4. Use **Evaluation** to run five labelled examples sequentially and export a JSON report.
5. Unload before selecting another model. **Cancel & unload** also stops unfinished work.

Use **Inspect model response** after a completed attempt to see the exact response text, finish reason, runtime model, output-token count, and elapsed time. This works for invalid JSON and unfinished responses as well as successful detections. Raw responses are sensitive, unvalidated text, displayed literally in a collapsed panel. Workbench responses are kept only in page memory, cleared on input/model changes or another attempt, and never included in evaluation exports. Completed validation failures leave the model loaded for retry; timeouts and runtime failures unload it. If no response arrived, there is no raw content to display.

Each evaluation case has its own response inspector. A completed response that fails JSON or exact-span validation is recorded without anonymised output, and evaluation continues to the next fixture. While inference is active, the evaluation panel identifies the case currently running and counts every processed case, including failures. A runtime failure or timeout stops the run and unloads the model because the underlying generation may still be active. Evaluation exports include only the invented fixtures and their responses, including failed cases, so the experiment can be diagnosed without exporting workbench text.

The initial limit is **2,000 UTF-8 bytes per passage**. The Qwen runtimes use a 4,096-token model context and at most 1,024 output tokens. Chrome manages Gemini Nano's context and output limits; quota errors are reported rather than silently truncating documents. This deliberately keeps the experiment focused on short passages. UTF-8 bytes are not model tokens.

## What runs where

```text
Original text → selected browser-local runtime → exact strings + categories
              → validate against original → deterministic token replacement
```

- React/TypeScript renders the app; Vite serves and builds it.
- WebLLM or Transformers.js with ONNX Runtime Web runs Qwen3 on the browser's GPU, inside a dedicated worker.
- The Prompt API runs Chrome's built-in Gemini Nano model in the browser. The API is currently exposed only to the page, not a worker; Chrome keeps inference inside its own model service.
- Model code loads only after clicking **Load model**.
- Input, output, and token mappings stay in page memory. Reloading clears them.
- No analytics, remote fonts, inference API, or automatic text logging is included.
- Qwen downloads contact Hugging Face and, for WebLLM, its runtime host. Chrome manages the Gemini Nano download. Those downloads reveal normal network metadata, but model inputs are not sent with them.
- Model assets are cached or managed by the selected runtime. Cache eviction, Chrome's model-management policy, or private browsing can cause another download. This app does not promise a fully offline page reload.
- One model runs at a time within the app tab. Idle unload releases the selected runtime's engine or Prompt API session. Cancellation and page exit abort current work and release the app's worker or session; cached files remain on disk. Chrome ultimately controls the lifetime of its shared built-in model. Opening multiple tabs can allocate multiple sessions or models.

## Gemini Nano requirements and comparison limits

The Gemini Nano experiment targets only the current global `LanguageModel` Prompt API; it does not support the obsolete `window.ai` API. Chrome's current documented requirements include Windows 10/11, macOS 13+, Linux, or supported Chromebook Plus devices; at least 22 GB free on the Chrome-profile volume; and either more than 4 GB VRAM or at least 16 GB RAM with four CPU cores. An unmetered connection is required for the initial model download. Chrome for Android and iOS is not supported. See the official [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) and [model-management](https://developer.chrome.com/docs/ai/understand-built-in-model-management) documentation for the current requirements.

Chrome may choose a larger or smaller Gemini Nano variant for the device and can replace it during browser updates. JavaScript cannot query the exact model version. The web API also does not expose numeric sampling controls by default, a thinking-mode switch, finish reasons, or output-token counts. Reports therefore use `gemini-nano@chrome-managed`, record the browser user agent, use `null` for unavailable generation fields, and should be compared by browser version and run date. Each detection clones a clean session containing prompt v2, then destroys that clone, so prior workbench inputs and earlier evaluation fixtures cannot enter later model context.

## When WebGPU stops working

“No WebGPU adapter is available” means the browser exposes the API but cannot supply a usable GPU before model loading starts. If it worked earlier, save any text you need, close other model tabs, and fully quit and reopen the browser. Reload the app and explicitly load 0.6B first. You do not need to delete cached model downloads.

If it persists, check that graphics acceleration is enabled in the browser's system settings, then inspect `chrome://gpu` (Chrome) or `edge://gpu` (Edge), especially WebGPU status and “Problems Detected”. Record your browser version, OS, GPU, and whether restarting restored access. [Chrome's WebGPU troubleshooting guide](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) lists causes including disabled acceleration, GPU blocklisting, and repeated GPU-process crashes. The app cannot establish which one happened from a null adapter alone.

Transformers.js translates several known low-level failures into actionable messages while retaining the original runtime text as a technical detail. In particular, `std::bad_alloc` during ONNX session creation means the selected model could not fit in the memory available to that browser process. Close other model tabs and GPU-heavy applications, fully restart the browser, and try a current Chrome or Edge release. If the 1.7B model still fails, use 0.6B. The app also gives specific guidance for a lost GPU device, download/network failures, exhausted site-storage quota, and WebGPU buffer-limit errors; unknown runtime errors are shown unchanged.

## Models and sizes

| Runtime           | Model/export                           | Approximate download |
| ----------------- | -------------------------------------- | -------------------: |
| WebLLM            | `Qwen3-0.6B-q4f16_1-MLC`               |               352 MB |
| WebLLM            | `Qwen3-1.7B-q4f16_1-MLC`               |               984 MB |
| Transformers.js   | `onnx-community/Qwen3-0.6B-ONNX` q4f16 |               570 MB |
| Transformers.js   | `onnx-community/Qwen3-1.7B-ONNX` q4f16 |              1.43 GB |
| Chrome Prompt API | Gemini Nano, Chrome-managed variant    |   Not exposed by API |

The Qwen runtimes are additional downloads. Running memory and loading peaks exceed download size and depend on browser, GPU, context, and runtime. WebLLM sizes are from its [0.6B](https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/tree/main) and [1.7B](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/main) repositories. Transformers.js sizes are the q4f16 files in the ONNX Community [0.6B](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/main/onnx) and [1.7B](https://huggingface.co/onnx-community/Qwen3-1.7B-ONNX/tree/main/onnx) repositories. The Transformers.js `q4` compatibility files are approximately 919 MB and 2.15 GB. Sizes were checked on 2026-09-15.

Thinking is disabled for Qwen3 and its generation is deterministic: WebLLM uses temperature zero, while Transformers.js uses greedy generation (`do_sample: false`). WebLLM and the Chrome Prompt API apply the same JSON schema during generation. Transformers.js 4.2.0 has no equivalent built-in structured-generation constraint, so it relies on the same prompt followed by strict JSON and exact-span validation. Its parser accepts plain JSON or one exact outer `json` Markdown fence, while still rejecting commentary, reasoning, unsupported categories, malformed JSON, and partial output. Gemini Nano uses Chrome's default web sampling because numeric controls are unavailable by default; repeat runs are needed to measure variation. Evaluation exports record the generation constraint and parser version. The package and lockfile pin both Qwen runtimes, while Chrome manages Gemini Nano. Upstream Qwen model URLs currently follow their repositories' default revisions, so record the date of comparisons; bit-for-bit reproducibility would additionally require pinning model revisions/assets and is not available for the Chrome-managed model.

The pinned WebLLM 0.2.82 runtime includes an exact empty thinking prefix (`<think>\n\n</think>\n\n`) in returned content when thinking is disabled. The adapter removes only that prefix before strict JSON validation. The response inspector retains it verbatim. Other reasoning, Markdown wrappers, malformed JSON, and truncated responses remain errors.

WebLLM is intentionally pinned to 0.2.82. An [upstream GPU-cache regression](https://github.com/mlc-ai/web-llm/issues/844) introduced in 0.2.83 can dispose GPU shape objects while they are still in use, causing longer Qwen3 prefills to fail and sometimes lose the WebGPU device. The same faulty eviction code remains present in 0.2.85, which this experiment briefly used. Revisit the pin after the upstream fix is released and verified against this evaluation.

## Exact preservation and matching policy

The LLM never writes the final document. It returns source strings labelled as `PERSON`, `EMAIL`, `PHONE`, `ADDRESS`, `DATE_OF_BIRTH`, `ID`, or `ACCOUNT`. Application logic:

- Finds exact, case-sensitive occurrences with Unicode letter/number/mark boundaries.
- Replaces every matching occurrence of a detected literal. An identical literal and category reuse the same token within that document.
- Gives complete containing spans precedence, such as a full name over its parts.
- Rejects unmatched strings, conflicting categories, malformed output, truncated generations, and partially overlapping spans. Failed runs produce no output.
- Avoids generated tokens that already occur in the original text.
- Copies every character outside replacement spans directly from the original string, including whitespace, punctuation, and line breaks.

This version does not resolve aliases, distinguish two people with the same name, or selectively redact only one occurrence of an ambiguous literal. For example, detecting “May” as a name could also replace a separate whole-word occurrence referring to the month. Full anonymisation of indirect identifying context is outside this first milestone. Keeping a token mapping makes the transformation reversible; treat that mapping as sensitive too.

## Validation

```sh
npm run check          # formatting, typecheck, production build, unit tests
npx playwright install chromium
npm run test:e2e       # UI tests with an explicitly simulated detector
npm run eval:model     # REAL model: opens Chromium, runs fixtures, saves a report
```

`test:e2e` does not establish model accuracy. It intercepts the detector module in the dev server only; no simulated engine is shipped in the app.

`eval:model` (also available as `test:model`) starts the development server itself and uses a visible browser by default. The Qwen runtimes require a usable GPU; Gemini Nano requires an eligible Chrome installation. The runner uses a runtime-specific persistent automation profile under `.model-cache/` so model downloads can survive later runs, and saves timestamped reports under `model-evaluation-results/`. These profiles are separate from normal browser profiles, so a first run may download the model again. Both directories are ignored by Git. The runner prints aggregate counts without printing fixture text or model responses and saves its report before finishing. Misses, extra detections, and incomplete cases are experimental results, so they do not fail the command by default. Set `MODEL_STRICT=1` when you specifically want a zero-miss, zero-extra regression gate. Even a strict pass applies only to this small diagnostic set; it does not establish that a model is safe for general PII anonymisation.

Run WebLLM with 0.6B once, or repeat it three times to inspect stability:

```sh
npm run eval:model
npm run eval:model -- --repeat-each=3
```

To select the larger model in Bash:

```sh
MODEL_ID=Qwen3-1.7B-q4f16_1-MLC npm run eval:model
```

In Windows PowerShell:

```powershell
$env:MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC'
npm run eval:model
Remove-Item Env:MODEL_ID
```

Run the matching Transformers.js ONNX export in Bash:

```sh
MODEL_RUNTIME=transformersjs npm run eval:model
MODEL_RUNTIME=transformersjs MODEL_ID=onnx-community/Qwen3-1.7B-ONNX npm run eval:model
```

Or in Windows PowerShell:

```powershell
$env:MODEL_RUNTIME = 'transformersjs'
$env:MODEL_ID = 'onnx-community/Qwen3-1.7B-ONNX'
npm run eval:model
Remove-Item Env:MODEL_RUNTIME
Remove-Item Env:MODEL_ID
```

Run Chrome's built-in Gemini Nano in the installed stable Chrome browser:

```sh
MODEL_RUNTIME=gemini-nano npm run eval:model
```

Or in Windows PowerShell:

```powershell
$env:MODEL_RUNTIME = 'gemini-nano'
npm run eval:model
Remove-Item Env:MODEL_RUNTIME
```

The Gemini Nano runner selects the installed Chrome channel by default and uses `.model-cache/gemini-nano-chrome` as its automation profile. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chrome is installed in a nonstandard location. A fresh profile may trigger Chrome's eligibility checks and initial model download. Do not set `MODEL_ID`; the browser chooses the model variant.

Optional runner settings: `MODEL_STRICT=1` enables the strict quality gate; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an existing browser executable; `MODEL_PROFILE_DIR` and `MODEL_REPORT_DIR` change the persistent profile and report locations; `MODEL_HEADLESS=1` runs headless; `MODEL_SOFTWARE_GPU=1` enables an experimental SwiftShader path for the two WebGPU runtimes. Software GPU mode does not apply to Gemini Nano, and its timings are not representative of desktop GPU performance. Do not commit the browser profile, model weights, or unreviewed reports.

Evaluation checks exact span and category matches, including repeated occurrences. It reports correct, missed, and extra detections. Completed validation failures remain failures and produce no partial output, but do not prevent later fixtures from running. Runtime failures stop the run. Five invented cases are a diagnostic set, not an accuracy benchmark. See the [experiment journal](docs/experiment-journal.md) for actual validation status and findings.

**Current real-model status:** WebLLM has reviewed Windows desktop results. Qwen3-0.6B with prompt v2 scored 8/11 correct spans with 3 missed and 16 extra. See the [reviewed WebLLM 0.6B result](docs/evidence/2026-09-11-qwen3-0.6b-prompt-v2.json). After the WebLLM rollback, Qwen3-1.7B completed all five inference calls. Its reviewed raw detections scored 9/11 correct with 2 missed and 8 extra, but exact-span validation rejected one complete document. The anonymised output actually published across the fixtures contained only 6/11 correct replacements, with 5 missed and 6 extra. See the [reviewed WebLLM 1.7B result](docs/evidence/2026-09-11-qwen3-1.7b-prompt-v2-webllm-0.2.82.json). The larger model performed better on this small diagnostic set but remains unsuitable for unattended anonymisation. Software-WebGPU runs are recorded separately for [0.6B](docs/evidence/2026-09-10-software-gpu.json) and [1.7B](docs/evidence/2026-09-11-qwen3-1.7b-software-gpu.json); both timed out and are not representative of desktop GPU performance.

The first Transformers.js hardware-WebGPU run used Qwen3-0.6B q4f16 in Firefox 154. All five generations completed, but every response was Markdown-fenced JSON, so parser v1 rejected every document and published no anonymised output. A diagnostic review inside the fences found 6/11 expected spans, 5 misses, and 14 extras from 20 returned occurrence spans (30.0% precision, 54.5% recall, 38.7% F1). See the [reviewed Transformers.js 0.6B result](docs/evidence/2026-09-15-qwen3-0.6b-transformersjs-4.2.0.json). Browser and runtime differences mean its 66.590-second total should not be treated as a controlled timing comparison with the earlier WebLLM run. Parser v2 subsequently added the exact fence normalization described above; the v1 result remains the preserved formatting baseline.

The parser-v2 0.6B rerun returned exactly the same five raw responses and token counts. Fence normalization allowed three documents to produce output; one response still failed because it used an unsupported category, and one failed because it contained a non-source literal. Across output actually published by the app, only 2/11 expected spans were replaced, 9 were missed, and 7 incorrect replacements were added (22.2% precision, 18.2% recall, 20.0% F1). See the [reviewed parser-v2 result](docs/evidence/2026-09-15-qwen3-0.6b-transformersjs-parser-v2.json). The parser fix resolved the formatting problem but did not make the 0.6B model reliable.

Gemini Nano infrastructure is implemented against Chrome's current Prompt API, but no real-model result has been reviewed yet. Simulated tests establish routing, lifecycle, strict response handling, export metadata, and fixture orchestration only. Run `MODEL_RUNTIME=gemini-nano npm run eval:model` on an eligible Chrome installation to produce the first model-quality evidence.

## Production build

```sh
npm run build
npm run preview
```

Serve `dist/` on an HTTPS static host. Page navigation uses hashes, so no server route rewrites are required: `#/` lists experiments; `#/webllm`, `#/transformersjs`, and `#/gemini-nano` open their workbenches; adding `/evaluation` opens each evaluation page. The initial JavaScript bundle excludes the lazily loaded inference adapters. The build reports large runtime chunks and a WASM asset; they are requested only by the selected Qwen experiment's worker. Browser-local inference requires HTTPS or localhost. These WebGPU implementations do not need the cross-origin-isolation headers that some multithreaded WASM approaches require.

## Repository map

| Location                     | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `src/core/`                  | Pure span replacement, output validation, fixtures, and scoring |
| `src/inference/`             | Shared detector contract and runtime-specific adapters/workers  |
| `src/App.tsx`                | Welcome screen and lightweight experiment routing               |
| `src/experiments/`           | Runtime-specific experiment pages and their lifecycle UI        |
| `tests/browser/`             | Browser workflows with simulated inference                      |
| `tests/model/`               | Opt-in real model evaluation                                    |
| `docs/experiment-journal.md` | Decisions, progress, evidence, and article material             |

For contribution expectations see [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents should read [AGENTS.md](AGENTS.md). Another runtime can implement `Detector` while reusing the same replacement logic and fixture scoring.

## Publication and licensing

An application source license has not yet been selected by the project owner. Choose one before advertising this repository as open source. Dependency and model licenses remain separate; the Qwen3 model cards identify Apache-2.0. No model weights are committed here.
