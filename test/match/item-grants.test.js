import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, checkInvariants } from './harness.js';
import { PHASE } from '../../shared/constants.js';

const ISO = 'chess_item_6_09_e_a';
const MUELSYSE = 'chess_char_6_11_a';
const HAMMER = 'chess_item_1_01_e_a';

function prep(humans = 8) {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans, fake: true, seed: 31 }).start().toPrep();
  for (const ps of h.m.order) {
    for (const p of ps.allChess()) ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.temp.fill(null);
    ps.offers.length = 0;
    ps.bandId = null;
    ps.funds = 100;
    ps.recompute();
  }
  return h;
}

const items = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');

function buyItem(ps, id) {
  ps.shop.slots[0] = { kind: 'item', id, price: 1, basePrice: 1, sold: false, frozen: false };
  return ps.buy(0);
}

function exhaust(h, id) {
  const cap = h.m.itemPool.cap(id);
  for (let i = 0; i < cap; i++) {
    const ps = h.m.order[i % h.m.order.length];
    assert.ok(ps.acquireItem(id, { fromPool: true }));
  }
  assert.equal(h.m.itemPool.left(id), 0);
  return cap;
}

test('all eight players receive Muelsyse acquisition equipment without using purchase stock', () => {
  const h = prep(), m = h.m;
  assert.equal(m.itemPool.cap(ISO), 6);
  for (const ps of m.order) {
    ps.shop.slots[0] = { kind: 'chess', id: MUELSYSE, price: 6, basePrice: 6, sold: false, frozen: false };
    assert.ok(ps.buy(0).ok, ps.playerId);
    const iso = items(ps).find(p => p.id === ISO);
    assert.ok(iso, ps.playerId);
    assert.equal(iso.poolCopies, 0);
  }
  assert.equal(m.itemPool.held(ISO), 0);
  assert.equal(m.itemPool.left(ISO), 6);
  checkInvariants(m);
  m.dispose();
});

test('Muelsyse and periodic strategy grants succeed after all purchase copies are owned', () => {
  const h = prep(), m = h.m;
  const cap = exhaust(h, ISO);
  const muelsyse = h.ps('p_6'), band = h.ps('p_7');
  assert.ok(muelsyse.acquireChess(MUELSYSE));
  assert.equal(items(muelsyse).filter(p => p.id === ISO).length, 1);
  band.bandId = 'band_damaztic';
  band.recompute();
  for (const round of [5, 10, 15]) {
    m.round = round;
    m.dispatch(band, 'onRoundStart', { round });
  }
  assert.equal(items(band).filter(p => p.id === ISO).length, 3);
  assert.ok(items(band).filter(p => p.id === ISO).every(p => p.poolCopies === 0));
  assert.equal(m.itemPool.held(ISO), cap);
  assert.equal(m.itemPool.left(ISO), 0);
  checkInvariants(m);
  m.dispose();
});

test('equipping and returning granted equipment preserves the separate purchase stock', () => {
  const h = prep(), m = h.m, p = h.ps('p_0');
  const cap = m.itemPool.cap(ISO), gift = p.acquireItem(ISO);
  const owner = give(m, p, 'chess_char_1_01_a');
  assert.equal(gift.poolCopies, 0);
  assert.ok(p.equip(gift.uid, owner.uid).ok);
  assert.equal(m.itemPool.left(ISO), cap);
  assert.ok(p.sell(owner.uid).ok);
  assert.equal(m.itemPool.left(ISO), cap);
  assert.ok(buyItem(p, ISO).ok);
  const bought = items(p).find(x => x.id === ISO && x.poolCopies === 1);
  assert.ok(bought);
  assert.equal(m.itemPool.left(ISO), cap - 1);
  assert.ok(p.destroy(gift.uid).ok);
  assert.equal(m.itemPool.left(ISO), cap - 1);
  assert.ok(p.destroy(bought.uid).ok);
  assert.equal(m.itemPool.left(ISO), cap);
  checkInvariants(m);
  m.dispose();
});

test('an equipment merge retains only its purchased copies, including mixed and granted pairs', () => {
  for (const purchased of [0, 1, 2]) {
    const h = prep(), m = h.m, p = h.ps('p_0');
    const cap = m.itemPool.cap(HAMMER);
    for (let i = 0; i < 2; i++) {
      if (i < purchased) assert.ok(buyItem(p, HAMMER).ok);
      else assert.ok(p.acquireItem(HAMMER));
    }
    const merged = items(p).find(x => m.gd.baseIdOf(x.id) === HAMMER);
    assert.ok(merged && m.gd.isGolden(merged.id));
    assert.equal(merged.poolCopies, purchased);
    assert.equal(m.itemPool.held(HAMMER), purchased);
    assert.equal(m.itemPool.left(HAMMER), cap - purchased);
    assert.ok(p.destroy(merged.uid).ok);
    assert.equal(m.itemPool.left(HAMMER), cap);
    checkInvariants(m);
    m.dispose();
  }
});

test('effect item reward offers remain available when purchase stock is exhausted', () => {
  const h = prep(), m = h.m;
  const cap = exhaust(h, ISO), p = h.ps('p_7');
  assert.ok(p.pushItemOffer([ISO], { source: 'band' }));
  assert.ok(p.pickReward(0).ok);
  assert.equal(items(p).find(x => x.id === ISO).poolCopies, 0);
  assert.equal(m.itemPool.held(ISO), cap);
  assert.equal(buyItem(p, ISO).error, 'SOLD_OUT');
  checkInvariants(m);
  m.dispose();
});

test('free draft equipment grants remain selectable when purchase stock is exhausted', () => {
  const h = prep(), m = h.m;
  const cap = exhaust(h, ISO), p = h.ps('p_7');
  m.phase = PHASE.SP_DRAFT;
  m.sp = { cards: [{ idx: 0, id: ISO, kind: 'item' }], order: [p.playerId], idx: 0, picks: {}, taken: {}, untimed: true };
  assert.equal(m.spCardAvailable(m.sp.cards[0]), true);
  assert.equal(Boolean(m.publicView().sp.cards[0].soldOut), false);
  assert.ok(m.pickCard(p, 0).ok);
  assert.equal(items(p).find(x => x.id === ISO).poolCopies, 0);
  assert.equal(m.itemPool.held(ISO), cap);
  checkInvariants(m);
  m.dispose();
});
