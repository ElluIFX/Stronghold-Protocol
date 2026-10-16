import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { cardPickable } from '../../public/js/ui/choiceOverlay.js';

const PACK = 'chess_item_5_07_e_a';
const byName = name => Object.values(DATA.chess).find(c => !c.isGolden && c.name === name).chessId;

test('four already displayed operator offers may exceed stock; selling first repays the deficit', () => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 11, fake: true }).start().toPrep();
  const m = h.m, id = byName('溯光星源'), ps = [...m.players.values()];
  assert.equal(m.pool.cap(id), 10);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ps[i].acquireChess(id, { fromPool: true });
  assert.equal(m.pool.left(id), 1);
  for (const p of ps) {
    p.funds = 100;
    p.shop.slots[0] = { kind: 'chess', id, basePrice: 3, frozen: true, sold: false };
  }
  assert.equal(m.pool.left(id), 1, 'displaying an offer does not reserve stock');
  for (const p of ps) {
    const funds = p.funds; assert.ok(p.buy(0).ok, 'every pre-existing offer stays purchasable');
    assert.equal(p.funds, funds - 3); assert.equal(p.shop.slots[0].sold, true);
    assert.equal(p.buy(0).error, 'SOLD_OUT', 'the same offer cannot be bought twice');
  }
  assert.equal(m.pool.entries.get(id).left, -3); assert.equal(m.pool.left(id), 0);
  assert.equal(m.pool.roll(m.rngShop, { tier: 6, filter: candidate => candidate === id }), null);
  for (let i = 0; i < 4; i++) {
    const piece = ps[i].allChess().find(c => c.id === id); assert.ok(piece);
    assert.ok(ps[i].sell(piece.uid).ok);
    assert.equal(m.pool.left(id), Math.max(0, i - 2));
    checkInvariants(m);
  }
  m.dispose();
});
test('duplicate free draft cards remain available after purchase stock is exhausted', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  a.acquireItem(PACK, { fromPool: true });
  a.acquireItem(PACK, { fromPool: true });
  assert.equal(m.itemPool.left(PACK), 0);
  m.phase = PHASE.SP_DRAFT;
  m.sp = { cards: [PACK, PACK, 'chess_item_1_01_e_a'].map((id, idx) => ({ idx, id, kind: 'item' })),
    order: ['p_0', 'p_1'], idx: 0, picks: {}, taken: {}, untimed: true };
  assert.ok(m.pickCard(a, 0).ok); assert.equal(m.spTurn(), 'p_1');
  const card = m.publicView().sp.cards[1]; assert.notEqual(card.soldOut, true);
  assert.equal(cardPickable({ turnPid: 'p_1', pickOf: new Map() }, card, { myId: 'p_1', solo: false }), true);
  assert.ok(m.pickCard(b, 1).ok);
  assert.equal(m.itemPool.held(PACK), 2, 'both free picks occupy zero additional purchase copies');
  checkInvariants(m); m.dispose();
});
test('measured operator capacities and exceptions: co-op doubles shared stock and preserves each player\'s private 自选 stock', () => {
  const solo = new GameData(DATA, 'mode_single_normal'), coop = new GameData(DATA, 'mode_multi_normal');
  for (const [name, n] of [['普罗旺斯', 10], ['跃跃', 10], ['风丸', 8], ['蒂比', 12], ['哈洛德', 14], ['缪尔赛思', 5]]) {
    assert.equal(solo.poolCopies(byName(name)), n, name); assert.equal(coop.poolCopies(byName(name)), 2 * n, name);
  }
  for (const [slot, n] of [['chess_char_5_diy1_a', 8], ['chess_char_5_diy2_a', 8], ['chess_char_6_diy1_a', 5], ['chess_char_6_diy2_a', 5]]) {
    assert.equal(solo.poolCopies(slot), n, slot); assert.equal(coop.poolCopies(slot), n, slot);
  }
  assert.equal(solo.itemPoolCopies(PACK), 2); assert.equal(coop.itemPoolCopies(PACK), 2);
});

test('an operator reward arrives after stock exhaustion without occupying another copy', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1'), id = byName('溯光星源');
  a.pushRewardOffer('test', { ids: [id] });
  for (let i = 0; i < m.pool.cap(id); i++) b.acquireChess(id, { fromPool: true });
  assert.equal(m.pool.left(id), 0);
  assert.ok(a.pickReward(0).ok); assert.equal(a.offers.length, 0);
  assert.ok(a.allChess().some(c => c.id === id));
  assert.equal(m.pool.entries.get(id).left, 0);
  assert.equal(a.allChess().find(c => c.id === id).poolCopies, 0);
  checkInvariants(m); m.dispose();
});

