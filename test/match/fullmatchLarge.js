// test/match/fullmatchLarge.js — shared by the 5–8-seat soak suites (fullmatch-coop-5seats.test.js,
// fullmatch-coop-8seats.test.js): one whole co-op match with the REAL simulation and client-side combat
// (fullmatchRun.js runFull: zero errors, invariants at every phase change, no rejected client result), then the remake's
// 5–8-player rules checked on what the match did:
//   * shared pool: copies per chess = ceil(base × max(1, n / 4)), n = the seats at the start (humans + AI);
//   * strategy draft: one turn per seat; a timed draft of more than 4 seats gives 20 s a turn (30 s otherwise);
//   * 机变: max(6, alive + 2) cards for the alive pickers (7–10 cards for 5–8 players);
//   * Unite: one active helper stage at a time; up to ceil(alive / 4) planned stages, 1–2 helpers each;
//     all original leaks enter the first stage and only survivors enter the following stages;
//   * 最终攻势 / 隐秘核心: seat pairs b1…b⌈alive / 2⌉, the shared pool = bloodPoint × alive (0.2.0's per-player pool,
//     DESIGN §25.13.4: the 4 players' share × alive / 4 above 4 alive);
//   * result: a row per seat; with more than 4 players everyone who spent funds (挥金如土's stat) holds a title —
//     the second pass lets a title repeat.
// The views are read through Match.prototype.flush (wrapped for this test process only): the first flush of each
// draft / 联防 / boss phase builds the public view (m.public's own builder, read-only) and checks it — the broadcast
// itself is throttled in virtual time and can skip a short phase. Every broken rule is collected (its first
// occurrence) and reported together, so one run names every rule that does not hold.
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { Match } from '../../server/match/Match.js';
import { SEEDS, runFull } from './fullmatchRun.js';

// 5–8-seat matches take about twice as long as 4-seat ones: a bounded number of seeds keeps the full suite's length
export const LARGE_SEEDS = Math.max(1, Math.min(SEEDS, 6));

