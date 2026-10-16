import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT, discoverTests } from '../tools/test.mjs';

test('discovery includes root and nested test files, excluding helpers, fixtures, outputs and links', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = rel => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'throw new Error("Discovery must not execute this file");\n');
  };
  for (const rel of [
    'test/root.test.js', 'test/match/nested.test.js', 'test/ui/browser.e2e.test.js',
    'test/helper.js', 'test/match/harness.js', 'test/match/example.test.mjs',
    'test/fixtures/forge/kits/boom.js', 'test/fixtures/hidden.test.js', 'test/plugins/fixtures/hidden.test.js',
    'test/helpers/hidden.test.js', 'test/golden/hidden.test.js', 'test/node_modules/hidden.test.js',
    'test/coverage/hidden.test.js', 'test/dist/hidden.test.js', 'test/build/hidden.test.js', 'test/out/hidden.test.js',
    'test/.cache/hidden.test.js', 'outside/linked.test.js',
  ]) put(rel);
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'test', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'outside', 'linked.test.js'), path.join(root, 'test', 'linked.test.js'));
  assert.deepEqual(discoverTests(root).map(file => path.relative(root, file).split(path.sep).join('/')), [
    'test/match/nested.test.js', 'test/root.test.js', 'test/ui/browser.e2e.test.js',
  ]);
  fs.renameSync(path.join(root, 'test'), path.join(root, 'original'));
  fs.symlinkSync(path.join(root, 'original'), path.join(root, 'test'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => discoverTests(root), /ordinary directory/);
});

test('the entry discovers every repository *.test.js file, including top-level suites', () => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'test'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(file => file.endsWith('.test.js') && fs.existsSync(path.join(ROOT, file)));
  const found = discoverTests().map(file => path.relative(ROOT, file).split(path.sep).join('/'));
  assert.deepEqual(found, [...new Set(tracked)].sort());
  assert.ok(found.includes('test/ci.test.js'));
  assert.ok(found.includes('test/test-entry.test.js'));
  assert.ok(found.includes('test/match/fullmatch-coop-8seats.test.js'));
  assert.equal(found.some(file => /(?:^|\/)(?:fixtures|helpers)\//.test(file)), false);
  assert.equal(found.includes('test/match/fullmatchLarge.js'), false);
});

for (const fails of [false, true]) test(`the programmatic runner exits ${fails ? 'nonzero for a failed test' : 'zero for passing tests'} without executing fixtures`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  fs.mkdirSync(path.join(root, 'test', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'sample.test.js'),
    `import test from 'node:test'; test('sample', () => { ${fails ? 'throw new Error("Expected test failure");' : ''} });\n`);
  fs.writeFileSync(path.join(root, 'test', 'fixtures', 'boom.js'), 'throw new Error("Fixture was executed");\n');
  const entry = new URL('../tools/test.mjs', import.meta.url).href;
  const source = `import { main } from ${JSON.stringify(entry)}; main(${JSON.stringify(root)});`;
  const probe = path.join(root, 'probe.mjs');
  fs.writeFileSync(probe, source);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [probe],
    { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, fails ? 1 : 0, child.stdout + child.stderr);
  assert.doesNotMatch(child.stdout + child.stderr, /Fixture was executed/);
});

test('the CLI rejects an inherited test context instead of reporting a silent pass', () => {
  const child = spawnSync(process.execPath, [path.join(ROOT, 'tools/test.mjs')], {
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /outside a Node test child process/);
});