test('shared equipment occupancy includes hand/equipped/elite, never displayed offers; destroying frees stock', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  assert.equal(m.itemPool.left(PACK), 2);
  a.funds = 10; const slot = a.shop.slots.findIndex(s => s?.kind === 'item');
  assert.ok(slot >= 0); a.shop.slots[slot] = { kind: 'item', id: PACK, basePrice: 1, sold: false, frozen: true };
  a.pushItemOffer([PACK]); assert.equal(m.itemPool.left(PACK), 2, 'display reserves nothing');
  const x = a.acquireItem(PACK, { fromPool: true }), y = b.acquireItem(PACK, { fromPool: true }); assert.ok(x && y);
  assert.equal(m.itemPool.left(PACK), 0);
  // Buying displayed cards while empty is the debt test below. This one keeps them on screen
  // and checks occupancy: equipping and selling do not free stock.
  const id = [...m.pool.entries.keys()].find(id => m.gd.tierOf(id) === 1), owner = give(m, a, id);
  assert.ok(a.equip(x.uid, owner.uid).ok); assert.equal(m.itemPool.held(PACK), 2);
  assert.ok(a.sell(owner.uid).ok); assert.equal(m.itemPool.held(PACK), 2, 'selling returns equipment to hand, not to stock');
  assert.ok(a.destroy(x.uid).ok); assert.equal(m.itemPool.left(PACK), 1);
  assert.ok(a.buy(slot).ok, 'a third purchase is legal after one of the two owned copies was destroyed');
  assert.equal(m.itemPool.left(PACK), 0);
  b.eliminate(1); assert.equal(m.itemPool.left(PACK), 1);
  const gold = a.acquireItem(PACK, { fromPool: true }); assert.ok(gold && m.gd.isGolden(gold.id));
  assert.equal(m.itemPool.held(PACK), 2, 'one upgraded item occupies two normal copies');
  assert.ok(a.destroy(gold.uid).ok); assert.equal(m.itemPool.left(PACK), 2);
  checkInvariants(m); m.dispose();
});

