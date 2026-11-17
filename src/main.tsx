import { createRoot } from 'react-dom/client';
import './index.css';

/**
 * Placeholder entry point. The real workspace shell (sidebar + canvas + notes drawer) replaces this
 * file once the UI layer is finished; the host, the OTP gate and the deploy pipeline are proven with
 * this screen so nothing else has to be debugged at the same time.
 */
function Boot() {
  return (
    <div style={{ display: 'grid', placeContent: 'center', height: '100%', gap: 10, textAlign: 'center' }}>
      <strong style={{ fontSize: 18 }}>PandaPlan Draw</strong>
      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>
        Host, sign-in and deploy are live. The canvas is being assembled.
      </span>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Boot />);
