import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { validateC2S, RESULT_LIMITS } from '../../shared/protocol.js';
import { GameData } from '../../server/match/gamedata.js';
import { uniteFieldId, uniteFieldBudget, uniteFieldCount, uniteGroups, planUnite, advanceUniteGroup } from '../../server/match/unite.js';
import { attachAudit } from '../../server/match/audit.js';
import { deriveSeed } from '../../server/sim/rng.js';
import { fitResult, RESULT_FRAME_BUDGET } from '../../server/sim/spec.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor, checkInvariants } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';

const uniteBattles = () => FakeBattle.instances.filter(b => b.kind === 'unite');
const ids = list => list.map(p => p.playerId);
const pub = (m, pid) => m.publicView().players.find(p => p.playerId === pid);

function deployOne(m, ps, count = 1) {
  const pool = chessOfTier(1).filter(id => m.pool.has(id));
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const id = pool.find(x => !used.has(x) && legalTileFor(m, ps, x));
    used.add(id);
    give(m, ps, id, 'board', legalTileFor(m, ps, id));
  }
}

function scenario({ humans = 6, bots = 0, clientCombat = false, leaks = { p_0: 3, p_1: 2 }, first = { p_0: 2, p_1: 1 }, second = { p_0: 1 }, ...options } = {}) {
  const script = b => {
    if (b.kind === 'normal') return { leaks };
    if (b.kind === 'unite') return { survivors: b.fieldId === 'u' ? first : second };
    return {};
  };
  const h = makeMatch({ mode: 'coop', humans, bots, seed: 61, fake: true, clientCombat, script, ...options });
  h.audit = attachAudit(h.m);
  h.start().toPrep(1);
  for (const p of h.m.order) p.lp = 40;
  return h;
}

test('large-room budget permits a second helper group for one leaker', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  assert.deepEqual([0, 1, 2, 3].map(uniteFieldId), ['u', 'u2', 'u3', 'u4']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(n => uniteFieldBudget(gd, n)), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(uniteFieldBudget(gd, 9), 3);
  assert.equal(uniteFieldBudget(gd, undefined), 1);
  assert.equal(uniteFieldBudget(new GameData(DATA, 'mode_single_normal'), 8), 1);
  assert.equal(uniteFieldCount(gd, 8, 1), 2);
  for (const n of [1, 2, 3, 4]) assert.equal(uniteFieldCount(gd, n, 3), 1);
});

for (const clientCombat of [false, true]) {
  test(`all leaks enter stage one and only its survivors enter stage two (${clientCombat ? 'client' : 'server'})`, () => {
    const h = scenario({ clientCombat }), m = h.m;
    h.drive(() => m.phase === PHASE.UNITE);
    const groups = uniteGroups(m.unitePlan);
    assert.deepEqual(groups.map(g => [g.fieldId, ids(g.helpers), ids(g.leakers)]), [
      ['u', ['p_2', 'p_3'], ['p_0', 'p_1']], ['u2', ['p_4', 'p_5'], ['p_0', 'p_1']],
    ]);
    assert.deepEqual(groups.map(g => g.leaked.length), [5, 0]);
    assert.deepEqual(m.fields.map(f => f.fieldId), ['u']);
    assert.ok(!uniteBattles().some(b => b.fieldId === 'u2'));
    assert.deepEqual(['p_0', 'p_1'].map(pid => pub(m, pid).uniteLeft), [3, 2]);
    assert.equal(m.handle('p_0', { t: 'g.watch', fieldId: 'u2' }).error, 'BAD_TARGET');
    const original = groups[0].leaked.map(x => [x.sourcePlayerId, x.enemyKey, x.mods]);
    h.run(() => m.phase === PHASE.UNITE && m.fields[0]?.fieldId === 'u2');
    assert.equal(m.phase, PHASE.UNITE);
    assert.deepEqual(m.fields.map(f => f.fieldId), ['u2']);
    assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [40, 40], 'stage one bills no LP');
    const incoming = uniteGroups(m.unitePlan)[1].leaked;
    assert.deepEqual(incoming.map(x => x.sourcePlayerId).sort(), ['p_0', 'p_0', 'p_1']);
    for (const entry of incoming) assert.ok(original.some(([pid, key, mods]) => pid === entry.sourcePlayerId && key === entry.enemyKey && JSON.stringify(mods) === JSON.stringify(entry.mods)));
    assert.deepEqual(['p_0', 'p_1'].map(pid => pub(m, pid).uniteLeft), [2, 1]);
    assert.equal(h.lastTo('p_0', clientCombat ? 'b.start' : 'm.field').fieldId, 'u2');
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [39, 40], 'only final survivors bill their original sources');
    for (const pid of ['p_2', 'p_3', 'p_4', 'p_5']) assert.equal(h.ps(pid).lp, 40);
    const rounds = uniteBattles().filter(b => b.round === 1);
    const u = rounds.find(b => b.fieldId === 'u' && b.finished), u2 = rounds.find(b => b.fieldId === 'u2' && b.finished);
    assert.ok(u && u2 && u.finished);
    assert.equal(u.spawns.length, 5);
    assert.equal(u2.spawns.length, 3);
    assert.equal(u.opts.seed, deriveSeed(m.seed, 'u:1'));
    assert.equal(u2.opts.seed, deriveSeed(m.seed, 'u2:1'));
    assert.equal(m.errorCount, 0);
    if (clientCombat) assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
    assert.deepEqual(h.audit.violations, []);
    m.dispose();
  });

  test(`a perfect first stage skips the next helper group (${clientCombat ? 'client' : 'server'})`, () => {
    const h = scenario({ clientCombat, first: {} }), m = h.m;
    h.drive(() => m.phase === PHASE.UNITE);
    assert.equal(uniteGroups(m.unitePlan).length, 2);
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.ok(!uniteBattles().some(b => b.fieldId === 'u2'));
    assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [40, 40]);
    assert.deepEqual(h.audit.violations, []);
    checkInvariants(m);
    m.dispose();
  });
}