test('already displayed equipment stays buyable after stock runs out; release repays the debt first', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  assert.equal(m.itemPool.cap(PACK), 2);
  a.funds = 50; b.funds = 50;
  const slotA = a.shop.slots.findIndex((s) => s?.kind === 'item');
  const slotB = b.shop.slots.findIndex((s) => s?.kind === 'item');
  assert.ok(slotA >= 0 && slotB >= 0);
  a.shop.slots[slotA] = { kind: 'item', id: PACK, basePrice: 1, sold: false, frozen: true };
  b.shop.slots[slotB] = { kind: 'item', id: PACK, basePrice: 1, sold: false, frozen: true };
  a.pushItemOffer([PACK]);
  assert.equal(a.offers[0].slots[0].id, PACK);
  assert.equal(m.itemPool.left(PACK), 2, 'display reserves nothing');
  assert.ok(b.acquireItem(PACK, { fromPool: true }));
  assert.ok(b.acquireItem(PACK, { fromPool: true }), 'the second purchase merges into the golden and fills the cap');
  assert.equal(m.itemPool.left(PACK), 0);
  assert.equal(m.itemPool.debtOf(PACK), 0);
  const funds = a.funds;
  assert.ok(a.buy(slotA).ok, 'the displayed shop card stays purchasable');
  assert.equal(a.funds, funds - 1);
  assert.equal(a.shop.slots[slotA].sold, true);
  assert.equal(a.buy(slotA).error, 'SOLD_OUT', 'the same card cannot be bought twice');
  assert.equal(a.funds, funds - 1);
  assert.equal(m.itemPool.debtOf(PACK), 1);
  assert.equal(m.itemPool.rawLeft(PACK), -1);
  assert.equal(m.itemPool.left(PACK), 0);
  const normal = [...a.hand, ...a.temp].find((p) => p && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(normal && !m.gd.isGolden(normal.id));
  assert.ok(a.pickReward(0).ok, 'the displayed reward stays claimable');
  assert.equal(a.offers.length, 0);
  // The free reward completes the pair and the golden retains only the purchased input's copy.
  assert.equal(m.itemPool.debtOf(PACK), 1);
  assert.equal(m.itemPool.held(PACK), 3);
  assert.equal(m.itemPool.left(PACK), 0);
  checkInvariants(m);
  for (let i = 0; i < 40; i++) {
    assert.notEqual(m.pool.rollItem(m.rngShop, 6, m.itemPool), PACK);
  }
  const beforeB = b.funds;
  assert.ok(b.buy(slotB).ok, 'the other player\'s displayed card is its own purchase');
  assert.equal(b.funds, beforeB - 1);
  assert.equal(b.buy(slotB).error, 'SOLD_OUT');
  // b already holds the golden, so this normal does not merge.
  assert.equal(m.itemPool.debtOf(PACK), 2);
  assert.equal(m.itemPool.held(PACK), 4);
  checkInvariants(m);
  const carrierId = [...m.pool.entries.keys()].find((id) => m.gd.tierOf(id) === 1);
  const carrier = give(m, b, carrierId);
  const worn = [...b.hand, ...b.temp].find((p) => p && p.kind === 'item' && !m.gd.isGolden(p.id) && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(b.equip(worn.uid, carrier.uid).ok);
  assert.equal(m.itemPool.debtOf(PACK), 2, 'equipping moves the copy; it does not repay');
  assert.ok(b.sell(carrier.uid).ok);
  assert.equal(m.itemPool.held(PACK), 4, 'selling returns equipment to the hand');
  assert.equal(m.itemPool.debtOf(PACK), 2);
  const returned = [...b.hand, ...b.temp].find((p) => p && p.kind === 'item' && !m.gd.isGolden(p.id) && m.gd.baseIdOf(p.id) === PACK);
  const tempAt = b.temp.findIndex((p) => p == null);
  assert.ok(tempAt >= 0);
  const handAt = b.hand.indexOf(returned);
  assert.ok(handAt >= 0);
  b.hand[handAt] = null;
  b._putTemp(tempAt, returned);
  b.resolveTemp();
  assert.equal(m.itemPool.debtOf(PACK), 1, 'a temp wipe repays one copy and leaves the rest of the debt');
  assert.equal(m.itemPool.held(PACK), 3);
  assert.equal(m.itemPool.left(PACK), 0);
  checkInvariants(m);
  const aGold = [...a.hand, ...a.temp].find((p) => p && m.gd.isGolden(p.id) && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(a.destroy(aGold.uid).ok);
  assert.equal(m.itemPool.debtOf(PACK), 0);
  assert.equal(m.itemPool.held(PACK), 2);
  assert.equal(m.itemPool.left(PACK), 0, 'stock stays empty until the debt is cleared and a copy is actually free');
  checkInvariants(m);
  b.eliminate(1);
  assert.equal(m.itemPool.debtOf(PACK), 0);
  assert.equal(m.itemPool.held(PACK), 0);
  assert.equal(m.itemPool.left(PACK), 2);
  assert.equal(m.itemPool.canGain(PACK), true);
  checkInvariants(m);
  m.dispose();
});

test('a free golden reward occupies no copies while purchase stock is partly occupied', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  const gold = m.gd.item(PACK).goldenId || m.gd.item(PACK).upgradeChessId;
  assert.ok(gold && m.gd.isGolden(gold));
  assert.equal(m.itemPool.need(gold), 2);
  assert.ok(a.pushItemOffer([gold]), 'a golden still fits while both copies are free');
  assert.ok(b.acquireItem(PACK, { fromPool: true }));
  assert.equal(m.itemPool.left(PACK), 1);
  assert.ok(a.pickReward(0).ok);
  assert.equal(m.itemPool.debtOf(PACK), 0);
  assert.equal(m.itemPool.held(PACK), 1);
  assert.equal(m.itemPool.left(PACK), 1);
  checkInvariants(m);
  m.dispose();
});

test('整备 upgrades a purchase at the shared cap without taking another copy', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  const KEY = 'effect:builtin_next_buy_golden_item';
  assert.ok(b.acquireItem(PACK, { fromPool: true }));
  assert.equal(m.itemPool.left(PACK), 1);
  a.effects.push({ id: 'zb', key: KEY, name: '整备', counter: 1, battle: false });
  a.funds = 50;
  const slot = a.shop.slots.findIndex((s) => s?.kind === 'item');
  assert.ok(slot >= 0);
  a.shop.slots[slot] = { kind: 'item', id: PACK, basePrice: 1, sold: false, frozen: true };
  assert.ok(a.buy(slot).ok);
  const piece = [...a.hand, ...a.temp].find((p) => p && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(piece);
  assert.equal(m.gd.isGolden(piece.id), true, 'the last purchased copy may become golden');
  assert.equal(piece.poolCopies, 1, 'the free upgrade retains its one purchased copy');
  assert.equal(a.effects.some((e) => e.key === KEY), false, 'the charge is spent');
  assert.equal(m.itemPool.held(PACK), m.itemPool.cap(PACK));
  checkInvariants(m);
  const owned = [...b.hand, ...b.temp].find((p) => p && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(b.destroy(owned.uid).ok);
  assert.equal(m.itemPool.left(PACK), 1, 'the freed copy is available again');
  checkInvariants(m);
  m.dispose();
});

test('整备 upgrades capped and uncapped purchases without topping up their stock', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0');
  const KEY = 'effect:builtin_next_buy_golden_item';
  const uncapped = 'chess_item_2_03_e_a';
  assert.equal(m.itemPool.cap(uncapped), null);
  assert.equal(m.itemPool.left(PACK), 2);
  a.effects.push({ id: 'zb', key: KEY, name: '整备', counter: 1, battle: false });
  a.funds = 50;
  const slot = a.shop.slots.findIndex((s) => s?.kind === 'item');
  assert.ok(slot >= 0);
  a.shop.slots[slot] = { kind: 'item', id: PACK, basePrice: 1, sold: false, frozen: true };
  assert.ok(a.buy(slot).ok);
  const piece = [...a.hand, ...a.temp].find((p) => p && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(piece && m.gd.isGolden(piece.id));
  assert.equal(m.itemPool.held(PACK), 1);
  assert.equal(a.effects.some((e) => e.key === KEY), false, 'the charge is spent');
  a.effects.push({ id: 'zb2', key: KEY, name: '整备', counter: 1, battle: false });
  const slot2 = slot === 0 ? 1 : 0;
  assert.ok(a.shop.slots.length > slot2);
  a.shop.slots[slot2] = { kind: 'item', id: uncapped, basePrice: 1, sold: false, frozen: true };
  assert.ok(a.buy(slot2).ok);
  const free = [...a.hand, ...a.temp].find((p) => p && m.gd.baseIdOf(p.id) === uncapped);
  assert.ok(free && m.gd.isGolden(free.id), 'an uncapped item may still become golden');
  checkInvariants(m);
  m.dispose();
});

test('consumed equipment releases its stock; effect-only items have no shared shop cap', () => {
  const h = makeMatch({ mode: 'solo', seed: 11, fake: true }).start().toPrep();
  const m = h.m, p = h.ps('p_0'), id = [...m.pool.entries.keys()][0], owner = give(m, p, id);
  const item = 'chess_item_1_04_e_a', before = m.itemPool.left(item);
  const piece = p.acquireItem(item, { fromPool: true }); assert.ok(piece); assert.equal(m.itemPool.left(item), before - 1);
  assert.ok(p.equip(piece.uid, owner.uid).ok); assert.equal(p.find(piece.uid), null); assert.equal(m.itemPool.left(item), before);
  assert.equal(m.itemPool.cap('chess_item_2_03_e_a'), null);
  checkInvariants(m); m.dispose();
});

test('Mimic grants a free copy while merged purchases retain their original stock occupation', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 11, fake: true }).start().toPrep();
  const m = h.m, p = h.ps('p_0');
  const id = [...m.pool.entries.keys()].find(id => m.gd.tierOf(id) === 6);
  assert.equal(m.pool.cap(id), 5);
  for (let i = 0; i < 5; i++) p.acquireChess(id, { fromPool: true });
  const target = p.allChess().find(c => c.id === id);
  assert.ok(target); assert.equal(m.pool.left(id), 0);
  const mimic = p.acquireItem('chess_item_5_05_e_a'); assert.ok(mimic);
  assert.ok(p.equip(mimic.uid, target.uid).ok);
  assert.equal(p.allChess().filter(c => m.gd.baseIdOf(c.id) === id).length, 2);
  assert.equal(m.pool.entries.get(id).left, 0);
  assert.equal(m.pool.left(id), 0); checkInvariants(m);
  const elite = p.allChess().find(c => m.gd.baseIdOf(c.id) === id);
  const purchasedCopies = elite.poolCopies;
  assert.ok(p.sell(elite.uid).ok); assert.equal(m.pool.left(id), purchasedCopies); checkInvariants(m); m.dispose();
});
