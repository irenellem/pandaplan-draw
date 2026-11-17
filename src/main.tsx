import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { runSelfTest } from './lib/selftest';
import { applyTheme, readTheme } from './lib/theme';
import './index.css';
import './workspace.css';

// Before the first paint, so a saved Dark choice never flashes light.
applyTheme(readTheme());

const root = createRoot(document.getElementById('root') as HTMLElement);

if (new URLSearchParams(window.location.search).get('selftest') === '1') {
  // The host's smoke test: JSON in <pre id="selftest-json">, no network call, the app is not mounted.
  const result = runSelfTest(__APP_VERSION__, import.meta.env.BASE_URL);
  document.title = result.ok ? 'selftest ok' : 'selftest FAIL';
  root.render(
    <pre id="selftest-json" className="selftest">
      {JSON.stringify(result, null, 2)}
    </pre>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
