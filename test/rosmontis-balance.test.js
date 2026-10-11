import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operatorBalanceFile } from '../shared/operatorBalance.js';
import { getData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { createDataStore } from '../public/js/data.js';
import { atPotential } from '../shared/potential.js';
import { composeUnitRecord, statusKey } from '../shared/standIn.js';
import { makeBattle, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { effectiveProfile, resolveHit } from '../server/sim/ai.js';

const raw = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url)));
const ids = ['chess_char_6_12_a', 'chess_char_6_12_b'];
const factors = { maxHp: 1.5, atk: 2, def: 2, bat: 0.75 };
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('Rosmontis numeric records agree across server, client loader and injected simulation without repeated scaling', async () => {
  const server = getData();
  const store = createDataStore({ fetch: async () => ({ ok: true, json: async () => raw }) });
  const browser = await store.load('chess');
  const injected = new DataSource({ chess: raw });
  const loaded = new DataSource(server);
  const adjusted = operatorBalanceFile('chess', raw);
  assert.equal(operatorBalanceFile('chess', adjusted), adjusted);
  for (const id of ids) {
    for (const [key, factor] of Object.entries(factors)) {
      const want = raw[id].stats[key] * factor;
      approx(server.chess[id].stats[key], want);
      approx(browser[id].stats[key], want);
      approx(injected.getChess(id).stats[key], want);
      approx(loaded.getChess(id).stats[key], want);
    }
    for (const key of ['desc', 'descRaw', 'name']) assert.equal(server.chess[id][key], raw[id][key]);
    for (let i = 0; i < 3; i++) {
      const before = raw[id].skills[i], after = server.chess[id].skills[i];
      assert.equal(after.desc, before.desc);
      assert.equal(after.descRaw, before.descRaw);
      for (const [key, value] of Object.entries(before.bb)) {
        const scale = ['extra_atk_scale', 'append_atk_scale', 'attack@append_atk_scale', 'atk', 'def'].includes(key) ? 2 : 1;
        assert.equal(after.bb[key], value * scale, `${id} S${i + 1} ${key}`);
      }
    }
  }
  assert.equal(adjusted.chess_char_6_11_a, raw.chess_char_6_11_a, 'other operators retain their records');
  assert.equal(raw[ids[0]].stats.atk, 616, 'source data remains unchanged');
});

test('Rosmontis selected modules and all potential ranks scale the final composed statistics once', () => {
  const source = new DataSource({ chess: raw });
  for (const id of ids) for (let potential = 1; potential <= 6; potential++) {
    const before = atPotential(raw[id], potential);
    for (const moduleId of ['none', ...(raw[id].modules || []).map(m => m.uniEquipId)]) {
      const module = raw[id].modules?.find(m => m.uniEquipId === moduleId);
      const base = raw[id].modules ? before.statsBase : before.stats;
      const def = source.getChess(id, { potential, moduleId });
      for (const [key, factor] of Object.entries(factors)) approx(def.stats[key], (base[key] + (module?.attr?.[key] || 0)) * factor);
    }
  }
});

test('Rosmontis backup forms preserve numeric adjustments when composed into another chess identity', () => {
  const unit = { ...raw[ids[0]], charId: 'char_391_rosmon', assets: {}, forms: {} };
  for (const id of ids) unit.forms[statusKey(raw[id].status)] = { ...raw[id], stats: raw[id].statsBase || raw[id].stats };
  const backups = { units: { char_391_rosmon: unit } };
  const adjusted = operatorBalanceFile('backups', backups);
  assert.equal(operatorBalanceFile('backups', adjusted), adjusted);
  for (const id of ids) {
    const form = adjusted.units.char_391_rosmon.forms[statusKey(raw[id].status)];
    const original = unit.forms[statusKey(raw[id].status)];
    const rec = composeUnitRecord({ ...raw[id], chessId: 'other_slot' }, adjusted.units.char_391_rosmon, form, { skillIndex: 0, moduleId: null });
    assert.equal(rec.charId, 'char_391_rosmon');
    assert.equal(rec.chessId, 'other_slot');
    for (const [key, factor] of Object.entries(factors)) approx(rec.stats[key], original.stats[key] * factor);
    assert.equal(rec.skill.bb.extra_atk_scale, original.skills[0].bb.extra_atk_scale * 2);
    assert.equal(rec.skill.desc, original.skills[0].desc);
  }
});

test('Rosmontis skill damage uses doubled S1 and S3 aftershock coefficients with one aftershock sequence per hit', () => {
  for (const id of ids) for (const skillIndex of [0, 2]) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3, skillIndex }], defs: { enemies: { e: enemyRec({ key: 'e', hp: 1e8, def: 0, res: 0, speed: 0 }) } }, enemies: [{ key: 'e', pos: [10, 6] }], timeLimit: 10 });
    h.step();
    const unit = h.unit(id);
    assert.equal(unit.skill.id, `skchr_rosmon_${skillIndex + 1}`);
    unit.atkCd = 10;
    h.run(1);
    assert.ok(unit.skill.activate('test', { free: true }));
    const profile = effectiveProfile(unit);
    unit.atkCd = 10;
    const damage = [];
    h.b.on('damaged', ctx => { if (ctx.source === unit) damage.push(ctx); });
    const target = h.enemies()[0];
    resolveHit(h.b, unit, profile, target, { isSkill: true, attackId: 1 }, target.x, target.y);
    h.run(1);
    const shocks = damage.filter(ctx => ctx.dmg.tags?.includes('aftershock'));
    assert.equal(shocks.length, Math.max(1, (unit.profile.shockTimes ?? 2) - 1));
    const key = skillIndex === 0 ? 'append_atk_scale' : 'attack@append_atk_scale';
    for (const ctx of shocks) approx(ctx.amount, unit.s.atk * raw[id].skills[skillIndex].bb[key] * 2);
    if (skillIndex === 0) {
      const extra = damage.filter(ctx => ctx.dmg.type === 'arts');
      assert.equal(extra.length, 1);
      approx(extra[0].amount, unit.s.atk * raw[id].skills[0].bb.extra_atk_scale * 2);
    }
    assert.equal(unit.profile.shockScale, 0.5, 'ordinary attacks retain the original aftershock coefficient');
    checkInvariants(h.b);
    assert.deepEqual(h.b.errors, []);
  }
});
