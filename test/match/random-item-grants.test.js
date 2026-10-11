import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const ISO = 'chess_item_6_09_e_a';
const POOLS = {
  grant_weighted: { kind: 'equip', weighted: [[ISO, 5]] },
  grant_items: { kind: 'equip', items: [ISO] },
  grant_tiers: { kind: 'equip', tiers: [6] },
  grant_level: { kind: 'equip', maxTier: 'shopLevel' },
};

function exhaustedMatch() {
  const data = {
    ...DATA,
    items: Object.fromEntries(Object.entries(DATA.items).map(([id, item]) => [id, id === ISO ? item : { ...item, hideInShop: true }])),
    choices: { ...DATA.choices, pools: { ...DATA.choices.pools, ...POOLS } },
  };
  const h = makeMatch({ data, mode: 'coop', difficulty: 'HARD', humans: 8, seed: 31, fake: true }).start().toPrep();
  for (const ps of h.m.order) {
    for (const piece of ps.allChess()) ps.returnCopies(piece);
    ps.board.clear();
    ps.hand.fill(null);
    ps.temp.fill(null);
    ps.offers.length = 0;
    ps.bandId = null;
    ps.recompute();
  }
  const cap = h.m.itemPool.cap(ISO);
  for (let i = 0; i < cap; i++) assert.ok(h.m.order[i].acquireItem(ISO, { fromPool: true }));
  assert.equal(h.m.itemPool.left(ISO), 0);
  return h;
}

for (const pool of Object.keys(POOLS)) {
  test(`random equipment grant selects exhausted purchase identity from ${pool}`, () => {
    const h = exhaustedMatch(), m = h.m, p = h.ps('p_7');
    const roll = m.rollPool(pool, { shopLevel: 6 });
    assert.deepEqual(roll, { kind: 'item', id: ISO });
    const gift = p.acquireItem(roll.id);
    assert.ok(gift);
    assert.equal(gift.poolCopies, 0);
    assert.equal(m.itemPool.held(ISO), m.itemPool.cap(ISO));
    assert.equal(m.itemPool.left(ISO), 0);
    checkInvariants(m);
    m.dispose();
  });
}

for (const options of [{ tier: 6 }, { maxTier: 6 }]) {
  test(`plain random equipment grant ignores exhausted purchase stock with ${JSON.stringify(options)}`, () => {
    const h = exhaustedMatch(), m = h.m, p = h.ps('p_7');
    const id = m.rollItemId(options);
    assert.equal(id, ISO);
    assert.equal(p.acquireItem(id).poolCopies, 0);
    assert.equal(m.itemPool.held(ISO), m.itemPool.cap(ISO));
    assert.equal(m.itemPool.left(ISO), 0);
    checkInvariants(m);
    m.dispose();
  });
}