test('helper ranking and carry retain the right-hand first pair and a lone second helper', () => {
  const h = scenario({ leaks: { p_0: 6, p_1: 3, p_2: 2 }, first: { p_0: 4 }, second: { p_0: 1 } }), m = h.m;
  deployOne(m, h.ps('p_5'), 2);
  deployOne(m, h.ps('p_3'));
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(uniteGroups(m.unitePlan).map(g => ids(g.helpers)), [['p_5', 'p_3'], ['p_4']]);
  const u = uniteBattles().find(b => b.fieldId === 'u');
  assert.deepEqual(u.opts.players.map(p => [p.playerId, p.colOffset]), [['p_5', 8], ['p_3', 0]]);
  assert.equal(u.opts.waveId, m.gd.unite.templates['2']);
  for (const p of u.opts.players) for (const unit of p.units.filter(x => x.kind === 'chess')) assert.deepEqual(unit.carryState, { hpPct: 0.5, sp: 3 });
  h.run(() => m.fields[0]?.fieldId === 'u2');
  const u2 = uniteBattles().find(b => b.fieldId === 'u2');
  assert.deepEqual(u2.opts.players.map(p => [p.playerId, p.colOffset]), [['p_4', 0]]);
  assert.equal(u2.opts.waveId, m.gd.unite.templates['1']);
  assert.equal(u2.spawns.length, 4);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.deepEqual(['p_0', 'p_1', 'p_2'].map(pid => h.ps(pid).lp), [39, 40, 40]);
  assert.deepEqual(h.audit.violations, []);
  m.dispose();
});

