const ROSMONTIS = 'char_391_rosmon';
const STAT_FACTORS = Object.freeze({ maxHp: 1.5, atk: 2, bat: 0.75, def: 2 });
const SKILL_FACTORS = new Set(['extra_atk_scale', 'append_atk_scale', 'attack@append_atk_scale', 'atk', 'def']);
const adjusted = new WeakMap();

function scaleStats(stats) {
  if (!stats || typeof stats !== 'object') return stats;
  const out = { ...stats };
  for (const [key, factor] of Object.entries(STAT_FACTORS)) if (Number.isFinite(out[key])) out[key] *= factor;
  return out;
}

function scaleSkill(skill) {
  if (!skill || typeof skill !== 'object') return skill;
  const bb = { ...skill.bb };
  for (const key of SKILL_FACTORS) if (Number.isFinite(bb[key])) bb[key] *= 2;
  return { ...skill, bb };
}

/** Apply numerical operator adjustments without changing source records or text. */
function balanceRosmontis(record) {
  if (!record || typeof record !== 'object') return record;
  if (adjusted.has(record)) return adjusted.get(record);
  const out = { ...record, stats: scaleStats(record.stats) };
  if (record.statsBase) out.statsBase = scaleStats(record.statsBase);
  if (record.skill) out.skill = scaleSkill(record.skill);
  if (record.skills) out.skills = record.skills.map(scaleSkill);
  if (record.modules) out.modules = record.modules.map(module => ({ ...module, attr: scaleStats(module.attr) }));
  if (record.potDown) out.potDown = Object.fromEntries(Object.entries(record.potDown).map(([rank, changes]) => [rank,
    Object.fromEntries(Object.entries(changes).map(([path, value]) => {
      const [parent, key] = path.split('.');
      const factor = (parent === 'stats' || parent === 'statsBase') ? STAT_FACTORS[key] : null;
      return [path, factor && Number.isFinite(value) ? value * factor : value];
    })),
  ]));
  adjusted.set(record, out);
  adjusted.set(out, out);
  return out;
}

/** Adjust the generated file at its loading boundary; repeated loads are idempotent. */
export function operatorBalanceFile(name, data) {
  if (!data || typeof data !== 'object') return data;
  if (name === 'chess') {
    let out = data;
    for (const [id, record] of Object.entries(data)) {
      if (record?.charId !== ROSMONTIS) continue;
      const value = balanceRosmontis(record);
      if (value === record) continue;
      if (out === data) out = { ...data };
      out[id] = value;
    }
    return out;
  }
  if (name === 'backups') {
    const unit = data.units?.[ROSMONTIS];
    if (!unit?.forms) return data;
    const forms = Object.fromEntries(Object.entries(unit.forms).map(([key, form]) => [key, balanceRosmontis(form)]));
    if (Object.entries(forms).every(([key, form]) => form === unit.forms[key])) return data;
    return { ...data, units: { ...data.units, [ROSMONTIS]: { ...unit, forms } } };
  }
  return data;
}
