# Experiment journal: PII detection inside a browser

This is the working record for a future blog post. It tracks decisions, implementation, evidence, and open questions. A successful build is not evidence that the model detects PII correctly.

## The question

Can a small language model running entirely in a desktop browser identify personal information accurately enough to replace it with stable tokens, while preserving every other character?

The longer-term experiment compares browser inference engines in separate pages of one app. The first milestone uses one engine and one small model to establish whether the core workflow works.

## Requirements agreed with the author

- All inference happens in the browser; no text is sent to a model API.
- Replace PII with tokens such as `[PERSON_1]`; never rewrite surrounding content.
- Desktop browsers only for this first experiment.
- Start with one method; change models if actual results justify it.
- Keep memory manageable by loading one engine at a time.
- Make the source presentable for public release, including contributor instructions and reproducible setup.
- Record the experiment as it happens for an eventual article.

## 2026-09-10 — Choosing a first implementation

**Decision:** WebLLM, Qwen3-0.6B at `q4f16_1`, with thinking disabled. Use React, TypeScript, and Vite for the app. Keep detection behind an interface so another runtime can be added later.

**Reasoning:** WebLLM provides a browser worker API and schema-constrained JSON generation. Qwen3-0.6B has available MLC, ONNX, and GGUF exports, making a later cross-runtime comparison possible. These are reasons to attempt it, not proof of extraction quality.

We initially discussed Qwen3-1.7B. The author challenged whether it was the smallest option. We reduced the starting point to 0.6B; SmolLM2-135M remains a possible smaller baseline. The 1.7B option will remain available for a deliberate, sequential comparison rather than an automatic larger download.

**Documented download sizes:** The MLC repositories list approximately 352 MB for Qwen3-0.6B and 984 MB for Qwen3-1.7B. The compiled runtime adds a separate download. These numbers are not runtime memory measurements.

Sources checked:

