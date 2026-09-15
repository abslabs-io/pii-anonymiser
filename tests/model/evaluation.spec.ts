import { chromium, expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Result = {
  score?: {
    expected: number;
    detected: number;
    correct: number;
    missed: number;
    extra: number;
  };
  durationMs?: number;
  error?: string;
};

type Report = {
  timestamp: string;
  complete: boolean;
  results: Result[];
  runner?: unknown;
};

const modelRuntime =
  process.env.MODEL_RUNTIME === 'transformersjs' ||
  process.env.MODEL_RUNTIME === 'gemini-nano'
    ? process.env.MODEL_RUNTIME
    : 'webllm';
const selectedModel =
  modelRuntime === 'gemini-nano'
    ? 'gemini-nano'
    : (process.env.MODEL_ID ??
      (modelRuntime === 'transformersjs'
        ? 'onnx-community/Qwen3-0.6B-ONNX'
        : 'Qwen3-0.6B-q4f16_1-MLC'));
const softwareGpu = process.env.MODEL_SOFTWARE_GPU === '1';
const headless = process.env.MODEL_HEADLESS === '1';
const strict = process.env.MODEL_STRICT === '1';
const profileDirectory = resolve(
  process.env.MODEL_PROFILE_DIR ??
    (modelRuntime === 'webllm'
      ? '.model-cache/chromium'
      : `.model-cache/${modelRuntime}-chrome`),
);
const reportDirectory = resolve(
  process.env.MODEL_REPORT_DIR ?? 'model-evaluation-results',
);

// Real engine, real model download. Deliberately separate from default CI.
test(`evaluate ${selectedModel} through ${modelRuntime} in the browser`, async ({}, testInfo) => {
  await mkdir(profileDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDirectory, {
    acceptDownloads: true,
    baseURL: 'http://127.0.0.1:5173',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    channel:
      modelRuntime === 'gemini-nano' &&
      !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? 'chrome'
        : undefined,
    headless,
    viewport: { width: 1280, height: 900 },
    args:
      softwareGpu && modelRuntime !== 'gemini-nano'
        ? [
            '--enable-unsafe-webgpu',
            '--use-angle=swiftshader',
            '--enable-features=Vulkan',
          ]
        : [],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  // Read the exact JSON Blob produced by the app. Chromium does not always
  // emit a download event for programmatic Blob links in persistent contexts.
  await page.addInitScript(() => {
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
  // Only status text from synthetic fixtures is printed; never source/output.
  const progress = setInterval(() => {
    void page
      .getByRole('status')
      .textContent()
      .then((status) => {
        console.log(`Model test status: ${status?.trim()}`);
      })
      .catch(() => {});
  }, 15_000);
  try {
    await page.goto(`/#/${modelRuntime}/evaluation`);
    await page.getByLabel('Model', { exact: true }).selectOption(selectedModel);
    await expect(
      page.getByRole('button', { name: 'Load model' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Load model' }).click();
    await expect(
      page
        .getByRole('button', { name: 'Unload model', exact: true })
        .or(page.getByRole('alert')),
    ).toBeVisible({ timeout: 10 * 60_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Ready on device', {
      timeout: 10 * 60_000,
    });
    await page.getByRole('button', { name: 'Run 5 examples' }).click();
    await expect(
      page.getByRole('button', { name: 'Export results' }),
    ).toBeEnabled({ timeout: 12 * 60_000 });
    console.log('Model eval: export is ready');
    await page
      .getByRole('button', { name: 'Export results' })
      .evaluate((button: HTMLButtonElement) => button.click());
    console.log('Model eval: export requested');
    const temporaryPath = testInfo.outputPath('evaluation.json');
    const reportText = await page
      .waitForFunction(
        () =>
          (window as typeof window & { __piiLabEvaluation?: string })
            .__piiLabEvaluation,
        undefined,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue());
    if (typeof reportText !== 'string')
      throw new Error('The app did not produce an evaluation report.');
    console.log('Model eval: report captured');
    await writeFile(temporaryPath, reportText);
    const report = JSON.parse(await readFile(temporaryPath, 'utf8')) as Report;
    const totals = report.results.reduce(
      (sum, result) => ({
        expected: sum.expected + (result.score?.expected ?? 0),
        detected: sum.detected + (result.score?.detected ?? 0),
        correct: sum.correct + (result.score?.correct ?? 0),
        missed: sum.missed + (result.score?.missed ?? 0),
        extra: sum.extra + (result.score?.extra ?? 0),
        failedCases: sum.failedCases + (result.error ? 1 : 0),
      }),
      {
        expected: 0,
        detected: 0,
        correct: 0,
        missed: 0,
        extra: 0,
        failedCases: 0,
      },
    );
    const summary = {
      ...totals,
      precision:
        totals.detected === 0
          ? totals.expected === 0
            ? 1
            : 0
          : totals.correct / totals.detected,
      recall: totals.expected === 0 ? 1 : totals.correct / totals.expected,
      f1:
        totals.correct === 0
          ? 0
          : (2 * totals.correct) / (totals.detected + totals.expected),
      totalDurationMs: report.results.reduce(
        (sum, result) => sum + (result.durationMs ?? 0),
        0,
      ),
      strictPass:
        report.complete &&
        totals.failedCases === 0 &&
        totals.missed === 0 &&
        totals.extra === 0,
    };
    report.runner = {
      browserVersion: context.browser()?.version() ?? 'unknown',
      softwareGpuRequested: softwareGpu && modelRuntime !== 'gemini-nano',
      chromeManagedModel: modelRuntime === 'gemini-nano',
      headless,
      strictRequested: strict,
      repeatIndex: testInfo.repeatEachIndex,
      summary,
    };
    await mkdir(reportDirectory, { recursive: true });
    const timestamp = report.timestamp.replaceAll(':', '-');
    const safeModel = selectedModel.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
    const reportPath = resolve(
      reportDirectory,
      `${timestamp}-${safeModel}-run-${testInfo.repeatEachIndex + 1}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach('real-model-evaluation', {
      path: reportPath,
      contentType: 'application/json',
    });
    console.log(
      `Model eval: ${totals.correct}/${totals.expected} correct, ${totals.missed} missed, ${totals.extra} extra; report: ${reportPath}`,
    );

    if (strict) {
      expect(report.complete, 'all fixtures should complete').toBe(true);
      expect(totals.failedCases, 'no fixture should fail validation').toBe(0);
      expect(totals.missed, 'the strict run should have no missed PII').toBe(0);
      expect(
        totals.extra,
        'the strict run should have no extra replacements',
      ).toBe(0);
    }
  } finally {
    clearInterval(progress);
    const unload = page.getByRole('button', {
      name: 'Unload model',
      exact: true,
    });
    if (await unload.isVisible().catch(() => false))
      await unload.click().catch(() => {});
    await context.close();
  }
});
