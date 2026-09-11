import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// This module replacement exists only in Playwright's dev-server responses.
// It is never included in the application or used as evidence of model quality.
async function simulate(
  page: Page,
  mode:
    | 'normal'
    | 'slow-load'
    | 'slow-run'
    | 'slow-unload'
    | 'invalid'
    | 'invalid-json'
    | 'reported-first-failure'
    | 'runtime-error' = 'normal',
) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const NativeBlob = window.Blob;
    class CapturedBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
        super(parts, options);
        if (
          options.type === 'application/json' &&
          parts.every((part) => typeof part === 'string')
        )
          (
            window as typeof window & { __piiLabEvaluation?: string }
          ).__piiLabEvaluation = parts.join('');
      }
    }
    Object.defineProperty(window, 'Blob', {
      configurable: true,
      value: CapturedBlob,
      writable: true,
    });
  });
  await page.route(/\/src\/inference\/webllm\.ts(?:\?.*)?$/, async (route) => {
    // Vite appends a timestamp query to transformed imports during development.
    // Keep the simulated error class identical to the app's imported class.
    const transformed = await route.fetch();
    const source = await transformed.text();
    const typesModule =
      source.match(
        /from\s+['"](\/src\/inference\/types\.ts(?:\?[^'"]*)?)['"]/,
      )?.[1] ?? '/src/inference/types.ts';
    await route.fulfill({
      contentType: 'application/javascript',
      body: `import { ModelResponseError } from ${JSON.stringify(typesModule)};
    export class WebLlmDetector {
      calls = 0;
      model = null;
      async load(model, progress) {
        this.model = model;
        progress({progress: 0.5, text: 'Simulated model download'});
        await new Promise(resolve => setTimeout(resolve, ${mode === 'slow-load' ? 60_000 : 30}));
        return model;
      }
      async detect(text) {
        this.calls++;
        const delay = ${JSON.stringify(mode)} === 'reported-first-failure' && this.calls === 2
          ? 1_500
          : ${mode === 'slow-run' ? 60_000 : 30};
        await new Promise(resolve => setTimeout(resolve, delay));
        if (${JSON.stringify(mode)} === 'runtime-error') {
          throw 'Error: Simulated WebLLM worker failure';
        }
        const reportedRaw = '<think>\\n\\n</think>\\n\\n' + JSON.stringify({entities: [
          {text: 'Alice Morgan', category: 'PERSON'},
          {text: 'email@example.com', category: 'EMAIL'},
          {text: '+44 7700 900123', category: 'PHONE'},
          {text: 'Alice Morgan', category: 'PERSON'},
          {text: 'DATE_OF_BIRTH', category: 'DATE_OF_BIRTH'}
        ]});
        const diagnostics = {
          model: this.model,
          rawContent: ${JSON.stringify(
            mode === 'invalid-json'
              ? '<img src=x onerror=alert(1)>'
              : mode === 'reported-first-failure'
                ? '__REPORTED_RAW__'
                : '{"entities":[]}',
          )},
          finishReason: 'stop',
          durationMs: 123,
          outputTokens: 45
        };
        if (diagnostics.rawContent === '__REPORTED_RAW__') diagnostics.rawContent = reportedRaw;
        if (${JSON.stringify(mode)} === 'invalid-json') {
          throw new ModelResponseError('The model returned invalid JSON.', diagnostics);
        }
        return {entities: ${
          mode === 'invalid'
            ? '[{text:"Invented entity", category:"PERSON"}]'
            : mode === 'reported-first-failure'
              ? `this.calls === 1 ? [
          {text:'Alice Morgan', category:'PERSON'},
          {text:'email@example.com', category:'EMAIL'},
          {text:'+44 7700 900123', category:'PHONE'},
          {text:'Alice Morgan', category:'PERSON'},
          {text:'DATE_OF_BIRTH', category:'DATE_OF_BIRTH'}
        ] : [
          ...(text.includes('Daniel Reed') ? [{text:'Daniel Reed', category:'PERSON'}] : []),
          ...(text.includes('42 Example Lane, Bristol, BS1 1AA') ? [{text:'42 Example Lane, Bristol, BS1 1AA', category:'ADDRESS'}] : []),
          ...(text.includes('14 March 1988') ? [{text:'14 March 1988', category:'DATE_OF_BIRTH'}] : []),
          ...(text.includes('Maya Patel') ? [{text:'Maya Patel', category:'PERSON'}] : []),
          ...(text.includes('12345678') ? [{text:'12345678', category:'ACCOUNT'}] : []),
          ...(text.includes('Priya Shah') ? [{text:'Priya Shah', category:'PERSON'}] : []),
          ...(text.includes('priya.shah@example.com') ? [{text:'priya.shah@example.com', category:'EMAIL'}] : [])
        ]`
              : `[
          ...(text.includes('Alice Morgan') ? [{text:'Alice Morgan', category:'PERSON'}] : []),
          ...(text.includes('alice.morgan@example.com') ? [{text:'alice.morgan@example.com', category:'EMAIL'}] : []),
          ...(text.includes('+44 7700 900123') ? [{text:'+44 7700 900123', category:'PHONE'}] : [])
        ]`
        }, durationMs: diagnostics.durationMs, outputTokens: diagnostics.outputTokens, diagnostics};
      }
      async dispose() {
        await new Promise(resolve => setTimeout(resolve, ${mode === 'slow-unload' ? 500 : 0}));
      }
    }`,
    });
  });
  await page.goto('/');
}

