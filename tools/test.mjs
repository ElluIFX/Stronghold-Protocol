import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED = new Set(['fixtures', 'helpers', 'golden', 'node_modules', 'coverage', 'dist', 'build', 'out']);

/** Discover ordinary *.test.js files without following links or entering fixture and generated directories. */
export function discoverTests(root = ROOT) {
  const start = path.join(root, 'test');
  const stat = fs.lstatSync(start);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('test/ must be an ordinary directory');
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(file);
    }
  };
  visit(start);
  return files.map(file => file.split(path.sep).join('/')).sort();
}

export function main(root = ROOT) {
  if (process.env.NODE_TEST_CONTEXT !== undefined) throw new Error('The test entry must run outside a Node test child process');
  const files = discoverTests(root);
  if (!files.length) throw new Error('No *.test.js files found in test/');
  // Programmatic files avoid Windows command-line length limits and Node's broader implicit test discovery.
  const abort = new AbortController();
  const stop = signal => { process.exitCode = signal === 'SIGINT' ? 130 : 143; abort.abort(); };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const tests = run({ concurrency: 1, files, signal: abort.signal });
  tests.on('test:fail', () => { if (!process.exitCode) process.exitCode = 1; });
  tests.on('error', error => { console.error(error); if (!process.exitCode) process.exitCode = 1; });
  tests.once('end', () => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  });
  tests.compose(spec).pipe(process.stdout);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
