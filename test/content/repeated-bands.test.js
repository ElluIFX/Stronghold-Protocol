import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch } from '../match/harness.js';

const unit = (uid = 1) => ({ uid, kind: 'chess', chessId: 'repeat_op', row: 10, col: 4 });
const player = (playerId, seat, bandId, extra = {}) => ({
  playerId, seat, side: seat === 0 ? 'L' : 'R', colOffset: seat === 0 ? 0 : 8,
  units: [unit()], bonds: {}, bandId, ...extra,
});
const defs = { chess: { repeat_op: chessRec({ id: 'repeat_op', stats: { atk: 500, maxHp: 2000 } }) } };
const bonds = (n) => Object.fromEntries(['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip'].slice(0, n)
  .map((id) => [id, { count: 3, active: true, tier: 1, layers: 0 }]));

test('repeated Amiya applies each owner bond count once to that owner units', () => {
  const h = makeBattle({ defs, kind: 'unite', autoFinish: false, players: [
    player('p1', 0, 'band_amiya', { bonds: bonds(3) }),
    player('p2', 1, 'band_amiya', { bonds: bonds(5) }),
  ] });
  h.step();
  for (const [pid, mul] of [['p1', 1.2], ['p2', 1.4]]) {
    const u = h.b.allyUnits.find((a) => a.ownerId === pid && a.kind === 'op');
    assert.equal(u.s.atk, 500 * mul);
    assert.equal(u.s.maxHp, 2000 * mul);
    assert.equal(u.buffs.filter((b) => b.key === 'band:band_amiya').length, 1);
  }
  checkInvariants(h.b);
});

test('repeated Ermengard gives both owners independent three-revive budgets', () => {
  const h = makeBattle({ defs: { ...defs, enemies: { repeat_enemy: enemyRec({ key: 'repeat_enemy', speed: 0, hp: 1e7 }) } },
    kind: 'unite', autoFinish: false, players: [player('p1', 0, 'band_ermengard'), player('p2', 1, 'band_ermengard')],
    enemies: [{ key: 'repeat_enemy', pos: [9, 18] }] });
  h.step();
  const enemy = h.enemies()[0];
  const ops = ['p1', 'p2'].map((pid) => h.b.allyUnits.find((u) => u.ownerId === pid && u.kind === 'op'));
  for (const u of ops) {
    for (let i = 0; i < 3; i++) {
      h.b.dealDamage(enemy, u, { amount: 1e6, type: 'true' });
      assert.ok(u.alive, `${u.ownerId} revive ${i + 1}`);
      assert.equal(u.hp, u.s.maxHp);
    }
    h.b.dealDamage(enemy, u, { amount: 1e6, type: 'true' });
    assert.equal(u.alive, false, `${u.ownerId} exhausted its own budget`);
  }
  checkInvariants(h.b);
});

test('eight repeated Touch strategies spawn one medic per normal field and one per boss half', () => {
  const h = makeMatch({ mode: 'coop', humans: 8, seed: 17, fake: true }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m01');
  const players = [...h.m.players.values()];
  for (const ps of players) {
    ps.bandId = 'band_amedic';
    ps.board.clear();
    ps.recompute();
  }
  const input = (ps, side, colOffset, kind) => {
    const ev = { input: ps.battleInput({ side, colOffset }), kind, round: 1 };
    h.m.dispatch(ps, 'onBattleStart', ev);
    assert.deepEqual(ev.input.contentInfo.matchBands, Array(8).fill('band_amedic'));
    return ev.input;
  };
  const medics = (b) => b.allyUnits.filter((u) => u.kind === 'token' && u.defId === 'char_605_cmedic');
  for (const ps of players) {
    const f = makeBattle({ stageId: h.m.stageId, autoFinish: false, players: [input(ps, 'L', 0, 'normal')] });
    f.step();
    assert.deepEqual(medics(f.b).map((u) => [u.ownerId, u.tileR, u.tileC]), [[ps.playerId, 10, 2]]);
    checkInvariants(f.b);
  }
  for (let i = 0; i < players.length; i += 2) {
    const pair = players.slice(i, i + 2);
    const f = makeBattle({ stageId: h.m.stageId, kind: 'boss', autoFinish: false,
      players: pair.map((ps, j) => input(ps, j === 0 ? 'L' : 'R', j === 0 ? 0 : 8, 'boss')) });
    f.step();
    assert.deepEqual(medics(f.b).map((u) => [u.ownerId, u.tileR, u.tileC]),
      [[pair[0].playerId, 3, 2], [pair[1].playerId, 3, 18]]);
    checkInvariants(f.b);
  }
});
