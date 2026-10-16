// SP_E2E=1, run this file alone. Room settings sent through the existing API reach both browsers' content data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, OUT, hasChrome } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';
const enabled = process.env.SP_E2E === '1' && hasChrome();

test('room settings API changes both clients content compositions without exposing plugin controls', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-e2e-'));
  writePlugin(path.join(tmp, 'settings-test'), { manifest: 2, name: 'Settings test', version: '1.0.0', app: '*', api: 1,
    class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['p.json'],
    settings: { defense: { type: 'number', min: 0, max: 1, step: 0.1, default: 0.1, label: 'DEF' } } },
  { 'p.json': { patch: 1, ops: [['bb','base_def'],['buffs',0,'bb','base_def']].map(p => ({ op:'set', file:'bonds', id:'deputShip', path:p, value:{ $setting:'defense' } })) } });
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port:0, host:'127.0.0.1', quiet:true, pluginsDir:tmp, assetIndex:false });
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.url, 'host', { prefix: 'settings', w:1600, h:1000 });
  const guest = new Client(P, srv.url, 'guest', { prefix: 'settings', w:1600, h:1000 });
  try {
    await host.open(); await host.enter('凯尔希'); await host.click('.mode-card', '同盟模拟'); await host.click('.diff-card', '标准模拟'); await host.click('.create-box button', '创建同盟');
    const code = (await host.waitFor(s => !!s.room?.code, 'room')).room.code;
    await guest.open(); await guest.enter('阿米娅'); await guest.click('.join-row input'); await guest.page.keyboard.type(code); await guest.click('.join-row button', '加入同盟');
    await guest.page.waitForSelector('.room-screen', { timeout: 15000 });
    for (const client of [host, guest]) {
      assert.equal(await client.page.$('[data-testid="plugin-tag"]'), null, `${client.label}: no room plugin entry`);
      assert.equal(await client.page.$('[data-testid="plugin-panel"]'), null, `${client.label}: no plugin panel`);
    }
    await host.page.evaluate(() => globalThis.__SP__.net.request('room.setPlugins', { plugins: [{ id: 'settings-test' }] }));
    await guest.page.waitForFunction(() => globalThis.__SP__?.store.get().room?.content?.plugins?.some(p => p.id === 'settings-test')
      && globalThis.__SP__.data.get('bonds')?.deputShip?.bb?.base_def === 0.1, { timeout:30000 });
    const defaultCs = await guest.page.evaluate(() => globalThis.__SP__.store.get().room.content.cs);
    await host.page.evaluate(() => globalThis.__SP__.net.request('room.setPlugins', { plugins: [{ id: 'settings-test', settings: { defense: 0.4 } }] }));
    await guest.page.waitForFunction(() => globalThis.__SP__?.data.get('bonds')?.deputShip?.bb?.base_def === 0.4, { timeout:30000 });
    await host.page.waitForFunction(() => globalThis.__SP__?.data.get('bonds')?.deputShip?.bb?.base_def === 0.4, { timeout:30000 });
    assert.equal(await host.page.evaluate(() => globalThis.__SP__.data.get('bonds').deputShip.bb.base_def), 0.4);
    const changedCs = await guest.page.evaluate(() => globalThis.__SP__.store.get().room.content.cs);
    assert.notEqual(changedCs, defaultCs, 'changing settings creates a new content composition');
    assert.equal(await host.page.evaluate(() => globalThis.__SP__.store.get().room.content.cs), changedCs, 'both browsers load the same composition');
    fs.mkdirSync(OUT, { recursive:true });
    await host.page.screenshot({ path:path.join(OUT,'plugins-settings-host.png'), fullPage:true });
    const refusal = await guest.page.evaluate(async () => {
      try {
        await globalThis.__SP__.net.request('room.setPlugins', { plugins: [{ id: 'settings-test', settings: { defense: 0.8 } }] });
        return null;
      } catch (error) { return error.code; }
    });
    assert.equal(refusal, 'NOT_HOST', 'the guest cannot change room settings through the API');
    assert.equal(await guest.page.evaluate(() => globalThis.__SP__.data.get('bonds').deputShip.bb.base_def), 0.4, 'a refused guest change leaves the content intact');
  } finally { await host.close(); await guest.close(); await srv.close(); fs.rmSync(tmp, { recursive:true, force:true }); }
});
