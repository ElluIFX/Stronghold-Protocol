import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCustomizations, CUSTOMIZATION_IDS } from '../customizations/install.mjs';
import { rosmontisOps } from '../customizations/build.mjs';
import { applyPatches } from '../shared/plugins/patch.js';
import { getData, ROOT } from '../server/data.js';
import { createPluginRegistry } from '../server/plugins/registry.js';
import { buildContentSet } from '../server/plugins/contentSet.js';
import { createContentSets } from '../server/plugins/contentSets.js';
import { createMatchHosts } from '../server/match/host/index.js';
import { createRng } from '../server/sim/rng.js';
import { duckReplace } from '../server/sim/content/bands/meta.js';
import setupMeta from '../customizations/repeated-strategies/meta/index.js';

function installed(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-bundled-'));
  const pluginsDir = path.join(temporary, 'plugins');
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  installCustomizations({ pluginsDir });
  const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), pluginsDir },
    { scriptMode: 'sandbox', scriptHost: '0.0.0.0' });
  registry.refresh(true);
  return { pluginsDir, registry };
}

test('Rosmontis plugin covers every loadout and preserves upstream records and descriptions', () => {
  const data = getData(), original = structuredClone(data), ops = rosmontisOps(data);
  const generated = JSON.parse(fs.readFileSync(path.join(ROOT, 'customizations/rosmontis-balance/data/patch.json'), 'utf8'));
  assert.deepEqual(generated, { patch: 1, ops });
  const result = applyPatches(data, ops, { pluginId: 'rosmontis-balance' });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(data, original);
  const stats = { maxHp: 1.5, atk: 2, bat: 0.75, def: 2 };
  const validate = (before, after) => {
    for (const [key, factor] of Object.entries(stats)) if (typeof before.stats?.[key] === 'number') {
      assert.equal(after.stats[key], before.stats[key] * factor, key);
    }
    const removeNumbers = record => JSON.stringify(record, (key, value) => typeof value === 'number' ? '<number>' : value);
    assert.equal(removeNumbers(after), removeNumbers(before));
    for (const key of ['skill', 'skills', 'modules', 'potDown', 'statsBase']) {
      if (before[key]) assert.ok(after[key]);
    }
  };
  for (const [id, rec] of Object.entries(data.chess)) if (rec.charId === 'char_391_rosmon') validate(rec, result.data.chess[id]);
  for (const [key, rec] of Object.entries(data.backups.units.char_391_rosmon?.forms || {})) {
    validate(rec, result.data.backups.units.char_391_rosmon.forms[key]);
  }
  const rec = Object.values(data.chess).find(r => r.charId === 'char_391_rosmon');
  const synthetic = { chess: {}, backups: { units: { char_391_rosmon: { forms: { normal: rec } } } } };
  const backupOps = rosmontisOps(synthetic);
  const backup = applyPatches(synthetic, backupOps, { pluginId: 'rosmontis-balance' });
  assert.deepEqual(backup.problems, []);
  validate(rec, backup.data.backups.units.char_391_rosmon.forms.normal);
  const twice = applyPatches(result.data, ops, { pluginId: 'rosmontis-balance' });
  assert.deepEqual(twice.data, result.data);
});

test('Rosmontis scales all skill coefficients, module attributes and potential deltas', () => {
  const stats = { maxHp: 1000, atk: 100, def: 50, bat: 2, cost: 10 };
  const bb = { extra_atk_scale: 0.5, append_atk_scale: 1.5, 'attack@append_atk_scale': 2.5, atk: 0.4, def: 0.3, duration: 20 };
  const form = { stats, statsBase: stats, skill: { bb }, skills: [1, 2, 3].map(index => ({ index, bb })),
    modules: [{ attr: stats }], potDown: { 1: { 'stats.atk': -15, 'statsBase.bat': -0.1, 'skill.bb.atk': 0.1 } } };
  const input = { chess: {}, backups: { units: { char_391_rosmon: { forms: { normal: form, elite: form } } } } };
  const result = applyPatches(input, rosmontisOps(input), { pluginId: 'rosmontis-balance' });
  assert.deepEqual(result.problems, []);
  for (const actual of Object.values(result.data.backups.units.char_391_rosmon.forms)) {
    const expectedStats = { maxHp: 1500, atk: 200, def: 100, bat: 1.5, cost: 10 };
    assert.deepEqual(actual.stats, expectedStats);
    assert.deepEqual(actual.statsBase, expectedStats);
    assert.deepEqual(actual.modules[0].attr, expectedStats);
    for (const skill of [actual.skill, ...actual.skills]) assert.deepEqual(skill.bb, {
      extra_atk_scale: 1, append_atk_scale: 3, 'attack@append_atk_scale': 5, atk: 0.8, def: 0.6, duration: 20,
    });
    assert.deepEqual(actual.potDown, { 1: { 'stats.atk': -30, 'statsBase.bat': -0.07500000000000001, 'skill.bb.atk': 0.1 } });
  }
});

