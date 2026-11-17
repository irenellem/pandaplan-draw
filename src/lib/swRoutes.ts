/**
 * Which cache policy a request gets. The service worker (public/sw.js) implements these same rules;
 * keeping the table here lets the tests pin it without a browser.
 */
export type SwRoute = 'api' | 'assets' | 'editor' | 'shell' | 'bypass';

export function routeFor(pathname: string): SwRoute {
  if (pathname.startsWith('/api/')) return 'api';          // saves and lists: network only, never cached
  if (pathname.startsWith('/assets/')) return 'assets';    // hashed build output: cache first, immutable
  if (pathname.startsWith('/drawio/')) return 'editor';    // the editor's own files: stale while revalidate
  if (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/f/')) return 'shell';
  return 'bypass';
}
