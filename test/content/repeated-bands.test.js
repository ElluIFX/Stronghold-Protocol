import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch } from '../match/harness.js';
import { amedicStatMultiplier } from '../../shared/bandModifiers.js';
import { createSDK } from '../../shared/plugins/sdk.js';
import setup from '../../customizations/repeated-strategies/sim/index.js';
import setupMeta from '../../customizations/repeated-strategies/meta/index.js';

setup(createSDK({ id: 'repeated-strategies', permissions: ['sim.code'] }));
setupMeta(createSDK({ id: 'repeated-strategies', permissions: ['meta.code'] }));

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
  const base = makeBattle({ stageId: h.m.stageId, autoFinish: false,
    players: [{ ...input(players[0], 'L', 0, 'normal'), contentInfo: { matchBands: ['band_amedic'] } }] });
  base.step();
  const stats = medics(base.b)[0].s;
  for (const ps of players) {
    const f = makeBattle({ stageId: h.m.stageId, autoFinish: false, players: [input(ps, 'L', 0, 'normal')] });
    f.step();
    assert.deepEqual(medics(f.b).map((u) => [u.ownerId, u.tileR, u.tileC]), [[ps.playerId, 10, 2]]);
    const medic = medics(f.b)[0];
    for (const key of ['maxHp', 'atk', 'def']) assert.equal(medic.s[key], stats[key] * 2.75, key);
    assert.equal(medic.hp, medic.s.maxHp);
    assert.equal(ps.privateView().prepMapChars[0].maxHp, medic.s.maxHp);
    assert.equal(h.m.prepFieldMeta(ps).units.find((u) => u.defId === 'char_605_cmedic').maxHp, medic.s.maxHp);
    checkInvariants(f.b);
  }
  for (let i = 0; i < players.length; i += 2) {
    const pair = players.slice(i, i + 2);
    const f = makeBattle({ stageId: h.m.stageId, kind: 'boss', autoFinish: false,
      players: pair.map((ps, j) => input(ps, j === 0 ? 'L' : 'R', j === 0 ? 0 : 8, 'boss')) });
    f.step();
    assert.deepEqual(medics(f.b).map((u) => [u.ownerId, u.tileR, u.tileC]),
      [[pair[0].playerId, 3, 2], [pair[1].playerId, 3, 18]]);
    assert.notEqual(medics(f.b)[0].id, medics(f.b)[1].id);
    for (const medic of medics(f.b)) for (const key of ['maxHp', 'atk', 'def']) assert.equal(medic.s[key], stats[key] * 2.75);
    checkInvariants(f.b);
  }
  players[7].alive = false;
  assert.equal(amedicStatMultiplier(players.filter((p) => p.alive).map((p) => p.bandId)), 2.5);
  assert.equal(players[0].privateView().prepMapChars[0].maxHp, stats.maxHp * 2.5);
  assert.deepEqual(players[7].privateView().prepMapChars, []);
  const reduced = { input: players[0].battleInput(), kind: 'normal', round: 1 };
  h.m.dispatch(players[0], 'onBattleStart', reduced);
  const after = makeBattle({ stageId: h.m.stageId, autoFinish: false, players: [reduced.input] });
  after.step();
  assert.equal(medics(after.b)[0].s.maxHp, stats.maxHp * 2.5);
  h.m.dispose();
});

test('Touch stat scaling preserves each owner elite variant, skill state and battle timing', () => {
  const elite = chessRec({ id: 'elite_b', golden: true });
  const h = makeBattle({ stageId: 'act2autochess_m01', kind: 'unite', autoFinish: false,
    defs: { chess: { elite_b: elite } }, players: [
      player('p1', 0, 'band_amedic', { units: [1, 2].map((uid) => ({ uid, chessId: 'elite_b', row: 9 + uid, col: 4 })) }),
      player('p2', 1, 'band_amedic', { units: [] }),
    ] });
  h.step();
  const [touch, reserve] = h.b.allyUnits.filter((u) => u.kind === 'token');
  assert.deepEqual([touch.defId, reserve.defId], ['char_613_acmedc', 'char_605_cmedic']);
  assert.deepEqual([touch.tileR, touch.tileC, reserve.tileR, reserve.tileC], [10, 2, 10, 10]);
  assert.notEqual(touch.skill, reserve.skill);
  const sp = reserve.skill.sp;
  touch.skill.gainSp(10, 'test');
  assert.equal(reserve.skill.sp, sp);
  assert.equal(touch.s.maxHp, touch.base.maxHp * 1.25);
  assert.equal(reserve.s.maxHp, reserve.base.maxHp * 1.25);
  const baseline = makeBattle({ stageId: 'act2autochess_m01', kind: 'unite', autoFinish: false,
    defs: { chess: { elite_b: elite } },
    players: h.b.players.map((p) => ({ ...p.input, contentInfo: { matchBands: ['band_amedic'] } })),
  });
  baseline.step();
  const plain = baseline.b.allyUnits.filter((u) => u.kind === 'token');
  for (const [i, u] of [touch, reserve].entries()) {
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(plain[i].skill.activate('test', { free: true }));
    for (const key of ['maxHp', 'atk', 'def']) assert.ok(Math.abs(u.s[key] - plain[i].s[key] * 1.25) < 1e-6, key);
    assert.equal(u.skill.spec.duration, plain[i].skill.spec.duration);
    assert.equal(u.s.bat, plain[i].s.bat);
    assert.equal(u.s.spRecovery, plain[i].s.spRecovery);
  }
  checkInvariants(h.b);
});

test('eight Touch holders increase the actual first healing action by 2.75 while keeping attack timing', () => {
  const run = (count) => {
    const h = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false,
      defs: { chess: { patient: chessRec({ id: 'patient', stats: { maxHp: 100000 } }) } },
      players: [player('p1', 0, 'band_amedic', {
        units: [{ uid: 1, chessId: 'patient', row: 10, col: 4 }],
        contentInfo: { matchBands: Array(count).fill('band_amedic') },
      })] });
    h.step();
    const patient = h.unit('patient');
    patient.hp = 1000;
    assert.ok(h.runUntil(() => patient.hp > 1000, 4));
    return { healed: patient.hp - 1000, time: h.b.time };
  };
  const normal = run(1), boosted = run(8);
  assert.ok(Math.abs(boosted.healed - normal.healed * 2.75) < 1e-6);
  assert.equal(boosted.time, normal.time);
});

test('Touch counts live holders separately from a retained team grant and preserves opening aggro order', () => {
  for (const count of [0, 1, 2, 8]) {
    const h = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false, defs,
      players: [player('p1', 0, count ? 'band_amedic' : 'band_sarkazb', {
        contentInfo: { matchBands: ['band_amedic'], liveMatchBands: Array(count).fill('band_amedic') },
      })] });
    h.step();
    const tokens = h.b.allyUnits.filter(u => u.kind === 'token');
    assert.equal(tokens.length, count > 0 ? 1 : 0);
    if (tokens.length) {
      const medic = tokens[0], op = h.unit('repeat_op');
      assert.equal(medic.s.maxHp, medic.base.maxHp * amedicStatMultiplier(Array(count).fill('band_amedic')));
      assert.ok(medic.aggroSeq < op.aggroSeq);
    }
    checkInvariants(h.b);
  }
});
