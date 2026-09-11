import type { ResponseDiagnostics } from '../inference/types';

export function ResponseDetails({
  diagnostics,
}: {
  diagnostics: ResponseDiagnostics;
}) {
  return (
    <details className="response-details">
      <summary>Inspect model response</summary>
      <p>
        Raw model output may contain personal information. It stays in this
        page’s memory and is not anonymised output.
      </p>
      <dl>
        <div>
          <dt>Model</dt>
          <dd>{diagnostics.model}</dd>
        </div>
        <div>
          <dt>Finish reason</dt>
          <dd>{diagnostics.finishReason ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Output tokens</dt>
          <dd>{diagnostics.outputTokens ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{(diagnostics.durationMs / 1000).toFixed(2)}s</dd>
        </div>
      </dl>
      <pre
        data-testid="raw-response"
        tabIndex={0}
        aria-label="Raw model response"
      >
        {diagnostics.rawContent === null
          ? '(No content returned)'
          : diagnostics.rawContent === ''
            ? '(Empty response)'
            : diagnostics.rawContent}
      </pre>
    </details>
  );
}
