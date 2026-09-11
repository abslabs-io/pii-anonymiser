# Working in PII Lab

Read `README.md` and `docs/experiment-journal.md` before making changes. This is a browser-local PII experiment intended to produce both a public repository and an article.

## Product invariants

- Keep inference in the browser. Do not add a remote fallback, analytics, or logging of inputs, outputs, or mappings.
- The model identifies entities; deterministic code constructs the output from original string slices. Never ask it to rewrite the document.
- Preserve every character outside replacements. Reject invalid, incomplete, or ambiguous model outputs instead of displaying a partial success.
- Load only one model at a time per tab. Release resources on unload, cancellation, and page exit. A larger model requires an explicit selection and load.
- Keep the source of test evidence clear: mocked browser tests are not model evaluations.
- Never commit real personal data, browser caches, model weights, downloaded reports containing user text, or credentials.

## Structure and conventions

- TypeScript strict mode. Pure replacement and evaluation code belongs in `src/core/`.
- Runtime-specific code belongs behind `Detector` in `src/inference/`.
- Use semantic HTML, accessible labels, visible focus states, and reduced-motion support.
- Prefer small dependencies and local assets. No external font downloads.
- Keep test fixtures invented and deterministic. Test actual preservation/failure properties rather than mirroring the implementation.

## Verification

- Run `npm run format` after edits, then `npm run check`.
- Run `npm run test:e2e` for UI or lifecycle changes. Install Chromium with `npx playwright install chromium` if needed.
- Run `npm run test:model` when changing prompts/models where GPU access permits. If unavailable, document the exact limitation and provide reproducible desktop steps.
- Avoid treating poor model accuracy as an infrastructure failure; record missed and extra detections and compare measured results before changing defaults.

## Experiment record

Update `docs/experiment-journal.md` for meaningful decisions, prompt/model changes, failures, fixes, and results. Include commands and environment facts where useful. Distinguish observations, estimates, hypotheses, and simulated outcomes. Keep the README's validation claims consistent with that evidence.

## Publication

Do not invent a repository URL, copyright owner, or license choice. The owner still needs to select an application source license before open-source publication. Do not publish or push unless asked.