test('Ducklord plugin preserves the core replacement results and random state for every holder', () => {
  const handlers = new Map();
  setupMeta({ meta: { register: (key, handler) => handlers.set(key, handler) } });
  const handler = handlers.get('global:bands_ducklord');
  const make = (seed, count, overrides) => {
    const p = { enemylist: 'duck1,duck2', min: 0, max: 2, minweight: 0.1, maxweight: 0.9, round: 5, ...overrides };
    const gd = { band: () => ({ buffs: [{ key: 'round_start_all_player_change_enemy_2', bb: p }] }),
      enemy: key => ({ key, rank: key === 'boss' ? 'BOSS' : 'NORMAL', stats: { motion: key === 'fly' ? 'FLY' : 'WALK' } }) };
    const own = { playerId: 'p1', gd, round: 5, bandId: () => count ? 'band_ducklord' : 'other', rng: createRng(seed),
      teammates: () => Array.from({ length: Math.max(0, count - 1) }, () => ({ bandId: () => 'band_ducklord' })) };
    return { own, p };
  };
  const source = [{ enemyKey: 'normal', time: 0, count: 40, interval: 0.3, routeIndex: 0, mods: { slot: 2 } },
    { enemyKey: 'normal', time: 1, count: 30, interval: 0.5, routeIndex: 1 },
    { enemyKey: 'boss', time: 3, count: 1, routeIndex: 0 }, { enemyKey: 'fly', time: 4, count: 1, routeIndex: 0 }];
  const routes = [{ end: [3, 2] }, { end: [3, 18] }];
  for (const count of [0, 1, 2, 8]) for (const side of [null, 'L', 'R']) for (let seed = 1; seed <= 20; seed++) {
    const reference = make(seed, count), plugin = make(seed, count);
    const expected = structuredClone(source), ev = { kind: side ? 'boss' : 'normal', spawns: structuredClone(source), routes, side };
    for (let i = 0; i < count; i++) duckReplace(reference.own, expected, reference.p, 'p1', { routes, side });
    handler.onBattleStart(plugin.own, ev);
    assert.deepEqual(ev.spawns, expected);
    assert.equal(plugin.own.rng(), reference.own.rng());
  }
});

test('bundled installation is repeatable, verifies locks and preserves an existing owner policy', t => {
  const { pluginsDir, registry } = installed(t);
  for (const id of CUSTOMIZATION_IDS) {
    const p = registry.plugin(id);
    assert.equal(p.status, 'loaded', JSON.stringify(p));
    assert.equal(p.class === 'script' ? p.script.execution : 'sandbox', 'sandbox');
  }
  const policy = { rooms: 'host', default: [...CUSTOMIZATION_IDS], allow: ['*'] };
  fs.writeFileSync(path.join(pluginsDir, 'config.json'), JSON.stringify(policy));
  const locks = CUSTOMIZATION_IDS.map(id => fs.readFileSync(path.join(pluginsDir, id, 'plugin.lock.json'), 'utf8'));
  installCustomizations({ pluginsDir });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pluginsDir, 'config.json'), 'utf8')), policy);
  assert.deepEqual(CUSTOMIZATION_IDS.map(id => fs.readFileSync(path.join(pluginsDir, id, 'plugin.lock.json'), 'utf8')), locks);
  assert.equal(fs.existsSync(path.join(pluginsDir, '_replaced')), false);
  fs.writeFileSync(path.join(pluginsDir, 'config.json'), JSON.stringify({ rooms: 'host', default: [], limits: { maxSets: 8 } }));
  installCustomizations({ pluginsDir });
  const migrated = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'config.json'), 'utf8'));
  assert.deepEqual(migrated.default, CUSTOMIZATION_IDS);
  assert.equal(migrated.rooms, 'host');
  assert.deepEqual(migrated.limits, { maxSets: 8 });
  assert.equal(migrated.classes.script, true);
  const file = path.join(pluginsDir, 'repeated-strategies', 'sim', 'index.js');
  fs.appendFileSync(file, '\n// Changed installation bytes.\n');
  installCustomizations({ pluginsDir });
  assert.ok(fs.existsSync(path.join(pluginsDir, '_replaced')));
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(ROOT, 'customizations/repeated-strategies/sim/index.js'), 'utf8'));
});

