import { test } from 'node:test';
import assert from 'node:assert/strict';

const run = process.env.SP_PLUGIN_TEST_SET ? {} : { skip: 'run with node tools/plugin.mjs test repeated-strategies' };

test('the installed plugin scales each field medic by the live holder count', run, async () => {
  const { makeBattle } = await import('../../../test/helpers/battleHarness.js');
  for (const count of [1, 2, 8]) {
    const h = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false, players: [{ playerId: 'p1',
      bandId: 'band_amedic', units: [], bonds: {}, contentInfo: { matchBands: Array(count).fill('band_amedic') } }] });
    h.step();
    const medics = h.b.allyUnits.filter(u => u.defId === 'char_605_cmedic');
    assert.equal(medics.length, 1);
    for (const key of ['atk', 'def', 'maxHp']) assert.equal(medics[0].s[key], medics[0].base[key] * (1 + 0.25 * (count - 1)));
    assert.deepEqual(h.b.errors, []);
  }
});

test('the installed global handler runs once per living Ducklord holder', run, async () => {
  const { makeMatch } = await import('../../../test/match/harness.js');
  const h = makeMatch({ mode: 'coop', humans: 8, fake: true }).start().toPrep(1);
  try {
    h.m.round = 5;
    for (const p of h.m.order) p.bandId = 'band_ducklord';
    h.m.rngMeta = Object.assign(() => 0, { int: n => n - 1, pick: list => list[0], shuffle: list => [...list] });
    const ev = { kind: 'normal', spawns: [{ enemyKey: 'enemy_1000_gopro_2', time: 0, count: 100, interval: 1 }],
      input: h.m.order[0].battleInput() };
    h.m.dispatch(h.m.order[0], 'onBattleStart', ev);
    assert.equal(ev.spawns.filter(s => s.tag === 'duck').length, 16);
  } finally { h.m.dispose(); }
});
