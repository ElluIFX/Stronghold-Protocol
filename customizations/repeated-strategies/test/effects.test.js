import { test } from 'node:test';
import assert from 'node:assert/strict';

const run = process.env.SP_PLUGIN_TEST_SET ? {} : { skip: 'run with node tools/plugin.mjs test repeated-strategies' };

test('the installed plugin scales each field medic by the live holder count', run, async () => {
  const { makeBattle } = await import('../../../test/helpers/battleHarness.js');
  const baseline = {};
  for (const [count, multiplier] of [[1, 1], [2, 1.25], [8, 2.75]]) {
    const h = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false, players: [{ playerId: 'p1',
      bandId: 'band_amedic', units: [], bonds: {}, contentInfo: { matchBands: Array(count).fill('band_amedic') } }] });
    h.step();
    const medics = h.b.allyUnits.filter(u => u.defId === 'char_605_cmedic');
    assert.equal(medics.length, 1);
    for (const key of ['atk', 'def', 'maxHp']) {
      if (count === 1) baseline[key] = medics[0].s[key];
      const expected = baseline[key] * multiplier;
      assert.ok(Math.abs(medics[0].s[key] - expected) < 1e-7, `${count} holders: ${key} ${medics[0].s[key]} != ${expected}`);
    }
    assert.deepEqual(h.b.errors, []);
  }
});
