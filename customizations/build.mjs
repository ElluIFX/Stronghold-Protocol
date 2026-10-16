import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAT_FACTORS = { maxHp: 1.5, atk: 2, bat: 0.75, def: 2 };
const SKILL_KEYS = new Set(['extra_atk_scale', 'append_atk_scale', 'attack@append_atk_scale', 'atk', 'def']);

/** Derive plugin patches from the current upstream records without modifying their text. */
export function rosmontisOps(data) {
  const ops = [];
  const scale = (file, prefix, object, factors) => {
    for (const [key, factor] of Object.entries(factors)) if (Number.isFinite(object?.[key])) {
      ops.push({ op: 'set', file, path: [...prefix, key], value: object[key] * factor });
    }
  };
  const record = (file, prefix, rec) => {
    scale(file, [...prefix, 'stats'], rec.stats, STAT_FACTORS);
    scale(file, [...prefix, 'statsBase'], rec.statsBase, STAT_FACTORS);
    const skill = (s, suffix) => scale(file, [...prefix, ...suffix, 'bb'], s?.bb,
      Object.fromEntries([...SKILL_KEYS].map(key => [key, 2])));
    if (rec.skill) skill(rec.skill, ['skill']);
    rec.skills?.forEach((s, i) => skill(s, ['skills', i]));
    rec.modules?.forEach((m, i) => scale(file, [...prefix, 'modules', i, 'attr'], m.attr, STAT_FACTORS));
    for (const [rank, changes] of Object.entries(rec.potDown || {})) {
      const factors = Object.fromEntries(Object.keys(changes).flatMap(key => {
        const [parent, stat] = key.split('.');
        return ['stats', 'statsBase'].includes(parent) && STAT_FACTORS[stat] ? [[key, STAT_FACTORS[stat]]] : [];
      }));
      scale(file, [...prefix, 'potDown', rank], changes, factors);
    }
  };
  for (const [id, rec] of Object.entries(data.chess)) if (rec.charId === 'char_391_rosmon') record('chess', [id], rec);
  for (const [key, rec] of Object.entries(data.backups.units?.char_391_rosmon?.forms || {})) {
    record('backups', ['units', 'char_391_rosmon', 'forms', key], rec);
  }
  if (!ops.length) throw new Error('Rosmontis records are missing');
  return ops;
}

export function buildCustomizations(root = ROOT) {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'data', `${file}.json`), 'utf8'));
  const patch = { patch: 1, ops: rosmontisOps({ chess: read('chess'), backups: read('backups') }) };
  fs.writeFileSync(path.join(root, 'customizations', 'rosmontis-balance', 'data', 'patch.json'), JSON.stringify(patch, null, 2) + '\n');
  return patch;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCustomizations();
