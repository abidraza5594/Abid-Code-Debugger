import { context, build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entries = [
  {
    entryPoints: [resolve(root, 'src/background/service-worker.ts')],
    outfile: resolve(dist, 'background/service-worker.js'),
    format: 'esm',
  },
  {
    entryPoints: [resolve(root, 'src/content/content-script.ts')],
    outfile: resolve(dist, 'content/content-script.js'),
    format: 'iife',
  },
  {
    entryPoints: [resolve(root, 'src/content/inject.ts')],
    outfile: resolve(dist, 'content/inject.js'),
    format: 'esm',
  },
  {
    entryPoints: [resolve(root, 'src/devtools/devtools.ts')],
    outfile: resolve(dist, 'devtools/devtools.js'),
    format: 'iife',
  },
  {
    entryPoints: [resolve(root, 'src/devtools/panel.ts')],
    outfile: resolve(dist, 'devtools/panel.js'),
    format: 'iife',
  },
];

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
  },
};

async function copyPublic() {
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, 'public'), dist, { recursive: true });
}

if (watch) {
  await rm(dist, { recursive: true, force: true });
  await copyPublic();
  const contexts = await Promise.all(entries.map((entry) => context({ ...common, ...entry })));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`[extension] watching ${root}`);
} else {
  await rm(dist, { recursive: true, force: true });
  await copyPublic();
  await Promise.all(entries.map((entry) => build({ ...common, ...entry, minify: true })));
}
