const num = (v, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d;
const int = (v, d = 0) => Math.trunc(num(v, d));

function replace(ctx, spawns, p, routes, side) {
  const ducks = String(p.enemylist ?? '').split(',').map(s => s.trim()).filter(k => k && ctx.gd.enemy(k));
  if (!ducks.length) return;
  const lo = Math.max(0, int(p.min)), hi = Math.max(lo, int(p.max, lo));
  const want = lo + ctx.rng.int(hi - lo + 1);
  if (want <= 0) return;
  const flat = [];
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    if (!s) continue;
    if (side === 'L' || side === 'R') {
      const c = Number(routes?.[s.routeIndex]?.end?.[1]);
      if (!(side === 'R' ? c > 10 : c < 10)) continue;
    }
    for (let k = 0; k < Math.max(1, int(s.count, 1)); k++) flat.push({ i, k, t: num(s.time) + k * num(s.interval) });
  }
  flat.sort((a, b) => a.t - b.t || a.i - b.i || a.k - b.k);
  const ok = flat.filter((f, j) => {
    const s = spawns[f.i], e = ctx.gd.enemy(s.enemyKey), fraction = flat.length > 1 ? j / (flat.length - 1) : 0;
    return !s.tag && s.countInTotal !== false && e && e.rank !== 'BOSS' && !e.notCountInTotal && e.stats?.motion !== 'FLY'
      && fraction >= num(p.minweight) - 1e-9 && fraction <= num(p.maxweight, 1) + 1e-9;
  });
  const byIndex = new Map();
  const picked = ctx.rng.shuffle(ok).slice(0, want);
  if (!picked.length) return;
  for (const f of picked) {
    if (!byIndex.has(f.i)) byIndex.set(f.i, new Set());
    byIndex.get(f.i).add(f.k);
  }
  const add = [];
  for (const [i, selected] of byIndex) {
    const original = spawns[i], count = Math.max(1, int(original.count, 1));
    for (const k of selected) {
      const duck = { ...original, mods: original.mods ? { ...original.mods } : undefined, count: 1, interval: 0,
        time: num(original.time) + k * num(original.interval), enemyKey: ctx.rng.pick(ducks), tag: 'duck',
        bounty: { coins: 1, ownerPlayerId: ctx.playerId } };
      if (duck.mods) delete duck.mods.slot;
      add.push(duck);
    }
    for (let k = 0; k < count; k++) if (!selected.has(k)) add.push({ ...original,
      mods: original.mods ? { ...original.mods } : undefined, count: 1, interval: 0,
      time: num(original.time) + k * num(original.interval) });
    spawns[i] = null;
  }
  for (let i = spawns.length - 1; i >= 0; i--) if (spawns[i] == null) spawns.splice(i, 1);
  spawns.push(...add);
}

export default function setup(sp) {
  sp.meta.register('global:repeated_amedic', {
    onBattleStart(ctx, ev) {
      if (!ev?.input?.contentInfo) return;
      const count = [ctx, ...ctx.teammates()].filter(p =>
        (ctx.gd.band(p.bandId())?.effectRef ?? p.bandId()) === 'band_amedic').length;
      ev.input.contentInfo.amedicStatMultiplier = 1 + 0.25 * Math.max(0, count - 1);
      const ownBand = ctx.gd.band(ctx.bandId());
      const band = ownBand?.effectRef === 'band_amedic' ? ownBand : ctx.gd.band('band_amedic');
      const ids = [];
      for (const buff of band?.buffs || []) if (buff?.key === 'auto_chess_change_map') {
        for (const [key, value] of Object.entries({ ...buff.bb, ...buff.bbStr })) {
          if (key.includes('#') && num(value) > 0) ids.push(key.split('#')[0]);
        }
      }
      ev.input.contentInfo.amedicMapChars = [...new Set(ids)];
    },
  });
  sp.meta.register('global:bands_ducklord', {
    onBattleStart(ctx, ev) {
      if (!ev || !['normal', 'boss', 'hidden'].includes(ev.kind) || !Array.isArray(ev.spawns)) return;
      for (const holder of [ctx, ...ctx.teammates()]) {
        const band = ctx.gd.band(holder.bandId());
        if ((band?.effectRef ?? holder.bandId()) !== 'band_ducklord') continue;
        const buff = band?.buffs?.find(b => b?.key === 'round_start_all_player_change_enemy_2');
        const p = buff ? { ...buff.bb, ...buff.bbStr } : null;
        if (p && ctx.round >= int(p.round, 1)) replace(ctx, ev.spawns, p, ev.routes, ev.side);
      }
    },
  });
}