test('production sandbox executes repeated strategies and numeric data in its permission child', { timeout: 30000 }, async t => {
  const old = process.env.SP_PLUGIN_SCRIPTS;
  process.env.SP_PLUGIN_SCRIPTS = 'sandbox';
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = old; });
  const { registry } = installed(t);
  const built = buildContentSet({ registry, ids: [...CUSTOMIZATION_IDS] });
  assert.deepEqual(built.problems, []);
  const contents = createContentSets({ registry, vanillaData: getData() });
  t.after(() => contents.close());
  const resolved = contents.resolve([...CUSTOMIZATION_IDS]);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const cs = resolved.set.cs;
  const logs = [];
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, line => logs.push(`${level}: ${line}`)]));
  const hosts = createMatchHosts({ contents, log, options: {
    matchModule: fileURLToPath(new URL('./helpers/customizedMatchProbe.js', import.meta.url)),
  } });
  t.after(() => hosts.close());
  const messages = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const match = hosts.create(cs, { cs, requireCs: true,
    roomCode: 'PROBE', seats: [], send() {}, onEnd(result) { complete({ ended: result, messages, logs }); },
    broadcast(message) { messages.push(message); if (message.t === 'm.result') complete(message); } });
  match.start();
  const timer = setTimeout(() => complete({ timeout: true, messages, logs }), 20000);
  const result = await done;
  clearTimeout(timer);
  assert.equal(result.timeout, undefined, JSON.stringify(result));
  assert.equal(hosts._host(cs).transport, 'process');
  assert.deepEqual(result.errors, []);
  assert.equal(result.ducks, 16);
  assert.equal(result.bountyOwners.length, 1);
  assert.equal(result.medicCount, 1);
  assert.equal(result.hpMultiplier, 2.75);
  assert.equal(result.atkMultiplier, 2.75);
  const ros = getData().chess.chess_char_6_12_a.stats;
  for (const [key, factor] of Object.entries({ maxHp: 1.5, atk: 2, bat: 0.75, def: 2 })) {
    assert.equal(result.ros[key], ros[key] * factor);
  }
});

test('bundled sandbox completes five- and eight-player games without errors or cross-match state', { timeout: 180000 }, async t => {
  const old = process.env.SP_PLUGIN_SCRIPTS;
  process.env.SP_PLUGIN_SCRIPTS = 'sandbox';
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = old; });
  const { registry } = installed(t);
  const contents = createContentSets({ registry, vanillaData: getData() });
  t.after(() => contents.close());
  const resolved = contents.resolve([...CUSTOMIZATION_IDS]);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const cs = resolved.set.cs;
  const hosts = createMatchHosts({ contents, options: { virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  t.after(() => hosts.close());
  for (const count of [5, 8]) {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const match = hosts.create(cs, { cs, requireCs: true, roomCode: `BOT${count}`, mode: 'coop', difficulty: 'NORMAL',
      modeId: 'mode_multi_normal', seed: 7, matchNo: count, spectators: [],
      seats: Array.from({ length: count }, (_, seat) => ({ seat, playerId: `bot_${seat}`, name: 'Bot', isBot: true, connected: true })),
      send() {}, broadcast() {}, onEnd: finish });
    match.start();
    const result = await done;
    assert.equal(typeof result.victory, 'boolean', JSON.stringify(result));
    const diag = await match.diag();
    assert.equal(diag.errorCount, 0, JSON.stringify(diag.errors));
    assert.equal(diag.cs, cs);
    match.dispose();
    assert.equal(hosts.stats().matches, 0);
  }
});
