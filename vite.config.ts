import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Served by the static Pages project under /draw/ — every asset URL must carry that prefix.
export default defineConfig({
  // Own hostname now (draw.pandaplan.work) — assets sit at the root.
  base: '/',
  plugins: [tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5188 },
  preview: { port: 4188, strictPort: true },
});