test('stage transitions retain timed-out survivors, unspawned modifiers and original source ownership', () => {
  const helpers = [{ playerId: 'h1' }, { playerId: 'h2' }], leakers = [{ playerId: 'p_0' }, { playerId: 'p_1' }];
  const survivor = { enemyKey: 'enemy_1007_slime', sourcePlayerId: 'p_0', mods: { hpMul: 1.7, bountyCoins: 3 }, bounty: { coins: 3, ownerPlayerId: 'p_0' } };
  const pending = { enemyKey: 'enemy_1007_slime', sourcePlayerId: 'p_1', time: 61, mods: { atkMul: 2.3 }, tag: 'late' };
  const groups = [
    { fieldId: 'u', helpers: [helpers[0]], leakers, leaked: [survivor, pending], notReentered: new Map([['p_0', 1]]) },
    { fieldId: 'u2', helpers: [helpers[1]], leakers, leaked: [], notReentered: new Map() },
  ];
  const plan = { groups, activeGroup: 0, results: [] };
  const result = { reason: 'timeout', time: 60, perPlayer: { h1: { leaked: [
    { ...survivor, counted: true }, { enemyKey: survivor.enemyKey, sourcePlayerId: 'p_0', counted: false },
  ] } }, unspawned: [{ enemyKey: pending.enemyKey, sourcePlayerId: 'p_1', time: 61 }] };
  const next = advanceUniteGroup(plan, result, [pending]);
  assert.equal(next, groups[1]);
  assert.equal(plan.activeGroup, 1);
  assert.equal(plan.results[0], result);
  assert.equal(next.leaked.length, 2);
  assert.deepEqual(next.leaked[0].mods, survivor.mods);
  assert.deepEqual(next.leaked[0].bounty, survivor.bounty);
  assert.deepEqual(next.leaked[1].mods, pending.mods);
  assert.equal(next.leaked[1].tag, pending.tag);
  assert.deepEqual(next.leaked.map(x => x.sourcePlayerId), ['p_0', 'p_1']);
  assert.deepEqual(next.notReentered, new Map([['p_0', 1]]));
});

test('a real battle timeout passes living enemies and pending spawn modifiers into the next stage', () => {
  const live = { enemyKey: 'enemy_1007_slime', sourcePlayerId: 'p_0', mods: { hpMul: 1.7 }, time: 0 };
  const pending = { enemyKey: 'enemy_1007_slime', sourcePlayerId: 'p_3', mods: { atkMul: 2.3 }, time: 5 };
  const first = makeBattle({ kind: 'unite', content: 'none', units: [], timeLimit: 0.1,
    enemies: [live, pending].map(x => ({ key: x.enemyKey, time: x.time, mods: x.mods, sourcePlayerId: x.sourcePlayerId })) });
  first.runToEnd(1);
  const result = first.result();
  assert.equal(result.reason, 'timeout');
  const leaks = Object.values(result.perPlayer).flatMap(pp => pp.leaked);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].sourcePlayerId, 'p_0');
  assert.deepEqual(leaks[0].mods, live.mods);
  assert.equal(result.unspawned.length, 1);
  assert.equal(result.unspawned[0].sourcePlayerId, 'p_3');
  const leakers = [{ playerId: 'p_0' }, { playerId: 'p_3' }];
  const groups = [
    { fieldId: 'u', helpers: [], leakers, leaked: [live, pending], notReentered: new Map() },
    { fieldId: 'u2', helpers: [], leakers, leaked: [], notReentered: new Map() },
  ];
  const plan = { groups, activeGroup: 0, results: [] };
  const next = advanceUniteGroup(plan, result, [live, pending]);
  assert.equal(next.leaked.length, 2);
  assert.deepEqual(next.leaked.map(x => [x.sourcePlayerId, x.mods]), [['p_0', live.mods], ['p_3', pending.mods]]);
});

