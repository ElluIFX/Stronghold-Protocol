import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const BAND = 'band_ducklord';
const ENEMY = 'enemy_1000_gopro_2';

function setup(count) {
  const h = makeMatch({ mode: 'coop', humans: 8, fake: true }).start();
  h.toPrep(1);
  const players = [...h.m.players.values()];
  players.forEach((p, i) => { p.bandId = i < count ? BAND : 'band_sarkazb'; });
  h.m.round = 5;
  h.m.rngMeta = Object.assign(() => 0, {
    int: n => n - 1,
    pick: values => values[0],
    shuffle: values => [...values],
  });
  assert.ok(h.m.gd.enemy(ENEMY));
  return { h, m: h.m, players };
}

const wave = (routeIndex = 0, count = 100) => [{ enemyKey: ENEMY, time: 0, count, interval: 1, routeIndex }];
const total = spawns => spawns.reduce((n, s) => n + (s.count ?? 1), 0);
const ducks = spawns => spawns.filter(s => s.tag === 'duck');

function dispatch(m, player, kind, spawns, extra = {}) {
  m.dispatch(player, 'onBattleStart', { kind, spawns, input: player.battleInput(), ...extra });
}

test('each live Ducklord holder independently replaces enemies on every player field', () => {
  for (const count of [0, 1, 2, 8]) {
    const { m, players } = setup(count);
    try {
      for (const player of players) {
        const spawns = wave();
        dispatch(m, player, 'normal', spawns);
        assert.equal(ducks(spawns).length, count * 2);
        assert.equal(total(spawns), 100);
        for (const d of ducks(spawns)) assert.deepEqual(d.bounty, { coins: 1, ownerPlayerId: player.playerId });
        assert.equal(new Set(ducks(spawns).map(d => d.time)).size, count * 2, 'each original enemy is replaced at most once');
      }
    } finally { m.dispose(); }
  }
});

test('repeated Ducklord excludes eliminated holders and rounds before activation', () => {
  const { m, players } = setup(8);
  try {
    m.round = 4;
    const early = wave();
    dispatch(m, players[0], 'normal', early);
    assert.equal(ducks(early).length, 0);
    m.round = 5;
    for (const player of players.slice(2)) player.alive = false;
    const spawns = wave();
    dispatch(m, players[0], 'normal', spawns);
    assert.equal(ducks(spawns).length, 4);
    const unite = wave();
    dispatch(m, players[0], 'unite', unite);
    assert.equal(ducks(unite).length, 0, 'joint defense retains the existing enemies');
  } finally { m.dispose(); }
});

test('repeated Ducklord preserves protected spawns and caps replacements to eligible enemies', () => {
  const { m, players } = setup(8);
  try {
    const protectedSpawns = [
      { ...wave()[0], count: 1, tag: 'boss', time: 101 },
      { ...wave()[0], count: 1, tag: 'bounty', time: 102 },
      { ...wave()[0], count: 1, countInTotal: false, time: 103 },
      { ...wave()[0], count: 1, enemyKey: 'enemy_1005_yokai', time: 104 },
    ];
    assert.equal(m.gd.enemy('enemy_1005_yokai').stats.motion, 'FLY');
    const spawns = [...wave(0, 10), ...protectedSpawns];
    dispatch(m, players[0], 'normal', spawns);
    assert.ok(ducks(spawns).length > 0 && ducks(spawns).length < 16);
    assert.equal(total(spawns), 14);
    for (const original of protectedSpawns) assert.ok(spawns.includes(original));
  } finally { m.dispose(); }
});

test('repeated Ducklord in both leader rounds independently replaces only each owner half', () => {
  const { m, players } = setup(8);
  try {
    const routes = [{ end: [3, 2] }, { end: [3, 18] }];
    for (const kind of ['boss', 'hidden']) {
      const spawns = [...wave(0), ...wave(1)];
      dispatch(m, players[0], kind, spawns, { side: 'L', routes });
      assert.equal(ducks(spawns).length, 16);
      assert.ok(ducks(spawns).every(d => d.routeIndex === 0 && d.bounty.ownerPlayerId === players[0].playerId));
      dispatch(m, players[1], kind, spawns, { side: 'R', routes });
      assert.equal(ducks(spawns).length, 32);
      assert.equal(total(spawns), 200);
      assert.equal(ducks(spawns).filter(d => d.routeIndex === 0).length, 16);
      assert.equal(ducks(spawns).filter(d => d.routeIndex === 1 && d.bounty.ownerPlayerId === players[1].playerId).length, 16);
    }
  } finally { m.dispose(); }
});