test('loads on demand, replaces exact spans, and clears stale results on edits', async ({
  page,
}) => {
  await simulate(page);
  await expect(page.getByText(/WebLLM 0\.2\.82 · 4-bit/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Anonymise text' }),
  ).toBeDisabled();
  await expect(page.getByTestId('output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Anonymise text' }).click();
  await expect(page.getByTestId('output')).toHaveText(
    'Hi, I’m [PERSON_1].\nPlease email [EMAIL_1] or call [PHONE_1].\n\n[PERSON_1] will send the report on Friday.',
  );
  await expect(page.getByTestId('raw-response')).toHaveText('{"entities":[]}');
  await expect(page.locator('mark')).toHaveCount(4);
  await page.getByRole('button', { name: 'Anonymise text' }).click();
  await expect(page.getByTestId('raw-response')).toHaveCount(0);
  await expect(page.getByTestId('output')).toBeVisible();
  await page.getByLabel('Text to anonymise').fill('Different input');
  await expect(page.getByTestId('output')).toHaveCount(0);
});

test('cancel releases controls during a download or inference', async ({
  page,
}) => {
  await simulate(page, 'slow-load');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel & unload' }).click();
  await expect(page.getByRole('status')).toContainText('Not loaded');
  await expect(page.getByLabel('Model', { exact: true })).toBeEnabled();
});

test('cancel discards unfinished inference and releases the model', async ({
  page,
}) => {
  await simulate(page, 'slow-run');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Anonymise text' }).click();
  await page.getByRole('button', { name: 'Cancel & unload' }).click();
  await expect(page.getByRole('status')).toContainText('Not loaded');
  await expect(page.getByTestId('output')).toHaveCount(0);
});

test('locks model and inference controls until a slow unload completes', async ({
  page,
}) => {
  await simulate(page, 'slow-unload');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');

  await page.getByRole('button', { name: 'Unload model' }).click();
  await expect(page.getByRole('status')).toContainText('Releasing model');
  await expect(page.getByRole('button', { name: 'Unloading…' })).toBeDisabled();
  await expect(page.getByLabel('Model', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Anonymise text' }),
  ).toBeDisabled();

  await expect(page.getByRole('status')).toContainText('Not loaded');
  await expect(page.getByRole('button', { name: 'Load model' })).toBeEnabled();
  await expect(page.getByLabel('Model', { exact: true })).toBeEnabled();
});

test('invalid model detections fail visibly without publishing output', async ({
  page,
}) => {
  await simulate(page, 'invalid');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Anonymise text' }).click();
  await expect(page.getByRole('alert')).toContainText('did not match');
  await expect(page.getByTestId('output')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Copy output' }),
  ).toBeDisabled();
});

test('shows failed raw model response as escaped text and clears it on edits', async ({
  page,
}) => {
  await simulate(page, 'invalid-json');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Anonymise text' }).click();

  await expect(page.getByRole('alert')).toContainText('invalid JSON');
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await expect(page.getByTestId('raw-response')).toHaveText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.getByTestId('raw-response').locator('img')).toHaveCount(0);
  await expect(page.getByTestId('output')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Anonymise text' }),
  ).toBeEnabled();

  await page.getByLabel('Text to anonymise').fill('Changed input');
  await expect(page.getByTestId('raw-response')).toHaveCount(0);
});

test('evaluation uses all fixtures sequentially and exports results', async ({
  page,
}) => {
  await simulate(page);
  await page.getByLabel('Text to anonymise').fill('PRIVATE_WORKBENCH_TEXT');
  await page.getByRole('link', { name: '02 Evaluation' }).click();
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Run 5 examples' }).click();
  await expect(
    page.getByRole('button', { name: 'Export results' }),
  ).toBeEnabled();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByText('Inspect result', { exact: true }).first().click();
  await expect(page.locator('.case-details pre').first()).toContainText(
    '[PERSON_1]',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export results' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pii-lab-evaluation.json');
  const content = await readFile((await file.path())!, 'utf8');
  const report = JSON.parse(content);
  const capturedReport = JSON.parse(
    (await page.evaluate(
      () =>
        (window as typeof window & { __piiLabEvaluation?: string })
          .__piiLabEvaluation,
    ))!,
  );
  expect(report.complete).toBe(true);
  expect(report.runtime).toBe('WebLLM 0.2.82');
  expect(capturedReport).toEqual(report);
  expect(report.results).toHaveLength(5);
  expect(report.results[0].score.correct).toBe(4);
  expect(report.results[0].output).toContain('[PERSON_1]');
  expect(report.promptVersion).toBe('v2');
  expect(content).not.toContain('PRIVATE_WORKBENCH_TEXT');
});

for (const completedFailure of [
  {
    mode: 'invalid' as const,
    error: 'did not match',
    rawContent: '{"entities":[]}',
  },
  {
    mode: 'invalid-json' as const,
    error: 'invalid JSON',
    rawContent: '<img src=x onerror=alert(1)>',
  },
]) {
  test(`completed ${completedFailure.mode} evaluation failures are recorded without stopping`, async ({
    page,
  }) => {
    await simulate(page, completedFailure.mode);
    await page.getByLabel('Text to anonymise').fill('PRIVATE_WORKBENCH_TEXT');
    await page.getByRole('link', { name: '02 Evaluation' }).click();
    await page.getByRole('button', { name: 'Load model' }).click();
    await expect(page.getByRole('status')).toContainText('Ready on device');
    await page.getByRole('button', { name: 'Run 5 examples' }).click();

    await expect(page.getByRole('alert')).toContainText('completed');
    await expect(page.getByRole('status')).toContainText('Ready on device');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(
      page.getByRole('button', { name: 'Export results' }),
    ).toBeEnabled();

    await page.getByRole('button', { name: 'Export results' }).click();
    const report = JSON.parse(
      (await page.evaluate(
        () =>
          (window as typeof window & { __piiLabEvaluation?: string })
            .__piiLabEvaluation,
      ))!,
    );
    expect(report.complete).toBe(false);
    expect(report.results).toHaveLength(5);
    expect(
      report.results.map((result: { name: string }) => result.name),
    ).toEqual(report.fixtures.map((fixture: { name: string }) => fixture.name));
    for (const result of report.results) {
      expect(result.error).toContain(completedFailure.error);
      expect(result.diagnostics.rawContent).toBe(completedFailure.rawContent);
    }
    expect(report.fixtures).toHaveLength(5);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_WORKBENCH_TEXT');
  });
}

test('the reported 1.7B first-case failure is recorded while case two runs', async ({
  page,
}) => {
  await simulate(page, 'reported-first-failure');
  await page.getByRole('link', { name: '02 Evaluation' }).click();
  await page
    .getByLabel('Model', { exact: true })
    .selectOption('Qwen3-1.7B-q4f16_1-MLC');
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Run 5 examples' }).click();

  await expect(
    page.getByText('Recorded failure — run continues:'),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Evaluating 2/5 · Address & date of birth',
  );
  await expect(page.locator('.evaluation-progress')).toContainText(
    'Running case 2 of 5: Address & date of birth',
  );
  await expect(page.getByText('CASES PROCESSED').locator('..')).toContainText(
    '1 / 5',
  );

  await expect(page.getByRole('status')).toContainText('Ready on device');
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.getByText('Failed:', { exact: false })).toHaveCount(1);
  await expect(page.getByText('CASES PROCESSED').locator('..')).toContainText(
    '5 / 5',
  );

  await page.getByRole('button', { name: 'Export results' }).click();
  const report = JSON.parse(
    (await page.evaluate(
      () =>
        (window as typeof window & { __piiLabEvaluation?: string })
          .__piiLabEvaluation,
    ))!,
  );
  expect(report.complete).toBe(false);
  expect(report.results).toHaveLength(5);
  expect(report.results[0].error).toContain('did not match');
  expect(report.results[0].diagnostics.rawContent).toContain(
    '"text":"email@example.com"',
  );
  expect(report.results[1].score).toMatchObject({
    expected: 3,
    correct: 3,
    missed: 0,
    extra: 0,
  });
});

