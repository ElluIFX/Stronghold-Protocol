export default function setup(sp) {
  sp.content.register({
    install(battle) {
      const multipliers = new Map();
      const mapChars = new Map();
      for (const ps of battle.players) {
        const info = ps.input?.contentInfo || {};
        const ids = Array.isArray(info.liveMatchBands) ? info.liveMatchBands
          : Array.isArray(info.matchBands) && info.matchBands.length ? info.matchBands : battle.players.map(p => p.bandId);
        const count = ids.filter(id => id === 'band_amedic').length;
        if (!count && Array.isArray(info.liveMatchBands)) info.matchBands = [...info.liveMatchBands];
        multipliers.set(ps.playerId, count > 0 ? 1 + 0.25 * (count - 1) : 0);
        mapChars.set(ps.playerId, new Set(Array.isArray(info.amedicMapChars)
          ? info.amedicMapChars : ['char_605_cmedic', 'char_613_acmedc']));
      }
      const applied = new WeakSet();
      const spawnHook = battle.on('deploy', ({ unit }) => {
        const multiplier = multipliers.get(unit.ownerId);
        if (!(multiplier > 1) || unit.kind !== 'token' || unit.aggroSeq >= 0 || applied.has(unit)
          || !mapChars.get(unit.ownerId)?.has(unit.defId)) return;
        applied.add(unit);
        battle.addBuff(unit, { key: 'band:band_amedic', persist: true, allowDead: true, refresh: 'replace',
          mods: { atkMul: multiplier, defMul: multiplier, hpMul: multiplier } });
        unit.hp = unit.s.maxHp;
      }, { priority: -1000 });
      battle.on('battleStart', () => battle.off(spawnHook), { priority: -1, once: true });
    },
  });
}
