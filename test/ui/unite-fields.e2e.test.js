// Sequential joint-defense UI: only the active field is observable; all leakers follow it into the next stage.
// The mock can construct either stage with ?uniteStage=1|2 and advances a timeout through advanceUniteStage().
// Opt-in: SP_E2E=1 node --test --test-concurrency=1 test/ui/unite-fields.e2e.test.js
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_CHROME as CHROME, UI_BROWSER_ARGS, cleanupUiBrowser } from '../e2e/ui-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const ENABLED = process.env.SP_E2E === '1' && !!CHROME && existsSync(CHROME);
const VIEWPORTS = { 'phone-min': [640, 360, true], iphone14: [844, 390, true], desktop: [1920, 1080, false] };

describe('sequential joint-defense fields (UI mock, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let server;
  let browser;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...UI_BROWSER_ARGS] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  afterEach(() => cleanupUiBrowser(browser));

  async function open(viewport, stage, client) {
    const [width, height, touch] = VIEWPORTS[viewport];
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, isLandscape: true });
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(message.text());
    });
    await page.goto(`${server.url}/dev/game-mock.html?shot=1&render=fallback&players=8&phase=UNITE&variant=leaker&uniteStage=${stage}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.team__row', { timeout: 20000 });
    if (client) await page.evaluate(() => globalThis.__MOCK__.mutate(state => { state.pub.combatMode = 'client'; }));
    await page.waitForFunction(fieldId => globalThis.__MOCK__?.store.get().match.field?.fieldId === fieldId, {}, stage === 1 ? 'u' : 'u2');
    await page.evaluate(() => document.fonts.ready);
    return { page, problems };
  }

  const facts = page => page.evaluate(() => {
    const mock = globalThis.__MOCK__;
    const state = mock.S();
    const field = mock.store.get().match.field;
    return {
      active: state.pub.unite.activeFieldId,
      fields: state.pub.fields.map(f => ({ fieldId: f.fieldId, helpers: f.players, live: f.live })),
      groups: state.pub.unite.fields,
      leakers: state.pub.unite.leakers,
      helping: state.pub.players.filter(p => p.status === 'helping').map(p => p.playerId),
      fieldId: field.fieldId,
      owners: [...new Set(field.units.filter(u => u.kind === 'op').map(u => u.ownerId))],
      extraFieldSwitcher: !!document.querySelector('.chud__fields'),
      overflow: {
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
      },
    };
  });

  function assertStage(state, stage) {
    const active = stage === 1 ? 'u' : 'u2';
    const helpers = stage === 1 ? ['ai_2', 'p3'] : ['p5', 'ai_6'];
    assert.equal(state.active, active);
    assert.equal(state.fieldId, active);
    assert.deepEqual(state.fields, [{ fieldId: active, helpers, live: true }]);
    assert.deepEqual(state.helping, helpers);
    assert.deepEqual(state.owners, helpers);
    assert.equal(state.groups.length, 2);
    for (const group of state.groups) assert.deepEqual(group.leakers, state.leakers, 'every stage receives the same leakers');
    assert.equal(state.extraFieldSwitcher, false, 'inactive fields are never offered for viewing');
    assert.ok(state.overflow.x <= 1 && state.overflow.y <= 1, `no page overflow: ${JSON.stringify(state.overflow)}`);
  }

  for (const viewport of Object.keys(VIEWPORTS)) {
    for (const client of [false, true]) {
      const mode = client ? 'client' : 'server';
      test(`${viewport}, ${mode}: both stages construct with all leakers on the active field`, { timeout: 120000 }, async () => {
        for (const stage of [1, 2]) {
          const { page, problems } = await open(viewport, stage, client);
          try {
            assertStage(await facts(page), stage);
            const inactive = stage === 1 ? 'u2' : 'u';
            const refusal = await page.evaluate(async fieldId => {
              const { net } = await import('/js/net.js');
              try { await net.request('g.watch', { fieldId }); return null; } catch (error) { return error.code; }
            }, inactive);
            assert.equal(refusal, 'BAD_TARGET', 'the mock applies the active-field watch rule');
            await page.screenshot({ path: path.join(OUT, `unite-${viewport}-${mode}-stage${stage}.png`) });
            assert.deepEqual(problems, []);
          } finally { await page.close(); }
        }
      });

      test(`${viewport}, ${mode}: a timeout carries all survivor counts to stage two and restarts its deadline`, { timeout: 120000 }, async () => {
        const { page, problems } = await open(viewport, 1, client);
        try {
          const result = await page.evaluate(() => {
            const mock = globalThis.__MOCK__;
            const counts = () => Object.fromEntries(mock.S().pub.unite.leakers.map(id => [id, mock.S().pub.players.find(p => p.playerId === id).uniteLeft]));
            const before = counts();
            mock.S().pub.deadline = Date.now() - 1000;
            const advanced = mock.advanceUniteStage();
            return { before, after: counts(), advanced, remainingMs: mock.S().pub.deadline - Date.now() };
          });
          assert.equal(result.advanced, true);
          assert.deepEqual(result.after, result.before, 'every surviving leaker count is carried without splitting');
          assert.ok(result.remainingMs >= 35000 && result.remainingMs <= 40000, 'stage two owns a fresh countdown');
          await page.waitForFunction(() => globalThis.__MOCK__.store.get().match.field?.fieldId === 'u2');
          assertStage(await facts(page), 2);
          assert.equal(await page.evaluate(() => globalThis.__MOCK__.advanceUniteStage()), false, 'the last stage cannot restart itself');
          assert.deepEqual(problems, []);
        } finally { await page.close(); }
      });
    }
  }
});
