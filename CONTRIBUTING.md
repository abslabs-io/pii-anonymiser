# Contributing

PII Lab is an experiment in browser-local personal information detection. Useful contributions include reproducible model failures using invented text, runtime comparisons, accessibility fixes, and better evaluation cases.

## Development

Use Node.js 22.12+ and run `npm ci`, then `npm run dev`. Run `npm run format` and `npm run check` before proposing changes. UI changes should also pass `npm run test:e2e`.

For prompt/model changes, use the Evaluation page or `npm run test:model`. Include the model ID, browser, hardware, fixture result, and whether inference ran on an actual or software GPU. A few examples are not a general accuracy claim.

## Reporting a detection problem

Provide a minimal example made from invented personal details, the expected replacements, the actual result, model ID, browser version, and relevant settings. Do not paste real personal information, token mappings, credentials, or private documents into an issue or pull request.

## Design constraints

Preserve the original text outside detected spans. Keep inference local and model loading explicit. New runtimes should implement the existing detector interface. Explain matching-policy changes and their effect on false positives and missed detections.

Update the experiment journal when a change adds evidence or changes the approach. Keep the source license decision with the project owner before public contributions are solicited.
