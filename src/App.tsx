import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  anonymise,
  DetectionError,
  type Anonymised,
  type Entity,
} from './core/anonymise';
import { ResponseDetails } from './components/ResponseDetails';
import { responseParserVersion } from './inference/webllm-response';
import { promptVersion } from './inference/prompt';
import { scoreFixture, type Score } from './core/evaluate';
import { fixtures } from './core/samples';
import {
  byteLength,
  MAX_INPUT_BYTES,
  models,
  ModelResponseError,
  WEBLLM_VERSION,
  type Detector,
  type ModelId,
  type Progress,
  type RuntimeModelId,
  type ResponseDiagnostics,
} from './inference/types';

type Status =
  'idle' | 'loading' | 'ready' | 'running' | 'evaluating' | 'unloading';
type Result = Anonymised & { durationMs: number; outputTokens: number | null };
type EvalRow = {
  name: string;
  score?: Score;
  durationMs?: number;
  error?: string;
  output?: string;
  detections?: Entity[];
  diagnostics?: ResponseDiagnostics;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  // WebLLM's worker RPC serializes thrown errors with err.toString() and
  // rejects the client promise with that string.
  if (typeof error === 'string' && error.trim()) return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  )
    return error.message;
  return 'Something went wrong. Unload the model and try again.';
};

