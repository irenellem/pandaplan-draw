/**
 * Put a real draw.io webapp at test/.drawio/ (gitignored) for test/perf.mjs.
 *
 *   node test/stage-drawio.mjs path/to/draw.war          # the release the Dockerfile pins (best)
 *   node test/stage-drawio.mjs "/Applications/draw.io.app/Contents/Resources/app.asar"
 *
 * The .war is a zip (needs the `unzip` command). The desktop app's app.asar carries the same
 * webapp under drawio/src/main/webapp/; its version may differ from DRAWIO_VERSION by a patch
 * level — test/perf.mjs prints which one it served.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
const out = process.argv[3] || fileURLToPath(new URL('./.drawio/', import.meta.url));
if (!src) {
  console.error('usage: node test/stage-drawio.mjs <draw.war | app.asar> [outDir]');
  process.exit(2);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (src.endsWith('.war') || src.endsWith('.zip')) {
  execFileSync('unzip', ['-q', src, '-d', out], { stdio: 'inherit' });
  rmSync(join(out, 'META-INF'), { recursive: true, force: true });
  rmSync(join(out, 'WEB-INF'), { recursive: true, force: true });
} else if (src.endsWith('.asar')) {
  // asar: [u32 4][u32 headerPickleSize][u32][u32 jsonLength][json header] then file data at 8 + headerPickleSize.
  const PREFIX = 'drawio/src/main/webapp/';
  const fd = openSync(src, 'r');
  const b = Buffer.alloc(16);
  readSync(fd, b, 0, 16, 0);
  const base = 8 + b.readUInt32LE(4);
  const jb = Buffer.alloc(b.readUInt32LE(12));
  readSync(fd, jb, 0, jb.length, 16);
  let n = 0;
  const walk = (node, p) => {
    for (const [k, v] of Object.entries(node.files || {})) {
      const rel = p ? `${p}/${k}` : k;
      if (v.files) walk(v, rel);
      else if (rel.startsWith(PREFIX) && !v.unpacked && !v.link) {
        const buf = Buffer.alloc(v.size);
        readSync(fd, buf, 0, v.size, base + Number(v.offset));
        const dst = join(out, rel.slice(PREFIX.length));
        if (!dst.startsWith(out)) continue;
        mkdirSync(dirname(dst), { recursive: true });
        writeFileSync(dst, buf);
        n++;
      }
    }
  };
  walk(JSON.parse(jb.toString('utf8')), '');
  closeSync(fd);
  if (!n) throw new Error(`no ${PREFIX} in ${src}`);
} else {
  console.error('expected a .war or an .asar');
  process.exit(2);
}
const app = readFileSync(join(out, 'js/app.min.js'), 'utf8');
const v = /EditorUi\.VERSION\s*=\s*"([^"]+)"/.exec(app)?.[1] ?? /VERSION="([0-9.]+)"/.exec(app)?.[1] ?? 'unknown';
console.log(`draw.io ${v} staged at ${out}`);
