import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { writePlugin } from './helpers/pluginFixtures.js';
import { ERR } from '../shared/constants.js';

test('an eight-seat gameplay-plugin room keeps content readiness and starts in its process host', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-eight-plugin-'));
  const pluginsDir = path.join(temporary, 'plugins');
  writePlugin(path.join(pluginsDir, 'eight-rules'), {
    manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', permissions: ['data.patch'], data: ['rules.json'],
  }, { 'rules.json': { patch: 1, ops: [] } });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir, assetIndex: false });
  let host;
  t.after(async () => {
    await host?.terminate();
    await server.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  host = await TestClient.connect(server.url.replace('http:', 'ws:') + '/ws');
  await host.hello('EightHost');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 })).t, 'ok');
  const initial = await host.waitFor('room.state', state => state.capacity === 8);
  assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'eight-rules' }] })).t, 'ok');
  const modded = await host.waitFor('room.state', state => state.content?.vanilla === false);
  for (let i = 0; i < 7; i++) assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
  const full = await host.waitFor('room.state', state => state.seats.filter(Boolean).length === 8);
  assert.deepEqual(full.seats.map(seat => seat.seat), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal((await host.request({ t: 'room.setCapacity', capacity: 4 })).code, ERR.BAD_TARGET);
  assert.equal((await host.request({ t: 'room.start' })).code, ERR.CONTENT_NOT_READY);
  assert.equal((await host.request({ t: 'room.contentReady', cs: modded.content.cs })).t, 'ok');
  assert.equal((await host.request({ t: 'room.start' }, 10000)).t, 'ok');
  const publicState = await host.waitFor('m.public', state => state.phase === 'INFO_CHECK', 10000);
  assert.equal(publicState.players.length, 8);
  assert.equal(server.lobby.getRoom(initial.code).match.hosted, true);
  const health = await (await fetch(server.url + '/healthz')).json();
  assert.equal(health.content.sets, 1);
  assert.equal(health.online, 1);
  assert.equal(health.inRoom, 1);
});