test('each streamed stage has its own complete countdown after a first-stage timeout', () => {
  const h = scenario({ instant: false, script: b => b.kind === 'normal' ? { duration: 0.1, leaks: { p_0: 3, p_1: 2 } }
    : b.kind === 'unite' ? { duration: Infinity, survivors: b.fieldId === 'u' ? { p_0: 2, p_1: 1 } : { p_0: 1 } } : {} }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  const limit = m.wave.timeLimit;
  const durationMs = Math.round(limit / m.gameSpeed * 1000);
  const firstDeadline = m.deadline;
  const firstStartedAt = h.sched.now();
  assert.equal(firstDeadline - firstStartedAt, durationMs);
  h.run(() => m.phase === PHASE.UNITE && m.fields[0]?.fieldId === 'u2');
  assert.equal(m.phase, PHASE.UNITE);
  const [u, u2] = uniteBattles();
  assert.equal(u.reason, 'timeout');
  assert.equal(u.opts.timeLimit, limit);
  assert.equal(u2.opts.timeLimit, limit);
  assert.equal(m.deadline - h.sched.now(), durationMs, 'stage two starts a complete new countdown');
  assert.ok(m.deadline >= firstDeadline + durationMs);
  assert.equal(u2.spawns.length, 3);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(h.ps('p_0').lp, 39);
  assert.equal(h.ps('p_1').lp, 40);
  m.dispose();
});

test('one original leaker may receive both helper groups', () => {
  const h = scenario({ humans: 5, leaks: { p_0: 3 }, first: { p_0: 2 }, second: { p_0: 1 } }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(uniteGroups(m.unitePlan).map(g => ids(g.helpers)), [['p_1', 'p_2'], ['p_3', 'p_4']]);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(h.ps('p_0').lp, 39);
  assert.deepEqual(uniteBattles().map(b => b.fieldId), ['u', 'u2']);
  assert.deepEqual(h.audit.violations, []);
  m.dispose();
});

test('without another helper group stage one bills its final survivors', () => {
  const leaks = { p_0: 3, p_1: 2, p_2: 4, p_3: 1, p_4: 2, p_5: 5, p_6: 1 };
  const h = scenario({ humans: 8, leaks, first: { p_0: 1 } }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(ids(m.unitePlan.helpers), ['p_7']);
  assert.equal(uniteGroups(m.unitePlan).length, 1);
  assert.equal(uniteBattles()[0].spawns.length, 18);
  assert.equal(m.publicView().unite.fields, undefined);
  assert.ok(RESULT_LIMITS.players >= 7);
  const left = Object.fromEntries(Object.keys(leaks).map(pid => [pid, 1]));
  assert.equal(validateC2S({ t: 'b.progress', battleId: 'x.1.1.u', gt: 3, killed: 0, total: 18, done: false, leaks: 0, left }), null);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(h.ps('p_0').lp, 39);
  assert.deepEqual(uniteBattles().map(b => b.fieldId), ['u']);
  assert.deepEqual(h.audit.violations, []);
  m.dispose();
});

test('a failed second battle bills only enemies remaining after stage one', () => {
  const h = scenario({ script: b => b.kind === 'normal' ? { leaks: { p_0: 7, p_1: 4 } }
    : b.kind === 'unite' ? b.fieldId === 'u2' ? { throwInCtor: true } : { survivors: { p_0: 1 } } : {} }), m = h.m;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [39, 40]);
  assert.ok(m.errorCount >= 1);
  assert.deepEqual(h.audit.violations, []);
  m.dispose();
});

test('each helper receives only its own stage statistics and leakers read the final stage result', () => {
  const h = scenario({ leaks: { p_0: 2, p_1: 2 }, script: b => b.kind === 'normal' ? { leaks: { p_0: 2, p_1: 2 } }
    : b.kind === 'unite' ? b.fieldId === 'u'
      ? { survivors: { p_0: 1 }, coins: { p_2: 3, p_3: 4 }, damage: { p_2: 100, p_3: 200 } }
      : { coins: { p_4: 5, p_5: 6 }, damage: { p_4: 300, p_5: 400 } } : {} }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  const before = new Map(m.order.map(ps => [ps.playerId, { funds: ps.pendingFunds, gained: ps.stats.fundsGained, dmg: ps.stats.dmgDealt, kills: ps.stats.kills, own: m.lastResults.get(ps.playerId) }]));
  const results = new Map(), dispatch = m.dispatch.bind(m);
  m.dispatch = (ps, hook, ev, ...rest) => {
    if (hook === 'onBattleResult' && !ev?.boss) results.set(ps.playerId, ev.unite);
    return dispatch(ps, hook, ev, ...rest);
  };
  h.drive(() => m.phase === PHASE.SETTLE);
  const shares = { p_0: [0, 0, 0], p_1: [0, 0, 0], p_2: [3, 100, 3], p_3: [4, 200, 0], p_4: [5, 300, 1], p_5: [6, 400, 0] };
  for (const ps of m.order) {
    const b = before.get(ps.playerId), [coins, damage, kills] = shares[ps.playerId];
    assert.equal(ps.pendingFunds - b.funds, coins, ps.playerId);
    assert.equal(ps.stats.fundsGained - b.gained, coins, ps.playerId);
    assert.equal(ps.stats.dmgDealt - b.dmg, b.own.damageDealt + damage, ps.playerId);
    assert.equal(ps.stats.kills - b.kills, b.own.killed + kills, ps.playerId);
  }
  const resultField = pid => Object.keys(results.get(pid)?.perPlayer || {}).sort().join('+');
  assert.deepEqual(m.order.map(ps => resultField(ps.playerId)), ['p_4+p_5', 'p_4+p_5', 'p_2+p_3', 'p_2+p_3', 'p_4+p_5', 'p_4+p_5']);
  assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [40, 40]);
  assert.deepEqual(h.audit.violations, []);
  checkInvariants(m);
  m.dispose();
});

test('client authority takeover finishes stage one before stage two starts and viewers resync to the active stage', () => {
  const h = scenario({ clientCombat: true, perPlayer: { p_2: { delayMs: 6000 } } }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  const first = m.fields[0];
  assert.deepEqual([first.fieldId, first.mode, first.authority], ['u', 'client', 'p_2']);
  m.onDisconnect('p_2');
  assert.equal(first.mode, 'server');
  h.run(() => m.phase === PHASE.UNITE && m.fields[0]?.fieldId === 'u2');
  assert.ok(first.done);
  assert.deepEqual(m.fields.map(f => [f.fieldId, f.mode, f.authority]), [['u2', 'client', 'p_4']]);
  assert.notEqual(m.fields[0].battleId, first.battleId);
  m.watchers.delete('p_0');
  m.onReconnect('p_0');
  assert.equal(h.lastTo('p_0', 'b.start').fieldId, 'u2');
  m.addSpectator('s_1');
  assert.equal(h.lastTo('s_1', 'b.start').fieldId, 'u2');
  assert.equal(m.handle('s_1', { t: 'g.watch', fieldId: 'u' }).error, 'BAD_TARGET');
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(m.verifyStats.takeovers, 1);
  assert.equal(m.verifyStats.rejected, 0);
  assert.deepEqual([h.ps('p_0').lp, h.ps('p_1').lp], [39, 40]);
  assert.deepEqual(h.audit.violations, []);
  checkInvariants(m);
  m.dispose();
});

test('1–4 alive retain the single field and shared plan arrays', () => {
  const h = scenario({ humans: 4, leaks: { p_0: 2, p_3: 1 }, first: {} }), m = h.m;
  h.drive(() => m.phase === PHASE.UNITE);
  const plan = m.unitePlan, [g] = uniteGroups(plan);
  assert.equal(plan.groups.length, 1);
  assert.equal(g.fieldId, 'u');
  assert.ok(g.helpers === plan.helpers && g.leakers === plan.leakers && g.leaked === plan.leaked && g.notReentered === plan.notReentered);
  assert.equal('fields' in m.publicView().unite, false);
  const again = planUnite(m, m.lastResults);
  assert.deepEqual([ids(again.helpers), ids(again.leakers), again.leaked.length], [ids(plan.helpers), ids(plan.leakers), plan.leaked.length]);
  m.dispose();
});

test('fitResult retains original sources in a large unite result', () => {
  const leak = (src, i) => ({ enemyKey: `enemy_10${String(i % 90).padStart(2, '0')}_slime_long_name`, mods: null, lpr: 1, sourcePlayerId: src, tag: null, counted: true, spawned: true });
  const leaked = Array.from({ length: 400 }, (_, i) => leak(`p_${i % 7}`, i));
  const unspawned = Array.from({ length: 400 }, (_, i) => ({ enemyKey: `enemy_10${String(i % 90).padStart(2, '0')}_slime_long_name`, sourcePlayerId: `p_${i % 7}`, tag: null, time: 12.5 }));
  const pp = { killed: 0, total: 800, leaked, perfect: false, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] };
  const big = { reason: 'timeout', time: 60, killed: 0, total: 800, errors: 0, perPlayer: { h_1: pp }, unspawned };
  const size = r => JSON.stringify({ t: 'b.result', battleId: 'b', result: r, rid: 2147483647 }).length;
  assert.ok(size(big) > RESULT_FRAME_BUDGET);
  const fit = fitResult(big, { battleId: 'b' });
  assert.ok(size(fit) <= RESULT_FRAME_BUDGET);
  assert.equal(fit.perPlayer.h_1.leaked.length, 400);
  assert.equal(fit.unspawned.length, 400);
  assert.deepEqual(fit.perPlayer.h_1.leaked[8], { enemyKey: leaked[8].enemyKey, sourcePlayerId: 'p_1' });
  assert.deepEqual(fit.unspawned[3], { enemyKey: unspawned[3].enemyKey, sourcePlayerId: 'p_3' });
  assert.equal(validateC2S({ t: 'b.result', battleId: 'x.1.1.u', result: fit }), null);
});
