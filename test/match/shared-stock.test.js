import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { cardPickable } from '../../public/js/ui/choiceOverlay.js';

const PACK = 'chess_item_5_07_e_a';
const byName = name => Object.values(DATA.chess).find(c => !c.isGolden && c.name === name).chessId;
test('duplicate draft equipment grants leave purchase stock available', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11, fake: true }).start().toPrep();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  a.acquireItem(PACK, { fromPool: true });
  m.phase = PHASE.SP_DRAFT;
  m.sp = { cards: [PACK, PACK, 'chess_item_1_01_e_a'].map((id, idx) => ({ idx, id, kind: 'item' })),
    order: ['p_0', 'p_1'], idx: 0, picks: {}, taken: {}, untimed: true };
  assert.ok(m.pickCard(a, 0).ok); assert.equal(m.spTurn(), 'p_1');
  const card = m.publicView().sp.cards[1]; assert.equal(Boolean(card.soldOut), false);
  assert.equal(cardPickable({ turnPid: 'p_1', pickOf: new Map() }, card, { myId: 'p_1', solo: false }), true);
  assert.ok(m.pickCard(b, 1).ok);
  assert.equal(m.itemPool.held(PACK), 1);
  checkInvariants(m); m.dispose();
});
test('measured operator capacities and exceptions: co-op doubles shared stock, never private DIY stock', () => {
  const solo = new GameData(DATA, 'mode_single_normal'), coop = new GameData(DATA, 'mode_multi_normal');
  for (const [name, n] of [['普罗旺斯', 10], ['跃跃', 10], ['风丸', 8], ['蒂比', 12], ['哈洛德', 14], ['缪尔赛思', 5]]) {
    assert.equal(solo.poolCopies(byName(name)), n, name); assert.equal(coop.poolCopies(byName(name)), 2 * n, name);
  }
  assert.equal(coop.poolCopies('chess_char_6_diy1_a'), solo.poolCopies('chess_char_6_diy1_a'));
  assert.equal(solo.itemPoolCopies(PACK), 2); assert.equal(coop.itemPoolCopies(PACK), 2);
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
  const money = a.funds;
  assert.equal(a.buy(slot).error, 'SOLD_OUT'); assert.equal(a.funds, money); assert.equal(a.shop.slots[slot].sold, false);
  assert.equal(a.offers.length, 1);
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
  assert.ok(a.pickReward(0).ok);
  assert.equal(m.itemPool.left(PACK), 2);
  checkInvariants(m); m.dispose();
});

test('整备 upgrades the last purchase copy without taking another stock copy', () => {
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
  assert.equal(m.gd.isGolden(piece.id), true);
  assert.equal(piece.poolCopies, 1);
  assert.equal(a.effects.some((e) => e.key === KEY), false, 'the charge is spent');
  assert.equal(m.itemPool.held(PACK), m.itemPool.cap(PACK));
  checkInvariants(m);
  const owned = [...b.hand, ...b.temp].find((p) => p && m.gd.baseIdOf(p.id) === PACK);
  assert.ok(b.destroy(owned.uid).ok);
  assert.equal(m.itemPool.left(PACK), 1, 'the freed copy is available again');
  checkInvariants(m);
  m.dispose();
});

test('整备 preserves purchase occupancy when upgrading capped and uncapped items', () => {
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
  assert.equal(piece.poolCopies, 1);
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

test('Mimic grants merge without taking purchase stock and releases only purchased copies on sale', () => {
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
  const copies = elite.poolCopies;
  assert.ok(p.sell(elite.uid).ok); assert.equal(m.pool.left(id), copies); checkInvariants(m); m.dispose();
});