function SourcePreview({ result }: { result: Anonymised }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  result.spans.forEach((span) => {
    parts.push(result.original.slice(cursor, span.start));
    parts.push(
      <mark key={span.start} title={span.token}>
        {result.original.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  parts.push(result.original.slice(cursor));
  return <pre className="source-preview">{parts}</pre>;
}

export function App() {
  const [page, setPage] = useState(
    window.location.hash === '#/evaluation' ? 'evaluation' : 'workbench',
  );
  const [model, setModel] = useState<ModelId>(models[0].id);
  const [loadedModel, setLoadedModel] = useState<RuntimeModelId | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<Progress>({ progress: 0, text: '' });
  const [text, setText] = useState(fixtures[0].text);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<ResponseDiagnostics | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<EvalRow[]>([]);
  const [evalModel, setEvalModel] = useState<RuntimeModelId | null>(null);
  const [evalDate, setEvalDate] = useState('');
  const detector = useRef<Detector | null>(null);
  const operation = useRef(0);
  const busyRef = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const navigate = () =>
      setPage(
        window.location.hash === '#/evaluation' ? 'evaluation' : 'workbench',
      );
    const release = () => {
      operation.current++;
      busyRef.current = false;
      const current = detector.current;
      detector.current = null;
      void current?.dispose({ force: true });
      setStatus('idle');
      setLoadedModel(null);
      setDiagnostics(null);
    };
    window.addEventListener('hashchange', navigate);
    window.addEventListener('pagehide', release);
    return () => {
      release();
      clearTimeout(copyTimer.current);
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('pagehide', release);
    };
  }, []);

  const busy =
    status === 'loading' ||
    status === 'running' ||
    status === 'evaluating' ||
    status === 'unloading';
  const selectedModel = models.find((item) => item.id === model)!;
  const bytes = byteLength(text);
  const tooLong = bytes > MAX_INPUT_BYTES;
  const unsupported = !window.isSecureContext || !('gpu' in navigator);
  const activeEvaluation =
    status === 'evaluating' ? fixtures[rows.length] : undefined;

  function updateText(value: string) {
    setText(value);
    setResult(null);
    setDiagnostics(null);
    setError('');
    setCopied(false);
  }

  async function unload() {
    const id = ++operation.current;
    busyRef.current = true;
    const current = detector.current;
    setStatus('unloading');
    setLoadedModel(null);
    setProgress({ progress: 0, text: '' });
    await current?.dispose();
    if (operation.current === id) {
      detector.current = null;
      busyRef.current = false;
      setStatus('idle');
    }
  }

  async function load() {
    if (busyRef.current) return;
    busyRef.current = true;
    const id = ++operation.current;
    setError('');
    setDiagnostics(null);
    setStatus('loading');
    setProgress({
      progress: 0,
      text: 'Checking browser and preparing the engine…',
    });
    try {
      const { WebLlmDetector } = await import('./inference/webllm');
      if (operation.current !== id) return;
      const next = new WebLlmDetector();
      detector.current = next;
      const resolvedModel = await next.load(model, (update) => {
        if (operation.current === id) setProgress(update);
      });
      if (operation.current === id) {
        setLoadedModel(resolvedModel);
        setStatus('ready');
      }
    } catch (caught) {
      if (operation.current === id) {
        setError(errorMessage(caught));
        await unload();
      }
    } finally {
      if (operation.current === id) busyRef.current = false;
    }
  }

  async function run() {
    if (busyRef.current || !detector.current || status !== 'ready') return;
    busyRef.current = true;
    const id = ++operation.current;
    setStatus('running');
    setError('');
    setResult(null);
    setDiagnostics(null);
    setCopied(false);
    try {
      const detection = await detector.current.detect(text);
      if (operation.current !== id) return;
      setDiagnostics(detection.diagnostics ?? null);
      setResult({
        ...anonymise(text, detection.entities),
        durationMs: detection.durationMs,
        outputTokens: detection.outputTokens,
      });
      setStatus('ready');
    } catch (caught) {
      if (operation.current === id) {
        setError(errorMessage(caught));
        if (caught instanceof ModelResponseError)
          setDiagnostics(caught.diagnostics);
        if (
          caught instanceof ModelResponseError ||
          caught instanceof DetectionError
        )
          setStatus('ready');
        else await unload();
      }
    } finally {
      if (operation.current === id) busyRef.current = false;
    }
  }

  async function evaluate() {
    if (busyRef.current || !detector.current || status !== 'ready') return;
    busyRef.current = true;
    const id = ++operation.current;
    setStatus('evaluating');
    setError('');
    setRows([]);
    setEvalModel(loadedModel);
    setEvalDate(new Date().toISOString());
    let failedCases = 0;
    try {
      for (const fixture of fixtures) {
        let caseDiagnostics: ResponseDiagnostics | undefined;
        try {
          const detection = await detector.current.detect(fixture.text);
          if (operation.current !== id) return;
          caseDiagnostics = detection.diagnostics;
          const output = anonymise(fixture.text, detection.entities);
          setRows((previous) => [
            ...previous,
            {
              name: fixture.name,
              score: scoreFixture(fixture, output),
              durationMs: detection.durationMs,
              output: output.output,
              detections: detection.entities,
              diagnostics: caseDiagnostics,
            },
          ]);
        } catch (caught) {
          if (operation.current !== id) return;
          const message = errorMessage(caught);
          setRows((previous) => [
            ...previous,
            {
              name: fixture.name,
              error: message,
              diagnostics:
                caught instanceof ModelResponseError
                  ? caught.diagnostics
                  : caseDiagnostics,
            },
          ]);
          // A returned diagnostic proves inference completed, even if a hot
          // module reload means the thrown error has a different class identity.
          const completed =
            caseDiagnostics !== undefined ||
            caught instanceof ModelResponseError ||
            caught instanceof DetectionError;
          if (completed) {
            failedCases++;
            continue;
          }
          // Stop rather than overlap a potentially timed-out generation.
          setError(
            `Evaluation stopped after a runtime failure and unloaded the model. ${message}`,
          );
          await unload();
          return;
        }
      }
      if (operation.current === id) {
        setStatus('ready');
        if (failedCases)
          setError(
            `Evaluation completed with ${failedCases} failed ${failedCases === 1 ? 'case' : 'cases'}. Inspect the recorded responses and export the incomplete report.`,
          );
      }
    } finally {
      if (operation.current === id) busyRef.current = false;
    }
  }

  async function copyOutput() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        'Clipboard access failed. You can select and copy the output directly.',
      );
    }
  }

  function exportReport() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            experiment: 'PII Lab',
            model: evalModel,
            runtime: `WebLLM ${WEBLLM_VERSION}`,
            timestamp: evalDate,
            browser: navigator.userAgent,
            fixtureSet: 'v1',
            promptVersion,
            responseParserVersion,
            temperature: 0,
            thinking: false,
            fixtures,
            complete:
              rows.length === fixtures.length && rows.every((row) => row.score),
            results: rows,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pii-lab-evaluation.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const total = rows.reduce(
    (sum, row) => ({
      correct: sum.correct + (row.score?.correct ?? 0),
      expected: sum.expected + (row.score?.expected ?? 0),
      extra: sum.extra + (row.score?.extra ?? 0),
    }),
    { correct: 0, expected: 0, extra: 0 },
  );

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#/webllm" aria-label="PII Lab home">
          <span className="brand-mark">[·]</span> PII Lab{' '}
          <span className="version">EXPERIMENT 001</span>
        </a>
        <span className="local-badge">
          <span className="dot" /> Browser-local inference
        </span>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="eyebrow">SMALL MODELS, PERSONAL DATA</p>
            <h1>
              Keep the meaning.
              <br />
              <span>Replace the personal.</span>
            </h1>
          </div>
          <p className="intro-note">
            A small language model finds personal information.
            <br />
            Exact replacements keep the rest of your text intact.
            <br />
            <strong>All processing happens in this browser.</strong>
          </p>
        </div>
        <nav className="tabs" aria-label="Experiment pages">
          <a
            href="#/webllm"
            aria-current={page === 'workbench' ? 'page' : undefined}
          >
            01 <span>Workbench</span>
          </a>
          <a
            href="#/evaluation"
            aria-current={page === 'evaluation' ? 'page' : undefined}
          >
            02 <span>Evaluation</span>
          </a>
          <span className="engine-tag">WEBLLM / WEBGPU</span>
        </nav>

        <section className="model-bar" aria-label="Model controls">
          <div className="model-info">
            <span className="micro-label">INFERENCE MODEL</span>
            <select
              aria-label="Model"
              value={model}
              disabled={status !== 'idle'}
              onChange={(event) => {
                setModel(event.target.value as ModelId);
                setResult(null);
                setDiagnostics(null);
                setError('');
              }}
            >
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="model-meta">
              WebLLM {WEBLLM_VERSION} · 4-bit · {selectedModel.download} first
              download · thinking off
              {loadedModel?.includes('f32') ? ' · compatibility mode' : ''}
            </span>
          </div>
          <div className="model-actions">
            <span className={`status status-${status}`} role="status">
              <span className="dot" />
              {status === 'idle'
                ? 'Not loaded'
                : status === 'loading'
                  ? 'Loading model'
                  : status === 'unloading'
                    ? 'Releasing model'
                    : status === 'ready'
                      ? 'Ready on device'
                      : status === 'evaluating'
                        ? `Evaluating ${Math.min(rows.length + 1, fixtures.length)}/${fixtures.length}${activeEvaluation ? ` · ${activeEvaluation.name}` : ''}`
                        : 'Finding PII'}
            </span>
            {status === 'idle' ? (
              <button
                className="button dark"
                onClick={() => void load()}
                disabled={unsupported}
              >
                Load model <span aria-hidden="true">↓</span>
              </button>
            ) : (
              <button
                className="button secondary"
                onClick={() => void unload()}
                disabled={status === 'unloading'}
              >
                {status === 'unloading'
                  ? 'Unloading…'
                  : busy
                    ? 'Cancel & unload'
                    : 'Unload model'}
              </button>
            )}
          </div>
          {status === 'loading' && (
            <div className="load-progress">
              <progress
                aria-label="Model download progress"
                value={Math.min(1, Math.max(0, progress.progress))}
                max="1"
              />
              <p>{progress.text}</p>
            </div>
          )}
        </section>

        {unsupported && (
          <div className="notice" role="alert">
            This browser does not expose WebGPU on this page. Use a current
            desktop Chrome or Edge browser with graphics acceleration, over
            HTTPS or localhost.
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        {page === 'workbench' ? (
          <>
            {diagnostics && <ResponseDetails diagnostics={diagnostics} />}
            <div className="workspace">
              <section className="panel input-panel">
                <div className="panel-heading">
                  <div>
                    <span className="micro-label">01 / SOURCE</span>
                    <h2>Original text</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => updateText('')}
                    disabled={busy || !text}
                  >
                    Clear
                  </button>
                </div>
                <label className="sr-only" htmlFor="source">
                  Text to anonymise
                </label>
                <textarea
                  id="source"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  value={text}
                  onChange={(event) => updateText(event.target.value)}
                  placeholder="Paste a short passage containing personal information…"
                />
                <div className="input-footer">
                  <span className={tooLong ? 'over-limit' : ''}>
                    {bytes.toLocaleString()} /{' '}
                    {MAX_INPUT_BYTES.toLocaleString()} bytes
                  </span>
                  <span>Short passages for this experiment</span>
                </div>
                <div className="sample-row">
                  <label htmlFor="sample">Try a sample</label>
                  <select
                    id="sample"
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      const sample = fixtures[Number(event.target.value)];
                      if (sample) updateText(sample.text);
                    }}
                  >
                    <option value="" disabled>
                      Select invented text…
                    </option>
                    {fixtures.map((fixture, index) => (
                      <option key={fixture.name} value={index}>
                        {fixture.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="button primary run-button"
                  onClick={() => void run()}
                  disabled={status !== 'ready' || !text.trim() || tooLong}
                >
                  {status === 'running'
                    ? 'Finding personal information…'
                    : 'Anonymise text'}
                  <span aria-hidden="true">↗</span>
                </button>
                {status === 'idle' && (
                  <p className="helper">
                    Load the model above to begin. Downloads are cached by your
                    browser.
                  </p>
                )}
              </section>
              <section
                className="panel output-panel"
                aria-label="Anonymised result"
              >
                <div className="panel-heading">
                  <div>
                    <span className="micro-label">02 / RESULT</span>
                    <h2>Tokenised text</h2>
                  </div>
                  <button
                    className="button small secondary"
                    disabled={!result}
                    onClick={() => void copyOutput()}
                  >
                    {copied ? 'Copied' : 'Copy output'}
                  </button>
                </div>
                {result ? (
                  <>
                    <pre className="output-text" data-testid="output">
                      {result.output}
                    </pre>
                    <div className="result-meta">
                      <span>
                        {result.spans.length} replacement
                        {result.spans.length === 1 ? '' : 's'}
                      </span>
                      <span>
                        {(result.durationMs / 1000).toFixed(2)}s inference
                      </span>
                    </div>
                    <div className="result-note">
                      {result.spans.length
                        ? 'Text outside replacements is preserved exactly. Review the detections before using the result.'
                        : 'No PII detected by this model. This does not establish that the text contains no personal information.'}
                    </div>
                  </>
                ) : (
                  <div className="empty-output" aria-live="polite">
                    <span
                      className={`token-illustration ${status === 'running' ? 'working' : ''}`}
                      aria-hidden="true"
                    >
                      [PERSON_1]
                    </span>
                    <h3>
                      {status === 'running'
                        ? 'Looking for personal information'
                        : 'Your text, with a little less you.'}
                    </h3>
                    <p>
                      {status === 'running'
                        ? 'The model is running locally. You can cancel at any time.'
                        : 'Detected personal information becomes a token. Everything around it stays exactly as you wrote it.'}
                    </p>
                  </div>
                )}
              </section>
            </div>
            {result && (
              <section className="panel findings">
                <div className="panel-heading">
                  <div>
                    <span className="micro-label">03 / INSPECT</span>
                    <h2>What changed</h2>
                  </div>
                  <span className="subtle">
                    {new Set(result.spans.map((span) => span.token)).size}{' '}
                    unique tokens
                  </span>
                </div>
                <SourcePreview result={result} />
                {result.spans.length > 0 && (
                  <div className="mapping-list">
                    {[
                      ...new Map(
                        result.spans.map((span) => [span.token, span]),
                      ).values(),
                    ].map((span) => (
                      <div className="mapping" key={span.token}>
                        <span>{span.text}</span>
                        <span aria-hidden="true">→</span>
                        <code>{span.token}</code>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="panel evaluation-panel">
            <div className="panel-heading">
              <div>
                <span className="micro-label">MEASURE BEFORE SCALING UP</span>
                <h2>Does the small model find the PII?</h2>
              </div>
              <button
                className="button primary"
                disabled={status !== 'ready'}
                onClick={() => void evaluate()}
              >
                Run {fixtures.length} examples <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p className="evaluation-description">
              Run the same labelled, invented passages sequentially. A correct
              detection must match both the exact span and its category. This is
              a small diagnostic set, not a general accuracy benchmark.
            </p>
            {activeEvaluation && (
              <div className="evaluation-progress" aria-live="polite">
                <strong>
                  Running case {rows.length + 1} of {fixtures.length}:
                </strong>{' '}
                {activeEvaluation.name}. {rows.length} previous{' '}
                {rows.length === 1 ? 'case has' : 'cases have'} been recorded;
                failures do not stop this run.
              </div>
            )}
            <div className="metrics">
              <div>
                <span className="micro-label">CORRECT / EXPECTED</span>
                <strong>
                  {rows.some((row) => row.score)
                    ? `${total.correct} / ${total.expected}`
                    : '—'}
                </strong>
              </div>
              <div>
                <span className="micro-label">EXTRA DETECTIONS</span>
                <strong>
                  {rows.some((row) => row.score) ? total.extra : '—'}
                </strong>
              </div>
              <div>
                <span className="micro-label">CASES PROCESSED</span>
                <strong>
                  {rows.length} / {fixtures.length}
                </strong>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Example</th>
                    <th>Correct</th>
                    <th>Missed</th>
                    <th>Extra</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures.map((fixture) => {
                    const row = rows.find((item) => item.name === fixture.name);
                    return (
                      <tr key={fixture.name}>
                        <td>
                          {fixture.name}
                          {row?.diagnostics && (
                            <ResponseDetails diagnostics={row.diagnostics} />
                          )}
                          {row?.output !== undefined && (
                            <details className="case-details">
                              <summary>Inspect result</summary>
                              <pre>{row.output}</pre>
                              <p>
                                Expected:{' '}
                                {fixture.expected
                                  .map(
                                    (entity) =>
                                      `${entity.category}: ${entity.text}`,
                                  )
                                  .join(' · ') || 'No entities'}
                              </p>
                              <p>
                                Detected:{' '}
                                {row.detections
                                  ?.map(
                                    (entity) =>
                                      `${entity.category}: ${entity.text}`,
                                  )
                                  .join(' · ') || 'No entities'}
                              </p>
                            </details>
                          )}
                          {row?.error && (
                            <span className="case-error">
                              {status === 'evaluating'
                                ? 'Recorded failure — run continues: '
                                : 'Failed: '}
                              {row.error}
                            </span>
                          )}
                        </td>
                        <td>
                          {row?.score
                            ? `${row.score.correct}/${row.score.expected}`
                            : '—'}
                        </td>
                        <td>{row?.score?.missed ?? '—'}</td>
                        <td>{row?.score?.extra ?? '—'}</td>
                        <td>
                          {row?.durationMs !== undefined
                            ? `${(row.durationMs / 1000).toFixed(2)}s`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="evaluation-footer">
              <span>
                {evalModel
                  ? `Results: ${evalModel}${rows.length < fixtures.length || rows.some((row) => row.error) ? ' · incomplete run' : ''}`
                  : 'Load a model to run the evaluation.'}
              </span>
              <button
                className="button secondary small"
                disabled={!rows.length || busy}
                onClick={exportReport}
              >
                Export results
              </button>
            </div>
          </section>
        )}

        <aside className="principles" aria-label="How this experiment works">
          <div>
            <span className="principle-number">01</span>
            <h3>Local by design</h3>
            <p>
              The model downloads to your device. Your input and output stay in
              this page’s memory.
            </p>
          </div>
          <div>
            <span className="principle-number">02</span>
            <h3>Exact replacements</h3>
            <p>
              The model identifies text. Application logic inserts tokens and
              preserves everything else.
            </p>
          </div>
          <div>
            <span className="principle-number">03</span>
            <h3>An experiment, measured</h3>
            <p>
              Small models can miss PII. Inspect the highlights and compare
              results on the evaluation page.
            </p>
          </div>
        </aside>
      </main>
      <footer>
        <span>
          PII LAB <span className="footer-divider">/</span> A browser inference
          experiment
        </span>
        <span>WebLLM · Qwen3 · No inference server</span>
      </footer>
    </>
  );
}
