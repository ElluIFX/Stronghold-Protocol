import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packPlugin, checkPluginFolder, buildPluginLock } from '../server/plugins/pack.js';
import { rosmontisOps } from './build.mjs';

export const CUSTOMIZATION_IDS = Object.freeze(['rosmontis-balance', 'repeated-strategies']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;

/** Install the versioned sources through the upstream packer and owner policy. */
export function installCustomizations({ root = ROOT, pluginsDir = path.join(root, 'plugins'), scriptMode = process.env.SP_PLUGIN_SCRIPTS ?? 'sandbox' } = {}) {
  const dataDir = path.join(root, 'data');
  const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
  fs.mkdirSync(pluginsDir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(pluginsDir, '_bundled-'));
  const target = path.resolve(staging);
  if (path.dirname(target) !== path.resolve(pluginsDir) || !path.basename(target).startsWith('_bundled-')) {
    throw new Error('Invalid bundled plugin staging directory');
  }
  try {
    for (const id of CUSTOMIZATION_IDS) {
      const dir = path.join(staging, id);
      fs.cpSync(path.join(root, 'customizations', id), dir, { recursive: true, dereference: false });
      if (id === 'rosmontis-balance') fs.writeFileSync(path.join(dir, 'data', 'patch.json'),
        JSON.stringify({ patch: 1, ops: rosmontisOps({ chess: read('chess'), backups: read('backups') }) }, null, 2) + '\n');
      const packed = packPlugin(dir, { dataDir });
      if (!packed.wrote || packed.check?.problems.length || packed.check?.warnings.length) {
        throw new Error(`Bundled plugin ${id} failed validation: ${JSON.stringify(packed.build.issues)}`);
      }
      const destination = path.join(pluginsDir, id);
      const sameLock = digest(path.join(destination, 'plugin.lock.json')) === digest(path.join(dir, 'plugin.lock.json'));
      const current = sameLock ? checkPluginFolder(destination, `${id}/`, { dataDir }) : null;
      const currentLock = current && buildPluginLock(destination);
      if (current && !current.problems.length && !current.warnings.length
        && JSON.stringify(currentLock.lock) === JSON.stringify(packed.lock)) continue;
      if (fs.existsSync(destination)) {
        const replaced = path.join(pluginsDir, '_replaced');
        fs.mkdirSync(replaced, { recursive: true });
        fs.renameSync(destination, path.join(replaced, `${id}-${Date.now()}`));
      }
      fs.renameSync(dir, destination);
    }
    const policyFile = path.join(pluginsDir, 'config.json');
    const policy = fs.existsSync(policyFile) ? JSON.parse(fs.readFileSync(policyFile, 'utf8')) : { rooms: 'fixed' };
    const enabledIds = ['sandbox', 'trusted', 'trusted-force'].includes(scriptMode)
      ? CUSTOMIZATION_IDS : CUSTOMIZATION_IDS.filter(id => id !== 'repeated-strategies');
    const previous = Array.isArray(policy.default) ? policy.default : [];
    const defaults = enabledIds.includes('repeated-strategies') ? previous : previous.filter(id => id !== 'repeated-strategies');
    if (defaults.length !== previous.length || enabledIds.some(id => !defaults.includes(id))) {
      policy.default = [...new Set([...defaults, ...enabledIds])];
      policy.classes = { content: true, script: true, ...policy.classes };
      if (Array.isArray(policy.allow) && !policy.allow.includes('*')) policy.allow = [...new Set([...policy.allow, ...enabledIds])];
      fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n');
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) installCustomizations();
