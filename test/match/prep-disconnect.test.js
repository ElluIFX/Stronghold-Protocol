import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

function prep(t, humans = 2) {
  const h = makeMatch({ humans, seed: 63, fake: true }).start();
  t.after(() => h.m.dispose());
  h.toPrep();
  return h;
}

test('the last connected human readies: disconnected seats resolve before the original prep deadline', (t) => {
  const h = prep(t);
  const disconnected = h.ps('p_1');
  const deadline = h.m.deadline;
  h.m.onDisconnect('p_1');
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.run(() => h.m.phase !== PHASE.PREP);
  assert.ok(h.sched.now() < deadline);
  assert.equal(disconnected.ready, true);
  assert.ok(h.m.fields.some((f) => f.players.includes('p_1')));
});

test('disconnecting the final unready chooser ends a prep that has a connected ready human', (t) => {
  const h = prep(t);
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  assert.equal(h.m.phase, PHASE.PREP);
  h.m.onDisconnect('p_1');
  h.sched.advance(0);
  assert.notEqual(h.m.phase, PHASE.PREP);
  assert.equal(h.ps('p_1').ready, true);
});

test('a reconnection before the queued prep end lets that human keep choosing', (t) => {
  const h = prep(t);
  h.m.onDisconnect('p_1');
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.m.onReconnect('p_1');
  h.sched.advance(0);
  assert.equal(h.m.phase, PHASE.PREP);
  assert.equal(h.ps('p_1').ready, false);
  h.m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.advance(0);
  assert.notEqual(h.m.phase, PHASE.PREP);
});

test('a connected human returning ready releases an otherwise disconnected prep', (t) => {
  const h = prep(t);
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.m.onDisconnect('p_0');
  h.m.onDisconnect('p_1');
  h.sched.advance(0);
  assert.equal(h.m.phase, PHASE.PREP);
  h.m.onReconnect('p_0');
  h.sched.advance(0);
  assert.notEqual(h.m.phase, PHASE.PREP);
});

test('a disconnected autoplay seat still has to finish its bot preparation', (t) => {
  const h = prep(t);
  h.ps('p_1').autoplay = true;
  h.m.onDisconnect('p_1');
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.sched.advance(0);
  assert.equal(h.m.phase, PHASE.PREP);
  assert.equal(h.ps('p_1').ready, false);
});

test('a connected unready human and an entirely disconnected room retain their prep', (t) => {
  const h = prep(t, 3);
  h.m.onDisconnect('p_2');
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.sched.advance(0);
  assert.equal(h.m.phase, PHASE.PREP);
  h.m.onDisconnect('p_0');
  h.m.onDisconnect('p_1');
  h.sched.advance(0);
  assert.equal(h.m.phase, PHASE.PREP);
});