- [WebLLM worker API](https://webllm.mlc.ai/docs/user/advanced_usage.html)
- [Qwen3-0.6B MLC files](https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/tree/main)
- [Qwen3-1.7B MLC files](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/main)
- [Qwen3 model documentation](https://huggingface.co/Qwen/Qwen3-0.6B)

### Design: detection and replacement are separate

The model returns exact source substrings and categories. Deterministic application logic locates spans and inserts tokens. This lets us test character preservation independently of model quality. Asking a model to regenerate the full paragraph would conflate detection errors with rewriting errors.

For this first version, a detected literal is replaced at every exact occurrence with Unicode word boundaries. Repeated identical literals share a token within the document. This does not resolve aliases or distinguish two people with the same name. The policy may over-redact an ambiguous word used elsewhere; that is a known limitation to test.

Invalid JSON, unmatched detections, category conflicts, and partial overlaps fail the operation. A complete containing detection takes precedence over a contained one. Generated token names avoid collisions with tokens already present in the source.

### Planned evidence

- Unit tests for exact preservation, Unicode, repeated values, overlapping detections, and invalid output.
- Browser tests for loading, errors, cancellation, and output rendering using an explicitly simulated engine.
- Separate real-model runs and a small synthetic fixture evaluation. Simulated inference must never be reported as model validation.
- Record hardware and browser limitations encountered in this development environment.

### Implementation and first checks

Built the workbench and evaluation pages, explicit model loading, download progress, cancellation/unload, detected-span highlights, token mapping inspection, and copying/export. The app starts with an invented contact-details example. It never downloads a model automatically.

Added project documentation, contributor guidance, `AGENTS.md`, TypeScript configuration, formatting checks, a lockfile, and GitHub Actions checks. The project owner's application license choice remains open; no copyright owner or repository URL was invented.

**Verified:** `npm run check` passed with 29 tests covering replacement and model lifecycle. Seven Playwright browser tests passed using a simulated detector. The production build succeeded; Vite reports large chunks for the lazily loaded WebLLM runtime. The entry bundle was approximately 75 KB gzip at this point. These are app/infrastructure results, not PII accuracy results.

### Hardware discovery and compatibility adjustment

The available Chromium executable reports version **148.0.7778.96**. Its default headless setup exposes `navigator.gpu` but returns no adapter. Enabling SwiftShader exposes a **software** WebGPU adapter without `shader-f16`. Merely checking for `navigator.gpu` would therefore be insufficient.

**Decision:** Choose the same model's `q4f32_1` export when the adapter lacks half-precision support. The app displays compatibility mode, and evaluation exports record the actual runtime model ID. This is a precision/export choice, not a change in parameter count or a remote fallback. Qwen3-0.6B's float32-compute MLC repository also lists approximately 352 MB of downloads; active memory can be higher.

**Observed:** The real model loaded with the software adapter and entered evaluation. The first contact-details case hit the application's **120-second inference timeout**. The app displayed a failed case, unloaded the model, and exported an incomplete report. No completed extraction or accuracy score was obtained. This is an environment/performance limit, not evidence that Qwen3-0.6B succeeds or fails at PII detection. See the [recorded result](evidence/2026-09-10-software-gpu.json).

One initial test run was interrupted while improving the runner; it is not counted as model evidence. The runner now checks load errors promptly and prints only progress statuses from its synthetic evaluation. We also removed Playwright's browser user-agent override: the first export claimed Chrome 153 on Windows even though the executable was Chromium 148.0.7778.96. The evidence record explains this discrepancy; future test artifacts include the actual executable version and software-GPU flags.

### Improvements motivated by the checks

- Added tests for cancelling during the adapter check and during unresolved worker RPC calls. Terminating a worker alone does not settle WebLLM's pending promises, so the adapter explicitly rejects pending work.
- Added a deadline to generation. Failed/incomplete runs never publish a partially tokenised document.
- Extended evaluation exports with the synthetic fixtures and actual detections/output. This makes model failures inspectable for the article, rather than retaining only aggregate counts. User-entered workbench text is not included in these reports.
- Kept Qwen3-0.6B as the default. There is no measured quality result here that would justify switching to 1.7B, and increasing model size would not solve the lack of a hardware GPU in this environment.

### Next experiment on a desktop GPU

Run the five fixtures with 0.6B, export the report, and inspect the missed/extra detections and span boundaries. If quality is inadequate, unload it and repeat with 1.7B on the same machine. Record exact model export, browser, GPU, elapsed times, prompt version, and example-level differences. Decide on a model change from those results; avoid claiming general accuracy from five examples.

### Final review

The development-server test double initially matched only an exact module URL. Vite adds a timestamp query after source edits, so a later browser run bypassed the double and attempted to use the real adapter with a simulated GPU. Fixed the test interception to include Vite's query suffix. This was a test-harness issue, not a model result.

Captured [the workbench interface](workbench.png) for the README. The screenshot uses invented sample text **before inference** and does not depict a successful model run.

Final verification: `npm run check` passed (formatting, strict TypeScript, production build, 29 core/lifecycle tests). The final `npm run test:e2e` run passed all seven browser tests, including checking that exported evaluation reports contain synthetic results and exclude private workbench input. Real-model quality remains unverified because of the software-GPU timeout described above. The local development server is available at `http://127.0.0.1:5173` while running.

Reproduction command for this environment:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/de_sh/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
MODEL_HEADLESS=1 MODEL_SOFTWARE_GPU=1 npm run test:model
```

The executable path is environment-specific. Normal desktop users should use the app directly or `npm run test:model` with Playwright's installed Chromium. Software GPU performance must not be reported as representative desktop GPU latency.

## 2026-09-11 — Invalid JSON on both desktop models

**User observation:** Both selected models finish with the app's “invalid JSON” error on the user's desktop. The first implementation discarded the raw response when parsing failed, so neither the author nor the developer could see what actually came back. The specific malformed response has not been supplied; this is not evidence that the larger model would help.

**Change:** Retain completed responses in memory with the exact returned content, finish reason, runtime model ID, duration, and output token count. Display them in a collapsed “Inspect model response” panel, including for invalid JSON and truncated generations. Render the content as text, never HTML. Clear workbench diagnostics when the source/model changes or another attempt starts. Evaluation retains diagnostics per synthetic fixture and includes them in its explicit report export; workbench data is excluded. Nothing is logged or persisted automatically.

Completed validation failures now leave the engine loaded for retry; timeouts and runtime failures still unload it. Failed detections never become anonymised output. Removed the generic advice to try a larger model from the JSON parse error because we have no evidence that parameter count is the cause.

**Investigation:** A focused, cheaper subagent is checking the installed WebLLM/Qwen response-handling path while the main agent implements diagnostics and another cheaper subagent adds regression tests. Validation and any confirmed runtime correction will be recorded below.

**Confirmed source-level defect:** In installed WebLLM 0.2.85, `LLMChatPipeline.prefillStep` encodes `<think>\n\n</think>\n\n` and pushes it into `outputIds` whenever `enable_thinking === false` (`node_modules/@mlc-ai/web-llm/lib/index.js`, around line 10870). `processNextToken` decodes the complete `outputIds` into `outputMessage` (around line 11015). That content reaches the chat response. Consequently our strict JSON parser would reject otherwise valid JSON prefixed by this runtime-generated header, for either Qwen model size. We have not inspected the user's particular response, so diagnostics are still necessary to identify any additional issue.

**Correction:** Added `src/inference/webllm-response.ts` to remove only the exact leading empty-thinking prefix emitted by the pinned runtime. The core parser stays strict; no brace searching, reasoning removal, Markdown stripping, or partial JSON repair. Raw diagnostics remain unchanged. Evaluation exports now identify the parser version (`webllm-empty-thinking-v1`) separately from the unchanged prompt version.

**Verification:** `npm run format` and `npm run check` passed, including the production build and 33 unit/lifecycle tests. All nine browser tests passed with the simulated detector. Regressions cover the exact prefixed JSON response with untouched diagnostics, malformed JSON, nonempty reasoning, truncated output, safe HTML-as-text rendering, clearing stale diagnostics, retry readiness, and keeping private workbench text out of evaluation exports. These prove response handling and UI behaviour, not model accuracy. No prompt, model, or dependency changed. Real inference was not repeated on the software GPU that previously timed out; the next desktop run should confirm the actual response and any remaining model-quality issues.

## 2026-09-11 — WebGPU adapter unavailable after earlier runs

**User observation:** The browser now returns “No WebGPU adapter is available” after previously running the models. Browser, OS, GPU, and restart outcome have been requested but are not yet known. This failure occurs at `requestAdapter()`, before loading either model. A null result alone does not identify its cause.

**Source observations:** Our idle unload terminated the worker without invoking WebLLM's explicit unload path. In pinned WebLLM 0.2.85, the unload RPC disposes pipelines and waits for GPU synchronization; the underlying device cleanup calls `device.destroy()`. A cheaper subagent independently reviewed this lifecycle. Also, our preflight used the default adapter preference while WebLLM's `detectGPUDevice` requests `high-performance`.

**Changes:** Idle unload now attempts `engine.unload()`, then terminates the worker. A two-second deadline or unload rejection falls back to termination. Busy cancellation and page exit terminate immediately because a busy or departing worker cannot reliably complete an unload RPC. Cleanup is idempotent, and model controls remain locked until disposal finishes. New loads wait for cleanup; cancellation during that wait invalidates the load. The preflight now matches WebLLM's high-performance preference. The error and README provide restart and browser GPU-diagnostic steps without deleting cached model files.

**Hypothesis, not a confirmed diagnosis:** Repeated GPU-process crashes or resource pressure could explain access disappearing. Missing explicit cleanup could contribute to resource pressure, but the user's failure has not been reproduced here. [Chrome's official troubleshooting guide](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) also lists disabled acceleration, blocklisting, and unsupported configurations. A browser restart and the user's GPU status are needed to narrow this down. These changes cannot force a browser to supply an adapter.

**Validation:** `npm run check` and the simulated browser suite passed after the lifecycle changes. Tests cover high-performance adapter selection, null-adapter guidance, graceful release ordering, rejection and deadline fallbacks, idempotence, busy cancellation, timeout cleanup, delayed loads, cancellation races, and locking the UI during unload. The first browser run exposed a Vite development timestamp causing two copies of the simulated `ModelResponseError` class; the test double now imports the exact transformed module URL used by the app. That was test infrastructure, not a product or model failure. No prompt, model, or dependency changed; model-quality claims remain unchanged. This development environment has no hardware WebGPU adapter, so it cannot verify recovery on the user's GPU.

## 2026-09-11 — First hardware-GPU fixture results and prompt v2

**Observed on the author's desktop, Qwen3-0.6B `q4f16_1`:** The contact-details case scored **2/4**. It detected the email address and phone number but missed both occurrences of the same full name. The fixture contains three distinct expected values but four expected spans because the name appears twice. Hardware, browser version, and full exported report were not captured with this observation.

The next case, address and date of birth, completed in **5.68 seconds** with finish reason `stop` and 17 output tokens. Its response, after WebLLM's empty thinking prefix, was `{"entities":[{"text":"exact substring","category":"PERSON"}]}`. The strict span validator rejected it because that text does not occur in the fixture, produced no anonymised output, and stopped the evaluation. This is a model extraction failure, not a JSON, truncation, WebGPU, or replacement failure.

**Root cause in our prompt:** Prompt v1 used `{"text":"exact substring","category":"PERSON"}` to illustrate the response shape. The 0.6B model copied that placeholder and category verbatim. The JSON schema restricts structure and category values, but cannot require a generated string to occur in the dynamic source text.

**Prompt v2:** Removed the populated placeholder entirely. The prompt now describes the object fields in prose, requires every `text` value to be a verbatim substring of the current input, forbids prompt/example values, explicitly asks for all PII and complete contiguous personal names, distinguishes dates of birth from ordinary dates, and asks the model to verify source membership before returning. The response schema and deterministic validation are unchanged. Evaluation exports now obtain the prompt version from the prompt module rather than a separate hard-coded value.

**Next measurement:** Reload the app, rerun all five fixtures with 0.6B and export the report. Compare prompt v2 with the recorded 2/4 and failed second case. Only then test 1.7B if recall or source-copy fidelity remains inadequate. Until that run, prompt v2 is a hypothesis rather than an accuracy improvement.

### Completed prompt-v2 report

**Observed:** The author supplied a complete five-case app export for Qwen3-0.6B `q4f16_1`, WebLLM 0.2.85, prompt v2, Chrome 152 on a Windows desktop user agent. GPU details were not present. All responses finished normally and parsed; there were no WebGPU, timeout, truncation, JSON, or unmatched-span failures. The report contained only the built-in invented fixtures and no workbench data. A reviewed summary is stored as [evidence](evidence/2026-09-11-qwen3-0.6b-prompt-v2.json).

The exact occurrence-level totals were **8/11 correct, 3 missed, and 16 extra from 24 detected spans**: 33.3% precision, 72.7% recall, and 45.7% F1. Total inference time was 56.626 seconds; the mean was 11.325 seconds and median 9.368 seconds. These figures describe one five-case diagnostic run, not a benchmark.

- Contact details improved from 2/4 to 4/4 expected spans, but also labelled `report` and ordinary `Friday` as dates of birth.
- Address and date of birth improved from an invalid copied placeholder to a perfect 3/3.
- Account reference scored 0/2: the model labelled the entire account-holder sentence as one `ID` instead of separating the person and account number.
- The no-PII case produced 13 extra replacement spans across ordinary words, an ordinary weekday, furniture, and a price.
- The instruction-in-text case found the email and did not obey the embedded request to return nothing, but missed the person's name.

**Interpretation:** Prompt v2 fixed a real prompt defect. The 0.6B result remains a useful baseline, although it both misses sensitive spans and substantially alters non-PII text. Keep prompt v2 and fixture v1 unchanged for the next controlled comparison with 1.7B.

**Automation change:** Strengthened the opt-in real-model Playwright evaluation. It now launches a persistent Chromium profile so model downloads can be reused, always writes a timestamped report to an ignored local directory, and adds aggregate precision/recall/F1 and runner metadata. Misses, extras, and incomplete cases are recorded without failing by default because they are useful experimental outcomes. `MODEL_STRICT=1` provides an optional zero-miss, zero-extra regression gate, while `--repeat-each` supports repeated runs. Unit and simulated browser tests remain separate because they cannot establish model accuracy.

**Automation validation:** `npm run check` passed with 43 unit/lifecycle tests, and Playwright successfully discovered the real-model evaluation without launching it. The upgraded runner has not executed a hardware model in this development environment because no hardware WebGPU adapter is available here. Its first desktop execution remains the end-to-end verification of persistent caching, report writing, and the quality gate.

## 2026-09-11 — Automated 1.7B run on software WebGPU

**User direction:** Treat misses, extras, and incomplete model cases as useful experimental results rather than requiring a perfect score. The real-model evaluator now records these without failing by default. `MODEL_STRICT=1` retains the optional zero-miss, zero-extra regression gate.

**Observed:** Ran Qwen3-1.7B with prompt v2 and fixture v1 in headless Chromium 148 using SwiftShader. Because the adapter lacks `shader-f16`, the app selected `Qwen3-1.7B-q4f32_1-MLC`. The model downloaded and loaded successfully. Its first contact-details fixture exceeded the 120-second generation timeout without returning content, so no detection-quality score was possible. Later attempts reused the persistent cache. The [reviewed evidence](evidence/2026-09-11-qwen3-1.7b-software-gpu.json) records the environment and limitation.

The timeout recurred while the model runner's persistent-context artifact path was being repaired. Those repetitions were runner development rather than predeclared quality trials. Persistent Chromium did not reliably emit or settle the programmatic Blob download after the app had preserved the incomplete row. The runner now captures the app's exact JSON Blob at construction and invokes the export through a direct DOM click. Simulated browser tests cover both complete evaluation export and preservation/export after a runtime failure.

**Interpretation:** This proves the 1.7B model is available and loadable through the WebLLM path, but SwiftShader is too slow for the present timeout. It provides no basis for comparing 1.7B accuracy with the hardware-GPU 0.6B result. Run the same command on a hardware WebGPU desktop to obtain that comparison.

## 2026-09-11 — First 1.7B hardware response and evaluation continuation

**Observed on the author's desktop:** Qwen3-1.7B `q4f16_1` completed the contact-details fixture in 38.83 seconds with finish reason `stop` and 87 output tokens. It returned the correct full name and phone, duplicated the full-name entity, invented the non-source email `email@example.com`, and returned the literal category label `DATE_OF_BIRTH` as a date-of-birth entity. The exact-span validator rejected the entire case because two generated strings were absent from the source. Duplicate valid entities alone would have been deduplicated safely.

This is not a JSON, truncation, WebGPU, or parser failure. It is evidence that the 1.7B model can still violate the prompt's verbatim-source constraint. Rejecting the case produced no partial anonymised output, as designed.

**Evaluation behavior change:** A completed response with a `ModelResponseError` or `DetectionError` now records its diagnostics and continues to later fixtures. This changes only the evaluation workflow; the workbench still rejects the entire document, and failed evaluation cases still produce no partial output. Runtime errors and timeouts continue to stop evaluation and unload the engine because underlying work may remain active. This allows one hardware run to collect all useful completed responses even when an early case is semantically invalid.

**Verification:** `npm run check` passed with 43 unit/lifecycle tests. All 12 simulated browser tests passed, including separate completed unmatched-span and invalid-JSON runs that proceed through five ordered failure rows, plus a runtime failure that still stops after one row and unloads the model. These tests verify workflow behavior, not model quality.

**Reproduction refinement:** The first continuation change was technically active but left the failed row and failure notice visible while the next 1.7B request ran. With tens of seconds between responses, that looked like the run had stopped. A deterministic browser test now supplies the exact reported first entity list, holds the second request open, and verifies that the UI says it is running case 2 of 5 before ultimately recording and exporting all five rows. The continuation decision also treats diagnostics from a completed response as evidence that the engine is safe to call again, avoiding dependence on JavaScript error-class identity after a development hot reload. The evaluation UI now names the active case and counts processed failures. `npm run check` passed with 43 unit/lifecycle tests, and all 13 simulated browser tests passed. This reproduces application control flow; it is not another model-quality result.

## 2026-09-11 — Second-call runtime failure and WebLLM rollback

**Observed on the author's desktop:** After the invalid first 1.7B response was recorded, the address fixture failed before returning response diagnostics. The application displayed only “Something went wrong” because WebLLM's worker RPC converts exceptions to strings and the application accepted only `Error` objects. The absence of the original error text means the precise desktop exception cannot be recovered from this run.

**Upstream finding:** [WebLLM issue #844](https://github.com/mlc-ai/web-llm/issues/844) reports a regression introduced in 0.2.83 on Windows integrated graphics, including Qwen3-1.7B: longer prefills can throw “Object has already been disposed” and lose the WebGPU device. It reports 0.2.82 as unaffected. Inspection confirmed that installed 0.2.85 still bounded its GPU `shapeCache` to 256 entries and disposed a cached `ShapeTuple` on eviction, matching the reported faulty code. This is a strong match for the observed environment and failure pattern, although the hidden desktop exception prevents proving that it was the cause of this particular run.

**Decision:** Pin WebLLM 0.2.82 and keep the model, prompt, fixtures, 4,096-token context, and generation settings unchanged. This removes the known runtime regression without conflating the comparison with a prompt or model change. A fresh browser run will download the older compiled model runtime; cached weights can remain. Worker string rejections are now shown and exported verbatim, so any remaining runtime failure will identify its actual cause. The simulated runtime-failure test now uses WebLLM's real string-rejection shape.

**Verification:** The installed dependency and lockfile resolve to 0.2.82, its bundled model catalogue contains both selected Qwen3 exports, and the faulty `shapeCache` implementation is absent. The runtime version is visible beside the model selector and recorded in exports. `npm run check` passed with 43 unit/lifecycle tests and a production bundle using 0.2.82. All 13 simulated browser tests passed, including preservation of a stringified WebLLM worker failure. A hardware run remains necessary to measure whether the upstream rollback resolves this desktop's second-prefill failure.

### Completed 1.7B run after rollback

**Observed:** The author supplied a five-case Qwen3-1.7B `q4f16_1` export from Chrome 152 on the Windows desktop, using WebLLM 0.2.82, prompt v2, fixture v1, temperature zero, and thinking disabled. All five inference calls completed with finish reason `stop`; there were no runtime failures. This resolves the earlier second-call infrastructure problem. The report remains `complete: false` because exact-span validation correctly rejected the contact-details response. A [reviewed evidence summary](evidence/2026-09-11-qwen3-1.7b-prompt-v2-webllm-0.2.82.json) preserves the results without copying the full raw report.

Four cases were scored directly by the application. For an all-five diagnostic comparison, the failed contact case was reviewed separately: duplicate detections were deduplicated, exact literals were expanded to source occurrences, and its two unmatched literals were counted as extras. On that stated basis, 1.7B produced **9/11 correct spans, 2 missed, and 8 extra from 17 detected spans**: 52.9% precision, 81.8% recall, and 64.3% F1. Total inference time was 89.718 seconds; mean 17.944 seconds, median 17.597 seconds, and 300 output tokens. This was one diagnostic run, and the reviewed contact score is not an app-generated score.

The end-to-end anonymised output tells a stricter story. The rejected contact document produced no output, so none of its four expected occurrence spans were replaced. Across output actually produced by the app, the result was **6/11 correct, 5 missed, and 6 extra from 12 replacements**: 50.0% precision, 54.5% recall, and 52.2% F1. The detection-level review measures what the model nearly returned correctly; the end-to-end score measures what the safety policy allowed the application to publish.

- Contact details: three of four expected occurrences were recoverable, but the model substituted a shortened email and invented the literal `DATE_OF_BIRTH`; strict validation rejected the document. Its response was the same as the earlier 1.7B attempt under WebLLM 0.2.85.
- Address and date of birth: perfect 3/3 with no extras.
- Account reference: found the person, labelled the account number as `ID` instead of `ACCOUNT`, and incorrectly labelled the invoice amount as a date of birth; 1/2 correct with two extras.
- No personal information: four false positives (`Friday`, the budget, and both quantities), down from thirteen replacement spans in the 0.6B run.
- Instruction in text: perfect 2/2 and did not follow the embedded instruction.

**Comparison:** Against the single 0.6B prompt-v2 run, the reviewed raw 1.7B detections improved correct spans from 8 to 9, reduced misses from 3 to 2, and halved extras from 16 to 8; detection-level F1 rose from 45.7% to 64.3%. Its end-to-end F1 was only 52.2% after atomic rejection. It took 1.58 times as long overall. Timing is not a controlled runtime comparison because 0.6B used WebLLM 0.2.85 and 1.7B used 0.2.82. The larger model is directionally better on this tiny set, but neither model/prompt combination is reliable enough for unattended PII anonymisation.

## 2026-09-15 — Separate experiment pages and welcome screen

**Decision:** Make the application entry point a compact experiment index. WebLLM now owns `#/webllm` and `#/webllm/evaluation`; Transformers.js and Gemini Nano appear as planned experiments without active links. Hash routing keeps the static-host deployment model and avoids adding a routing dependency.

The WebLLM workbench and evaluation remain one mounted experiment so their selected model and in-memory results survive navigation between those two views. Navigating back to the experiment index unmounts the WebLLM page and force-disposes its detector. This makes the one-engine-at-a-time lifecycle boundary explicit before more runtimes are added.

The previous large marketing hero was removed. The index now briefly introduces the broader browser-local comparison, while the WebLLM page has only a short technical description. No inference, prompt, model, fixture, replacement, or evaluation behaviour changed.

**Verification:** `npm run format` and `npm run check` passed, including the production build and all 43 unit/lifecycle tests. All 15 Playwright browser tests passed with the simulated detector, including new checks for experiment availability, the nested routes, and forced disposal when leaving WebLLM. These remain application tests, not model-quality evidence; a real-model run was not repeated because the inference implementation did not change.

## Article outline (working)

1. Why try PII detection in a browser?
2. Why a small model, and why WebLLM first?
3. Preserve the document by separating detection from replacement.
4. Downloads, model lifetime, and the difference between disk and GPU memory.
5. What the smallest model actually gets right and wrong.
6. What changed after testing, with reproducible examples.
7. Limits of this experiment and the next runtime comparison.

## Recording rules

Append dated findings as work progresses. Include the exact model ID, browser/hardware where known, prompt changes, fixture results, and reproducible commands. Label measurements, estimates, hypotheses, and simulated results explicitly. Keep real personal information out of this journal, source control, screenshots, and test artifacts.