const WATCHED = new Set([PHASE.BAND_DRAFT, PHASE.SP_DRAFT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
let observer = null;
const flush = Match.prototype.flush;
Match.prototype.flush = function (...args) {
  const r = flush.apply(this, args);
  if (observer && !this.disposed && WATCHED.has(this.phase)) observer(this);
  return r;
};

const ceilDiv = (a, b) => Math.ceil(a / b);
const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** base copies of a chess before the 5–8 scaling (config.economy.poolCopies[tier] / poolCopiesOverrides) */
function baseCopies(gd, id) {
  const eco = gd.economy || gd.config?.economy || {};
  const ov = eco.poolCopiesOverrides;
  const single = ov && Number.isInteger(ov[id]) ? ov[id] : eco.poolCopies?.[gd.tierOf(id)];
  // the official co-op stock (upstream 0.2.4, DESIGN §29.8): the single-player copies doubled
  return Number.isInteger(single) ? single * (eco.coopPoolMultiplier ?? 1) : single;
}

export function runLarge({ difficulty, humans, bots, seed }) {
  const n = humans + bots;
  const tag = `co-op ${humans}+${bots} (${n} seats) ${difficulty}/${seed}`;
  const seen = { drafts: 0, sp: 0, unite: 0, multiUnite: 0, boss: 0, hidden: 0 };
  const broken = new Map();
  const check = (ok, rule, detail) => { if (!ok && !broken.has(rule)) broken.set(rule, `${rule} — ${detail}`); };
  const done = new Set();
  let match = null;

  observer = (m) => {
    if (match == null) match = m;
    if (m !== match) return;
    const key = `${m.phase}:${m.round}:${m.phase === PHASE.UNITE ? m.unitePlan?.activeGroup || 0 : ''}`;
    // Observe each helper stage as well as every draft and boss phase.
    if (done.has(key)) return;
    if (m.phase === PHASE.BAND_DRAFT && !m.draft) return;
    if (m.phase === PHASE.SP_DRAFT && !m.sp) return;
    if (m.phase === PHASE.UNITE && !m.unitePlan) return;
    if ((m.phase === PHASE.FINAL_ASSAULT || m.phase === PHASE.HIDDEN_CORE) && !m.bossPool) return;
    done.add(key);
    const v = m.publicView();
    const at = `R${v.round} ${v.phase}`;
    const alive = (v.players || []).filter((p) => p.alive);
    if (v.draft) {
      seen.drafts++;
      check(v.draft.order.length === n, 'one strategy turn per seat', `${v.draft.order.length} turns for ${n} seats`);
      if (!v.draft.untimed) check(v.draft.turnSeconds === (n > 4 ? 20 : 30), 'strategy turn 20 s above 4 seats', `${v.draft.turnSeconds} s with ${n} seats`);
    }
    if (v.sp) {
      seen.sp++;
      check(v.sp.order.length === alive.length, 'every alive player picks a 机变 card', `${at}: order ${v.sp.order.length}, alive ${alive.length}`);
      const want = Math.max(6, alive.length + 2);
      check(v.sp.cards.length === want, '机变 cards = max(6, alive + 2)', `${at} ${v.sp.family}: ${v.sp.cards.length} cards for ${alive.length} alive, want ${want}`);
    }
    if (v.unite) {
      seen.unite++;
      const uf = (v.fields || []).filter((x) => x.kind === 'unite');
      const helpers = v.unite.helpers || [];
      const groups = m.unitePlan.groups;
      const activeIndex = m.unitePlan.activeGroup || 0;
      const active = groups[activeIndex];
      check(uf.length === 1, 'one active Unite field', `${at}: ${uf.length} fields`);
      check(uf.every((x) => x.players.length >= 1 && x.players.length <= 2), '1–2 helpers per 联防 field', `${at}: ${JSON.stringify(uf.map((x) => x.players))}`);
      check(uf[0]?.fieldId === active?.fieldId && v.unite.activeFieldId === active?.fieldId, 'the active Unite stage matches its field', `${at}: ${uf[0]?.fieldId} vs ${v.unite.activeFieldId}`);
      check(same(sorted(uf[0]?.players || []), sorted(active?.helpers.map(p => p.playerId) || [])), 'the active field uses its own helper group', at);
      check(same(groups.map(g => g.fieldId), groups.map((_, i) => i === 0 ? 'u' : `u${i + 1}`)), 'planned Unite field ids u, u2, …', at);
      check(same(sorted(groups.flatMap(g => g.helpers.map(p => p.playerId))), sorted(helpers)), 'unite.helpers lists all planned helpers', at);
      const perfect = m.alivePlayers().filter((ps) => {
        const r = m.lastResults && m.lastResults.get(ps.playerId);
        return r && !(r.leaked || []).some((l) => l && l.counted !== false) && r.perfect !== false;
      }).length;
      const budget = ceilDiv(alive.length, 4);
      check(helpers.length === Math.min(2 * budget, perfect), 'Unite helpers follow the alive-player budget and perfect-player count', `${at}: ${helpers.length} helpers, ${perfect} perfect, ${alive.length} alive`);
      check(groups.length === Math.min(budget, ceilDiv(helpers.length, 2)), 'planned Unite stages follow the helper budget', `${at}: ${groups.length} stages for ${helpers.length} helpers`);
      check(groups.every(g => same(sorted(g.leakers.map(p => p.playerId)), sorted(v.unite.leakers || []))), 'every stage retains original leaker ownership', at);
      if (groups.length > 1) {
        if (activeIndex > 0) seen.multiUnite++;
        const fl = v.unite.fields;
        check(Array.isArray(fl) && fl.length === groups.length, 'unite.fields lists planned helper stages', `${at}: ${JSON.stringify(fl)}`);
        if (Array.isArray(fl)) fl.forEach((g, i) => {
          check(g.fieldId === groups[i].fieldId, 'planned Unite stages retain field order', at);
          check(same(sorted(g.helpers || []), sorted(groups[i].helpers.map(p => p.playerId))), 'planned stages use their own helper groups', at);
          check(same(sorted(g.leakers || []), sorted(v.unite.leakers || [])), 'planned stages retain all original sources', at);
        });
      } else {
        check(v.unite.fields === undefined, 'single Unite group omits the stage list', at);
      }
    }
    if ((v.phase === PHASE.FINAL_ASSAULT || v.phase === PHASE.HIDDEN_CORE) && v.bossHp) {
      if (v.phase === PHASE.FINAL_ASSAULT) seen.boss++;
      else seen.hidden++;
      const bf = (v.fields || []).filter((x) => x.kind === 'boss' || x.kind === 'hidden');
      check(same(bf.map((x) => x.fieldId), bf.map((_, i) => `b${i + 1}`)), 'boss field ids b1, b2, …', `${at}: ${bf.map((x) => x.fieldId)}`);
      check(bf.length === ceilDiv(alive.length, 2), 'boss fields = seat pairs', `${at}: ${bf.length} fields for ${alive.length} alive`);
      const bossId = v.phase === PHASE.HIDDEN_CORE ? m.hiddenBossId : m.bossId;
      const bp = m.gd.boss(bossId)?.bloodPoint?.[m.gd.difficulty];
      if (Number.isFinite(bp)) {
        const tune = typeof m.gd.bossHpMul === 'function' ? m.gd.bossHpMul(bossId) : 1;
        const want = Math.round(bp * alive.length * tune);
        check(Math.abs(v.bossHp.max - want) <= 1, 'leader pool = bloodPoint × alive', `${at}: ${v.bossHp.max}, want ${bp} × ${alive.length} × ${tune} = ${want}`);
      }
    }
  };

  let out;
  try {
    out = runFull({ mode: 'coop', difficulty, humans, bots, seed });
  } finally {
    observer = null;
  }
  const { m, res } = out;

  check(m.order.length === n, 'every seat plays', `${m.order.length} of ${n}`);
  // shared pool, sized at the start for the n seats (1–4: the official copies)
  const f = Math.max(1, n / 4);
  let entries = 0;
  for (const [id] of m.pool.entries) {
    const base = baseCopies(m.gd, id);
    if (!Number.isInteger(base) || base <= 0) continue;
    entries++;
    const want = Math.ceil(base * f);
    check(m.pool.cap(id) === want, 'pool copies = ceil(base × n / 4)', `${id}: ${m.pool.cap(id)}, want ceil(${base} × ${n}/4) = ${want}`);
  }
  check(entries > 0, 'the pool has entries', 'none');
  // The shared shop-equipment stock, sized alike — the measured overrides.
  for (const [id, count] of Object.entries(m.gd.economy.itemPoolCopiesOverrides || {})) {
    const want = Math.ceil(count * f);
    check(m.itemPool.cap(id) === want, 'equipment stock = ceil(count × n / 4)', `${id}: ${m.itemPool.cap(id)}, want ceil(${count} × ${n}/4) = ${want}`);
  }
  check(seen.drafts === 1, 'the strategy draft was observed', `${seen.drafts} looks`);

  const rows = res.players || [];
  check(rows.length === n, 'a result row per seat', `${rows.length} rows for ${n} seats`);
  if (n > 4) {
    for (const r of rows) {
      if (r.stats && r.stats.gold > 0) check(!!r.title, 'above 4 players everyone eligible gets a title', `${r.playerId} spent ${r.stats.gold} funds, no title`);
    }
  }
  assert.deepEqual([...broken.values()], [], `${tag}: 5–8-player rules broken`);
  return seen;
}
