import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { effectiveProfile, resolveHit } from '../../server/sim/ai.js';

const records = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));

test('Rosmontis S1 and S3 aftershocks use their selected skill coefficient exactly once', () => {
  for (const id of ['chess_char_6_12_a', 'chess_char_6_12_b']) for (const skillIndex of [0, 2]) {
    const record = structuredClone(records[id]);
    const key = skillIndex === 0 ? 'append_atk_scale' : 'attack@append_atk_scale';
    for (const skill of [record.skill, ...record.skills]) if (skill?.bb && key in skill.bb) skill.bb[key] = 1.75;
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3, skillIndex }],
      defs: { chess: { [id]: record }, enemies: { e: enemyRec({ key: 'e', hp: 1e8, def: 0, res: 0, speed: 0 }) } },
      enemies: [{ key: 'e', pos: [10, 6] }], timeLimit: 10 });
    h.step();
    const unit = h.unit(id);
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
    for (const ctx of shocks) assert.ok(Math.abs(ctx.amount - unit.s.atk * 1.75) < 1e-6);
    assert.equal(unit.profile.shockScale, 0.5);
    checkInvariants(h.b);
    assert.deepEqual(h.b.errors, []);
  }
});
