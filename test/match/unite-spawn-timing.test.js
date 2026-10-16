import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { buildUniteWave } from '../../server/match/waves.js';
import { DATA } from './harness.js';

const gd = new GameData(DATA, 'mode_multi_normal');
const WALK = 'enemy_1422_lrsldr';
const FLY = 'enemy_1005_yokai';
const leak = (owner, index, extra = {}) => ({
  enemyKey: WALK,
  sourcePlayerId: owner,
  mods: { marker: `${owner}:${index}`, atk: 1.2 },
  ...extra,
});
const withoutTime = ({ time, ...spawn }) => spawn;

for (const helpers of [1, 2]) {
  test(`联防 ${helpers} helpers: compresses all owner and motion groups proportionally without losing spawn data`, () => {
    const leaked = [
      ...Array.from({ length: 40 }, (_, i) => leak('p0', i)),
      ...Array.from({ length: 25 }, (_, i) => leak('p1', i, { enemyKey: FLY })),
      ...Array.from({ length: 35 }, (_, i) => leak('p2', i, { isToken: true })),
      ...Array.from({ length: 30 }, (_, i) => leak('p3', i, { enemyKey: FLY, isToken: true })),
      leak('p4', 0, { tag: 'bounty', bounty: { coins: 3, ownerPlayerId: 'p4' } }),
    ];
    const snapshot = structuredClone(leaked);
    const raw = buildUniteWave(gd, leaked, helpers, 1000);
    const wave = buildUniteWave(gd, leaked, helpers, 60);
    const first = raw.spawns[0].time;
    const last = raw.spawns.at(-1).time;
    assert.ok(last > 36);
    assert.equal(wave.spawns.length, leaked.length);
    assert.equal(wave.spawns[0].time, first);
    assert.equal(wave.spawns.at(-1).time, 36);
    assert.deepEqual(wave.spawns.map(withoutTime), raw.spawns.map(withoutTime));
    assert.deepEqual(wave.routes, raw.routes);
    assert.equal(wave.templateId, raw.templateId);
    const factor = (36 - first) / (last - first);
    wave.spawns.forEach((spawn, i) => {
      assert.ok(Math.abs(spawn.time - (first + (raw.spawns[i].time - first) * factor)) < 1e-9);
      assert.ok(spawn.time <= 36);
      if (i) assert.ok(spawn.time >= wave.spawns[i - 1].time);
    });
    assert.deepEqual(leaked, snapshot);
  });
}

test('联防 spawn schedules within sixty percent of the limit retain their original times', () => {
  const leaked = [leak('p0', 0), leak('p0', 1), leak('p1', 0, { enemyKey: FLY })];
  for (const helpers of [1, 2]) {
    const raw = buildUniteWave(gd, leaked, helpers, 1000);
    assert.ok(raw.spawns.at(-1).time <= 36);
    assert.deepEqual(buildUniteWave(gd, leaked, helpers, 60), raw);
    assert.deepEqual(buildUniteWave(gd, leaked, helpers, raw.spawns.at(-1).time / 0.6), raw);
  }
});

test('联防 tiny time limits scale the whole schedule when the first spawn exceeds the budget', () => {
  const leaked = Array.from({ length: 6 }, (_, i) => leak('p0', i));
  const raw = buildUniteWave(gd, leaked, 2, 1000);
  const wave = buildUniteWave(gd, leaked, 2, 0.1);
  assert.ok(raw.spawns[0].time > 0.06);
  assert.equal(wave.spawns.at(-1).time, 0.06);
  assert.deepEqual(wave.spawns.map(withoutTime), raw.spawns.map(withoutTime));
  wave.spawns.forEach((spawn, i) => {
    assert.ok(spawn.time >= 0 && spawn.time <= 0.06);
    assert.ok(Math.abs(spawn.time - raw.spawns[i].time * 0.06 / raw.spawns.at(-1).time) < 1e-9);
  });
});

test('联防 invalid limits use sixty seconds and empty waves stay empty', () => {
  const leaked = Array.from({ length: 40 }, (_, i) => leak('p0', i));
  const normal = buildUniteWave(gd, leaked, 1, 60);
  for (const limit of [undefined, null, 0, -1, Infinity, NaN]) assert.deepEqual(buildUniteWave(gd, leaked, 1, limit), normal);
  assert.deepEqual(buildUniteWave(gd, [], 1, 0.1).spawns, []);
});
