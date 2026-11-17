import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Own hostname now (draw.pandaplan.work), served by nginx: assets sit at the root, draw.io at /drawio/.
export default defineConfig({
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
