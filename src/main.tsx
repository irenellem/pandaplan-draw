import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readTheme } from './lib/theme';
import './index.css';
import './workspace.css';

// Before the first paint, so a saved Dark choice never flashes light.
applyTheme(readTheme());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
