import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const prep = band => makeMatch({ humans: 8, fake: true, seed: 28 }).start().toPrep(1, { band });
const localState = ps => JSON.stringify({ counters: ps.counters, pendingFunds: ps.pendingFunds, offers: ps.offers });
const items = ps => [...ps.hand, ...ps.temp].filter(piece => piece?.kind === 'item');

const counterCases = [
  { band: 'band_kirara', hook: 'onSpend', event: { amount: 40 }, key: 'band:kirara:acc', value: 0, grants: 2 },
  { band: 'band_paganini', hook: 'onSpend', event: { amount: 55 }, key: 'band:paganini:done', value: 1, grants: 1 },
  { band: 'band_pepe', hook: 'onLevelUp', event: { level: 2 }, key: 'band:pepe:special', value: 1 },
  { band: 'band_chiave', hook: 'onRefresh', event: {}, key: 'band:chiave:refreshes', value: 6, repeats: 6, grants: 1 },
];

for (const scenario of counterCases) test(`eight repeated ${scenario.band} strategies keep asymmetric counters and grants player-local`, () => {
  const h = prep(scenario.band), m = h.m;
  try {
    const untouched = m.order.slice(1).map(localState);
    const trigger = ps => {
      const before = ps.round.gainedChess;
      for (let n = 0; n < (scenario.repeats || 1); n++) m.dispatch(ps, scenario.hook, { ...scenario.event });
      assert.equal(ps.counters[scenario.key], scenario.value, ps.playerId);
      if (scenario.grants) assert.equal(ps.round.gainedChess - before, scenario.grants, ps.playerId);
    };
    trigger(m.order[0]);
    assert.deepEqual(m.order.slice(1).map(localState), untouched);
    for (const ps of m.order.slice(1)) trigger(ps);
    assert.ok(m.order.every(ps => ps.counters[scenario.key] === scenario.value));
    if (scenario.band === 'band_paganini') for (const ps of m.order) {
      const before = ps.round.gainedChess;
      m.dispatch(ps, 'onSpend', { amount: 55 });
      assert.equal(ps.round.gainedChess, before, 'one-time reward stays consumed for its owner');
    }
    if (scenario.band === 'band_pepe') {
      m.dispatch(m.order[0], 'onRefresh', {});
      assert.equal(m.order[0].counters[scenario.key], 0);
      assert.ok(m.order.slice(1).every(ps => ps.counters[scenario.key] === 1), 'refresh consumes only its owner charge');
    }
    checkInvariants(m);
    assert.equal(m.dispatcher.errors, 0);
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

for (const band of ['band_cathy', 'band_narant']) test(`eight repeated ${band} strategies queue and claim multiple rewards independently`, () => {
  const h = prep(band), m = h.m;
  try {
    const hook = band === 'band_cathy' ? 'onLevelUp' : 'onRoundStart';
    if (band === 'band_narant') m.round = 2;
    const untouched = m.order.slice(1).map(localState);
    for (let n = 0; n < 2; n++) m.dispatch(m.order[0], hook, { level: 2 });
    assert.equal(m.order[0].offers.length, 2);
    assert.deepEqual(m.order.slice(1).map(localState), untouched);
    for (const ps of m.order.slice(1)) for (let n = 0; n < 2; n++) m.dispatch(ps, hook, { level: 2 });
    assert.ok(m.order.every(ps => ps.offers.length === 2));
    assert.equal(new Set(m.order.map(ps => ps.offers[0])).size, 8, 'offers are separate objects');
    assert.equal(new Set(m.order.map(ps => ps.offers[0].slots)).size, 8, 'slot lists are separate objects');
    const stock = () => Object.keys(DATA.items).map(id => [id, m.itemPool.left(id)]);
    const beforeStock = stock();
    for (let n = 0; n < 2; n++) for (let i = 0; i < m.order.length; i++) {
      const ps = m.order[i];
      const beforeOthers = m.order.filter(other => other !== ps).map(localState);
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.reward', idx: 0 }), { ok: true });
      assert.equal(ps.offers.length, 1 - n);
      assert.deepEqual(m.order.filter(other => other !== ps).map(localState), beforeOthers);
    }
    assert.deepEqual(stock(), beforeStock);
    assert.ok(m.order.every(ps => items(ps).every(piece => piece.poolCopies === 0)));
    checkInvariants(m);
    assert.equal(m.dispatcher.errors, 0);
  } finally { m.dispose(); }
});

test('eight repeated Damaztic strategies receive fixed grants after the entire purchase stock is owned', () => {
  const h = prep('band_damaztic'), m = h.m, id = 'chess_item_6_09_e_a';
  try {
    const cap = m.itemPool.cap(id);
    for (let n = 0; n < cap; n++) assert.ok(m.order[n % 8].acquireItem(id, { fromPool: true }));
    assert.equal(m.itemPool.left(id), 0);
    h.toPrep(5, { band: 'band_damaztic' });
    for (const ps of m.order) assert.equal(items(ps).filter(piece => piece.id === id && piece.poolCopies === 0).length, 1, ps.playerId);
    assert.equal(m.itemPool.held(id), cap);
    h.toPrep(10, { band: 'band_damaztic' });
    for (const ps of m.order) assert.equal(items(ps).filter(piece => piece.id === id && piece.poolCopies === 0).length, 2, ps.playerId);
    assert.equal(m.itemPool.held(id), cap);
    assert.equal(m.itemPool.left(id), 0);
    checkInvariants(m);
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

test('eight repeated Cannot strategies retain each owner funds and calculate its own next-round interest', () => {
  const h = prep('band_cannot'), m = h.m;
  try {
    const balances = [0, 4, 5, 6, 9, 10, 14, 15];
    for (let i = 0; i < m.order.length; i++) {
      m.order[i].funds = balances[i];
      assert.equal(m.order[i].lp, m.gd.startLp('band_cannot'));
    }
    h.toPrep(2, { band: 'band_cannot' });
    for (let i = 0; i < m.order.length; i++) assert.equal(m.order[i].funds, balances[i] + m.gd.income(2) + (balances[i] >= 5 ? 1 : 0), m.order[i].playerId);
    checkInvariants(m);
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});
