import { blankXml, clampTitle, makeFile, slugify, toXml, TITLE_MAX } from './drawioFile';
import { titleFilename } from './download';
import { lastOpen, shellTiming, type OpenTiming } from './perf';
import { pretty, titleOf, uniqueSlug } from './savedWork';
import { prefetchUrls, SLOW_AFTER_MS, stageText, warmupAllowed } from './warmup';

/**
 * `?selftest=1` diagnostics: the host's smoke test. Pure and offline (never a network call), so it
 * also runs in Node (test/client.test.mjs).
 */
export interface SelfTest {
  ok: boolean;
  app: 'pandaplan-draw';
  version: string;
  storage: string;
  basePath: string;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  /**
   * Measured in this browser, never estimated. `shell`: this page's own navigation timing.
   * `lastOpen`: the last diagram opened in this tab (open one, then load ?selftest=1 in the same tab).
   */
  timings: { shell: { domReadyMs: number; loadMs: number | null } | null; lastOpen: OpenTiming | null };
}

export function runSelfTest(version: string, basePath: string): SelfTest {
  const checks: SelfTest['checks'] = [];
  const check = (name: string, fn: () => true | string) => {
    try {
      const r = fn();
      checks.push(r === true ? { name, ok: true } : { name, ok: false, detail: r });
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const T = 'PR# 123 – QC Report';

  check('slug is the storage key', () => slugify(T) === 'pr-123-qc-report' || slugify(T));
  check('title keeps capitals and punctuation', () => titleOf({ name: slugify(T), title: clampTitle(T) }) === T || 'title changed');
  check('old files fall back to pretty(slug)', () => titleOf({ name: 'q4-roadmap', title: '' }) === pretty('q4-roadmap') || 'no fallback');
  check(`title clamped to ${TITLE_MAX} code points`, () => {
    const t = clampTitle('🐼'.repeat(TITLE_MAX + 5));
    return (Array.from(t).length === TITLE_MAX && !/[\uD800-\uDBFF]$/.test(t)) || `length ${Array.from(t).length}`;
  });
  check('uniqueSlug avoids taken names', () => uniqueSlug(`${T} copy`, ['pr-123-qc-report-copy']) === 'pr-123-qc-report-copy-2' || 'collision');
  check('saved payload carries the title', () => {
    const f = makeFile('pr-123-qc-report', blankXml(), T);
    return (f.title === T && f.name === 'pr-123-qc-report' && toXml(JSON.parse(JSON.stringify(f))).startsWith('<mxfile')) || 'payload';
  });
  check('download name keeps the title, filesystem-safe', () => {
    const n = titleFilename('Q&A: Final — v2 (Draft)', '.drawio');
    return n === 'Q&A Final — v2 (Draft).drawio' || n;
  });
  check('editor warm-up is skipped on Save-Data', () =>
    (!warmupAllowed({ connection: { saveData: true } }) && warmupAllowed({ connection: {} }) && warmupAllowed(undefined)) || 'saveData ignored',
  );
  check('prefetch: same-origin draw.io files only, never its no-store page', () => {
    const u = prefetchUrls();
    const ok = u.length > 0 && u.every((x) => x.startsWith('/drawio/') && !x.endsWith('/') && !x.endsWith('index.html')) && u.includes('/drawio/js/app.min.js');
    return ok || u.join(', ');
  });
  check('loader names the stage in plain words', () => {
    const ok = stageText('preparing', T) === 'Preparing the editor…' && stageText('opening', T) === `Opening ${T}…` && SLOW_AFTER_MS === 8000;
    return ok || `${stageText('preparing', T)} / ${stageText('opening', T)}`;
  });
  check('localStorage available', () => {
    if (typeof localStorage === 'undefined') return 'no localStorage';
    localStorage.setItem('pandadraw.selftest', '1');
    localStorage.removeItem('pandadraw.selftest');
    return true;
  });

  return {
    ok: checks.every((c) => c.ok),
    app: 'pandaplan-draw',
    version,
    storage: 'cloud (R2 via /api/draw) + localStorage',
    basePath,
    checks,
    timings: { shell: shellTiming(), lastOpen: lastOpen() },
  };
}
