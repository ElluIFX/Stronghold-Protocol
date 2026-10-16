import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';

function prep() {
  const data = { ...DATA, choices: { ...DATA.choices, pools: { ...DATA.choices.pools } } };
  const h = makeMatch({ data, mode: 'coop', difficulty: 'HARD', humans: 8, seed: 31, fake: true }).start().toPrep();
  for (const ps of h.m.order) {
    for (const piece of ps.allChess()) ps.returnCopies(piece);
    ps.board.clear();
    ps.hand.fill(null);
    ps.temp.fill(null);
    ps.offers.length = 0;
    ps.bandId = null;
    ps.funds = 100;
    ps.recompute();
  }
  h.chessId = [...h.m.pool.entries.keys()].find(id => h.m.gd.tierOf(id) === 6 && id !== 'chess_char_6_11_a');
  assert.ok(h.chessId);
  return h;
}

function buy(ps, id) {
  ps.shop.slots[0] = { kind: 'chess', id, price: 6, basePrice: 6, sold: false, frozen: false };
  return ps.buy(0);
}

function exhaust(h) {
  const cap = h.m.pool.cap(h.chessId);
  for (let i = 0; i < cap; i++) assert.ok(h.m.order[i % h.m.order.length].acquireChess(h.chessId, { fromPool: true }));
  assert.equal(h.m.pool.left(h.chessId), 0);
  return cap;
}

test('gifted operators at exhausted purchase stock own no pool copies and displayed purchases overdraw', () => {
  const h = prep(), m = h.m, p = h.ps('p_7');
  const cap = exhaust(h), copiesBefore = p.allChess().filter(x => m.gd.baseIdOf(x.id) === h.chessId).reduce((n, x) => n + x.poolCopies, 0);
  const gift = p.acquireChess(h.chessId);
  assert.ok(gift);
  assert.equal(p.allChess().filter(x => m.gd.baseIdOf(x.id) === h.chessId).reduce((n, x) => n + x.poolCopies, 0), copiesBefore);
  assert.equal(m.pool.entries.get(h.chessId).left, 0);
  assert.ok(buy(p, h.chessId).ok);
  assert.equal(m.pool.cap(h.chessId), cap);
  checkInvariants(m);
  m.dispose();
});

test('operator merging retains exactly the purchased copies in mixed and gifted sets', () => {
  for (const purchased of [0, 1, 2, 3]) {
    const h = prep(), m = h.m, p = h.ps('p_0'), cap = m.pool.cap(h.chessId);
    for (let i = 0; i < 3; i++) {
      if (i < purchased) assert.ok(buy(p, h.chessId).ok);
      else assert.ok(p.acquireChess(h.chessId));
    }
    const merged = p.allChess().find(x => m.gd.baseIdOf(x.id) === h.chessId);
    assert.ok(merged && m.gd.isGolden(merged.id));
    assert.equal(merged.poolCopies, purchased);
    assert.equal(m.pool.left(h.chessId), cap - purchased);
    assert.ok(p.sell(merged.uid).ok);
    assert.equal(m.pool.left(h.chessId), cap);
    checkInvariants(m);
    m.dispose();
  }
});

test('operator promotion preserves gifted and purchased occupancy', () => {
  for (const purchased of [false, true]) {
    const h = prep(), m = h.m, p = h.ps('p_0'), cap = m.pool.cap(h.chessId);
    const piece = p.acquireChess(h.chessId, { fromPool: purchased });
    assert.ok(p.promote(piece));
    assert.ok(m.gd.isGolden(piece.id));
    assert.equal(piece.poolCopies, Number(purchased));
    assert.equal(m.pool.left(h.chessId), cap - Number(purchased));
    checkInvariants(m);
    m.dispose();
  }
});

test('operator rewards accept exhausted identities without taking purchase copies', () => {
  const h = prep(), m = h.m, p = h.ps('p_7');
  exhaust(h);
  assert.ok(p.pushRewardOffer('effect', { ids: [h.chessId] }));
  assert.ok(p.pickReward(0).ok);
  assert.equal(m.pool.entries.get(h.chessId).left, 0);
  assert.ok(buy(p, h.chessId).ok);
  checkInvariants(m);
  m.dispose();
});

for (const shape of ['weighted', 'items', 'tier']) {
  test(`random operator grant draws exhausted identity from ${shape} pool`, () => {
    const h = prep(), m = h.m;
    exhaust(h);
    const pool = shape === 'weighted' ? { weighted: [[h.chessId, 5]] }
      : shape === 'items' ? { items: [h.chessId] }
        : { tier: 6, bond: m.gd.chess(h.chessId).bonds[0] };
    m.gd.choices.pools.grant_chess = { kind: 'chess', ...pool };
    if (shape === 'tier') {
      const entries = m.pool.entries;
      m.pool.entries = new Map([[h.chessId, entries.get(h.chessId)]]);
      const roll = m.rollPool('grant_chess');
      m.pool.entries = entries;
      assert.deepEqual(roll, { kind: 'chess', id: h.chessId, golden: false });
    } else {
      assert.deepEqual(m.rollPool('grant_chess'), { kind: 'chess', id: h.chessId, golden: false });
    }
    assert.equal(m.pool.entries.get(h.chessId).left, 0);
    checkInvariants(m);
    m.dispose();
  });
}
