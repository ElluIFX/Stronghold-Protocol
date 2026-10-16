import { makeMatch } from '../match/harness.js';
import { makeBattle } from './battleHarness.js';

export class Match {
  constructor(opts) { this.opts = opts; }
  start() {
    const h = makeMatch({ mode: 'coop', humans: 8, seed: 17, fake: true }).start();
    const failures = [];
    try {
      h.toPrep(1);
      h.m.round = 5;
      const players = [...h.m.players.values()];
      for (const p of players) p.bandId = 'band_ducklord';
      h.m.rngMeta = Object.assign(() => 0, { int: n => n - 1, pick: list => list[0], shuffle: list => [...list] });
      const ev = { kind: 'normal', spawns: [{ enemyKey: 'enemy_1000_gopro_2', time: 0, count: 100, interval: 1, routeIndex: 0 }],
        input: players[0].battleInput() };
      h.m.dispatch(players[0], 'onBattleStart', ev);
      const ducks = ev.spawns.filter(s => s.tag === 'duck');
      for (const p of players) p.bandId = 'band_amedic';
      const input = { input: players[0].battleInput(), kind: 'normal' };
      h.m.dispatch(players[0], 'onBattleStart', input);
      const b = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false, players: [input.input] });
      b.step();
      const medic = b.b.allyUnits.find(u => u.kind === 'token' && u.defId === 'char_605_cmedic');
      const baseline = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false,
        players: [{ ...input.input, contentInfo: { ...input.input.contentInfo,
          matchBands: ['band_amedic'], liveMatchBands: ['band_amedic'] } }] });
      baseline.step();
      const plain = baseline.b.allyUnits.find(u => u.kind === 'token' && u.defId === 'char_605_cmedic');
      const ros = h.m.gd.chess('chess_char_6_12_a');
      failures.push(...b.b.errors);
      this.opts.broadcast({ t: 'm.result', ducks: ducks.length,
        bountyOwners: [...new Set(ducks.map(d => d.bounty.ownerPlayerId))],
        medicCount: b.b.allyUnits.filter(u => u.kind === 'token').length,
        hpMultiplier: medic.s.maxHp / plain.s.maxHp, atkMultiplier: medic.s.atk / plain.s.atk,
        errors: failures, ros: ros?.stats });
    } finally { h.m.dispose(); }
  }
  dispose() {}
}
