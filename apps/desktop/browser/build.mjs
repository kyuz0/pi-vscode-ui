// Build against the same FrostPi source and lockfile as the VS Code extension.
import { build as bundle } from 'esbuild';
import { build as render } from 'vite';
import { piExtensionNames } from '../scripts/packaging.mjs';
import { resolve } from 'node:path';
const app = resolve(import.meta.dirname, '..');
const out = resolve(app, 'dist/web');
await bundle({
  entryPoints: [resolve(import.meta.dirname, 'server.mjs')],
  outfile: resolve(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
});
for (const name of piExtensionNames) {
  await bundle({
    entryPoints: [resolve(app, '../pi-client/pi-extensions', name + '.ts')],
    outfile: resolve(out, 'pi-extensions', name + '.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });
}
await render({
  configFile: resolve(app, 'vite.config.ts'),
  root: import.meta.dirname,
  build: { outDir: resolve(out, 'public') },
});
// The upstream Vite plugin stages Mermaid beside its normal desktop entry.
const { cp } = await import('node:fs/promises');
await cp(resolve(app, 'dist/renderer/vendor'), resolve(out, 'public/vendor'), {
  recursive: true,
});
