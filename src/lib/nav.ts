/**
 * The app's two views and their URLs. One page load serves both; switching is History API + view
 * state, never a navigation, so the editor frame and the list survive every switch.
 *
 *   /                      home: the saved-work list
 *   /f/<slug>              editor, a file in no folder
 *   /f/<folder>/<slug>     editor, a file in a folder
 *
 * nginx (`location /` → /index.html) and the test stubs already fall back to the shell for any path.
 */
export type View = 'home' | 'editor';

export type Route = { view: 'home' } | { view: 'editor'; name: string; folder: string };

const enc = encodeURIComponent;

function dec(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** The editor URL for a file. Slugs are URL-safe already; encoding is belt and braces. */
export function pathFor(f: { name: string; folder: string }): string {
  return f.folder ? `/f/${enc(f.folder)}/${enc(f.name)}` : `/f/${enc(f.name)}`;
}

/** Anything that is not a well-formed `/f/…` path is home. */
export function parsePath(pathname: string): Route {
  const m = /^\/f\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return { view: 'home' };
  const a = dec(m[1]);
  const b = m[2] === undefined ? undefined : dec(m[2]);
  if (!a || b === null || b === '') return { view: 'home' };
  return b === undefined ? { view: 'editor', name: a, folder: '' } : { view: 'editor', name: b, folder: a };
}

/** history.state we write when the editor was entered from home, so "Files" can go *back* to it. */
export const FROM_HOME = 'pandadraw:from-home';
