import { useEffect, useState } from 'react';
import {
  TransformersJsExperiment,
  WebLlmExperiment,
} from './experiments/BrowserModelExperiment';

type Route =
  | 'home'
  | 'webllm-workbench'
  | 'webllm-evaluation'
  | 'transformersjs-workbench'
  | 'transformersjs-evaluation';

function routeFromHash(hash: string): Route {
  if (hash === '#/transformersjs/evaluation')
    return 'transformersjs-evaluation';
  if (hash === '#/transformersjs') return 'transformersjs-workbench';
  if (hash === '#/webllm/evaluation') return 'webllm-evaluation';
  if (hash === '#/webllm') return 'webllm-workbench';
  return 'home';
}

function Welcome() {
  return (
    <main className="welcome">
      <section className="welcome-intro" aria-labelledby="welcome-title">
        <p className="eyebrow">SMALL MODELS, PERSONAL DATA</p>
        <h1 id="welcome-title">Browser-local PII experiments</h1>
        <p>
          Compare ways to identify personal information in the browser while
          deterministic code preserves every character outside replacements.
        </p>
      </section>

      <section className="experiment-grid" aria-label="Experiments">
        <a className="experiment-card available" href="#/webllm">
          <span className="experiment-number">EXPERIMENT 001</span>
          <h2>WebLLM</h2>
          <p>
            Run Qwen3 through WebGPU, inspect exact-span replacements, and
            evaluate the model against invented fixtures.
          </p>
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>WebLLM</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Available</dd>
            </div>
          </dl>
          <span className="card-action">
            Open experiment <span aria-hidden="true">↗</span>
          </span>
        </a>

        <a className="experiment-card available" href="#/transformersjs">
          <span className="experiment-number">EXPERIMENT 002</span>
          <h2>Transformers.js</h2>
          <p>
            Run the same Qwen3 models and fixtures through ONNX Runtime Web for
            a controlled runtime comparison.
          </p>
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>Transformers.js</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Available</dd>
            </div>
          </dl>
          <span className="card-action">
            Open experiment <span aria-hidden="true">↗</span>
          </span>
        </a>

        <article className="experiment-card planned">
          <span className="experiment-number">EXPERIMENT 003</span>
          <h2>Gemini Nano</h2>
          <p>
            A future comparison using the browser’s built-in model APIs where
            supported.
          </p>
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>Browser built-in AI</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Planned</dd>
            </div>
          </dl>
        </article>
      </section>
    </main>
  );
}

export function App() {
  const [route, setRoute] = useState(() => routeFromHash(location.hash));

  useEffect(() => {
    const navigate = () => setRoute(routeFromHash(location.hash));
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  const webLlmPage =
    route === 'webllm-workbench'
      ? 'workbench'
      : route === 'webllm-evaluation'
        ? 'evaluation'
        : null;
  const transformersJsPage =
    route === 'transformersjs-workbench'
      ? 'workbench'
      : route === 'transformersjs-evaluation'
        ? 'evaluation'
        : null;
  const experiment = webLlmPage
    ? {
        number: '001',
        footer: 'WebLLM · Qwen3 · No inference server',
        page: <WebLlmExperiment page={webLlmPage} />,
      }
    : transformersJsPage
      ? {
          number: '002',
          footer: 'Transformers.js · Qwen3 · No inference server',
          page: <TransformersJsExperiment page={transformersJsPage} />,
        }
      : null;

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="PII Lab home">
          <span className="brand-mark">[·]</span> PII Lab
          {experiment && (
            <span className="version">EXPERIMENT {experiment.number}</span>
          )}
        </a>
        <span className="local-badge">
          <span className="dot" /> Browser-local experiments
        </span>
      </header>

      {experiment?.page ?? <Welcome />}

      <footer>
        <span>
          PII LAB <span className="footer-divider">/</span> Browser-local PII
          detection
        </span>
        <span>{experiment?.footer ?? 'Experiments run on your device'}</span>
      </footer>
    </>
  );
}
