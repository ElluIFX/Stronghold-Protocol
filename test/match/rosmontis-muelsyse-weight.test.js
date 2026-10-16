import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeCtx } from '../../server/match/effectsMeta.js';

const MU = 'chess_char_6_11_a';
const ROS = 'chess_char_6_12_a';
const OK = { ok: true };

function prep(humans = 8) {
  const h = makeMatch({ mode: 'coop', humans, seed: 17, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  for (const ps of m.players.values()) {
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.bandId = null; ps.counters = {}; ps.funds = 100; ps.shop.level = 6;
    ps.recompute();
  }
  m.pool.entries = new Map([MU, ROS].map((id) => {
    const cap = m.gd.poolCopies(id);
    return [id, { cap, left: cap, tier: 6 }];
  }));
  m.rngShop = () => 0.6;
  return { h, m, ps: h.ps('p_0') };
}

test('Rosmontis ownership changes equal shop weights to exact 4:1 until Muelsyse is acquired', () => {
  const { m, ps } = prep();
  assert.equal(ps._rollChessSlot().id, ROS, 'equal weights: 0.6 is beyond Muelsyse half');
  assert.ok(ps.acquireChess(ROS));
  for (const [r, id] of [[0, MU], [0.799999, MU], [0.8, ROS], [0.999999, ROS]]) {
    m.rngShop = () => r;
    assert.equal(ps._rollChessSlot().id, id, `weighted boundary ${r}`);
  }
  assert.ok(ps.acquireChess(MU));
  m.rngShop = () => 0.6;
  assert.equal(ps._rollChessSlot().id, ROS, 'first successful Muelsyse gain consumes the boost');
  m.dispose();
});

test('first Muelsyse gain is independent for eight players across purchase, reward and gift', () => {
  const { m } = prep();
  const players = [...m.players.values()];
  for (const ps of players) assert.ok(ps.acquireChess(ROS));
  for (let i = 0; i < players.length; i++) {
    const ps = players[i];
    assert.equal(ps._rollChessSlot().id, MU, `player ${i} still has boost`);
    if (i % 3 === 0) {
      ps.shop.slots = [{ kind: 'chess', id: MU, basePrice: 4, sold: false, frozen: false }];
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.buy', slot: 0 }), OK);
    } else if (i % 3 === 1) {
      assert.ok(ps.pushRewardOffer('test', { ids: [MU] }));
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.reward', idx: 0 }), OK);
    } else assert.ok(ps.acquireChess(MU, { source: 'gift' }));
    assert.equal(ps._rollChessSlot().id, ROS, `player ${i} boost consumed`);
    for (const next of players.slice(i + 1)) assert.equal(next._rollChessSlot().id, MU, 'other players retain boost');
  }
  m.dispose();
});

test('Muelsyse obtained before Rosmontis permanently consumes the first-acquisition boost', () => {
  const { m, ps } = prep();
  const mu = ps.acquireChess(MU);
  assert.ok(mu);
  const loc = ps.find(mu.uid);
  ps._detach(loc);
  assert.ok(ps.acquireChess(ROS));
  assert.equal(ps._rollChessSlot().id, ROS);
  m.dispose();
});

test('failed Muelsyse gain does not consume weighting and promotion offers use the same 4:1 draw', () => {
  const { m, ps } = prep();
  assert.ok(ps.acquireChess(ROS));
  const stow = ps.stow;
  ps.stow = () => null;
  assert.equal(ps.acquireChess(MU), null);
  ps.stow = stow;
  assert.equal(ps._rollChessSlot().id, MU);
  const boosted = ps.pushRewardOffer('merge', { tier: 6 });
  assert.equal(boosted.slots[0].id, MU);
  assert.ok(ps.acquireChess(MU));
  const normal = ps.pushRewardOffer('merge', { tier: 6 });
  assert.equal(normal.slots[0].id, ROS);
  m.dispose();
});

test('other operator grants and strategy reward draws retain ordinary weights', () => {
  const { m, ps } = prep();
  assert.ok(ps.acquireChess(ROS));
  m.rngMeta = () => 0.6;
  const ctx = makeCtx(m, ps, { key: 'test' }, 'onTest');
  assert.equal(ctx.rollChess({ tier: 6 }), ROS);
  assert.equal(ps.pushRewardOffer('band', { tier: 6 }).slots[0].id, ROS);
  assert.equal(ps.pushRewardOffer('merge', { tier: 6 }).slots[0].id, MU);
  m.dispose();
});

test('first Muelsyse merge consumes weighting before generating its own recruitment offer', () => {
  const { m, ps } = prep();
  assert.ok(ps.acquireChess(ROS));
  for (let i = 0; i < 2; i++) assert.ok(ps.stow(ps.newPiece('chess', MU, { poolCopies: 0 })));
  const elite = ps.acquireChess(MU);
  assert.equal(elite.id, 'chess_char_6_11_b');
  assert.equal(ps.offers[0].source, 'merge');
  assert.equal(ps.offers[0].slots[0].id, ROS);
  assert.equal(ps._rollChessSlot().id, ROS);
  m.dispose();
});

test('elite Rosmontis activates weighting and transformation to elite Muelsyse consumes it', () => {
  const { m, ps } = prep();
  assert.ok(ps.acquireChess('chess_char_6_12_b'));
  assert.equal(ps._rollChessSlot().id, MU);
  const other = ps.acquireChess(ROS);
  assert.ok(ps.transformChess(other, 'chess_char_6_11_b'));
  assert.equal(ps._rollChessSlot().id, ROS);
  m.dispose();
});

test('Rosmontis removal suspends the unconsumed boost and reacquisition restores it', () => {
  const { m, ps } = prep();
  const ros = ps.acquireChess(ROS);
  assert.ok(ros);
  assert.equal(ps._rollChessSlot().id, MU);
  ps._detach(ps.find(ros.uid));
  assert.equal(ps._rollChessSlot().id, ROS);
  assert.ok(ps.acquireChess(ROS));
  assert.equal(ps._rollChessSlot().id, MU);
  m.dispose();
});