test('runtime failure preserves an incomplete evaluation report after unload', async ({
  page,
}) => {
  await simulate(page, 'runtime-error');
  await page.getByRole('link', { name: '02 Evaluation' }).click();
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page.getByRole('button', { name: 'Run 5 examples' }).click();

  await expect(page.getByRole('status')).toContainText('Not loaded');
  await expect(page.getByRole('alert')).toContainText(
    'Error: Simulated WebLLM worker failure',
  );
  await expect(
    page.getByRole('button', { name: 'Export results' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Export results' }).click();
  const report = JSON.parse(
    (await page.evaluate(
      () =>
        (window as typeof window & { __piiLabEvaluation?: string })
          .__piiLabEvaluation,
    ))!,
  );
  expect(report.complete).toBe(false);
  expect(report.results).toEqual([
    {
      name: 'Contact details',
      error: 'Error: Simulated WebLLM worker failure',
    },
  ]);
});

test('unsupported browser shows guidance without starting a model', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as Record<string, unknown>).gpu;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('does not expose WebGPU');
  await expect(page.getByRole('button', { name: 'Load model' })).toBeDisabled();
});

test('input is rendered as text, and oversized passages cannot run', async ({
  page,
}) => {
  await simulate(page);
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByRole('status')).toContainText('Ready on device');
  await page
    .getByLabel('Text to anonymise')
    .fill('<img src=x onerror=alert(1)> Alice Morgan');
  await page.getByRole('button', { name: 'Anonymise text' }).click();
  await expect(page.getByTestId('output')).toHaveText(
    '<img src=x onerror=alert(1)> [PERSON_1]',
  );
  await expect(page.locator('.output-panel img')).toHaveCount(0);
  await page.getByLabel('Text to anonymise').fill('é'.repeat(1001));
  await expect(
    page.getByRole('button', { name: 'Anonymise text' }),
  ).toBeDisabled();
});
