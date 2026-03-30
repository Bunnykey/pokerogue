// src/agent/state-reader.ts
import { globalScene } from "#app/global-scene";

export interface AgentState {
  ready: boolean;
  error?: string;
  uiMode: number | null;
  phaseName: string | null;
  wave: number;
  money: number;
  score: number;
  turn: number;
  isDouble: boolean;
  pokeballs: number[] | null;
  playerField: any[];
  playerParty: any[];
  enemyField: any[];
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readPokemon(p: any, includeMoveset = true) {
  const base: any = {
    name: safe(() => p.name || p.species.name, "?"),
    speciesId: safe(() => p.species.speciesId, 0),
    level: p.level || 0,
    hp: p.hp || 0,
    maxHp: safe(() => p.getMaxHp(), 0),
    types: safe(() => p.getTypes(), []),
    status: safe(() => (p.status ? p.status.effect : null), null),
    stats: safe(
      () => ({
        atk: p.getStat(1, false),
        def: p.getStat(2, false),
        spa: p.getStat(3, false),
        spd: p.getStat(4, false),
        spe: p.getStat(5, false),
      }),
      {},
    ),
    ability: safe(() => p.getAbility().name, ""),
  };

  if (includeMoveset) {
    base.moves = safe(
      () =>
        p.getMoveset().map((m: any) => {
          const mv = safe(() => m.getMove(), {} as any);
          return {
            moveId: m.moveId,
            name: safe(() => m.getName(), "?"),
            type: mv.type != null ? mv.type : -1,
            power: mv.power || 0,
            pp: safe(() => m.getMovePp() - m.ppUsed, 0),
            maxPp: safe(() => m.getMovePp(), 0),
            category: mv.category != null ? mv.category : 0,
          };
        }),
      [],
    );
  }

  return base;
}

export function readGameState(): AgentState {
  const scene = globalScene;
  if (!scene) {
    return { ready: false, error: "no_scene" } as any;
  }

  try {
    const pm = (scene as any).phaseManager;
    const currentPhase = pm?.getCurrentPhase?.();

    return {
      ready: true,
      uiMode: safe(() => scene.ui.getMode(), null),
      phaseName: currentPhase ? currentPhase.phaseName || currentPhase.constructor.name : null,
      wave: safe(() => scene.currentBattle.waveIndex, 0),
      money: safe(() => (scene as any).money, 0),
      score: safe(() => (scene as any).score, 0),
      turn: safe(() => scene.currentBattle.turn, 0),
      isDouble: safe(() => !!scene.currentBattle.double, false),
      pokeballs: safe(() => Array.from((scene as any).pokeballCounts), null),
      playerField: safe(() => scene.getPlayerField().map(p => readPokemon(p, true)), []),
      playerParty: safe(
        () =>
          scene.getPlayerParty().map(p => ({
            ...readPokemon(p, false),
            onField: safe(() => p.isOnField(), false),
          })),
        [],
      ),
      enemyField: safe(
        () =>
          scene.getEnemyField().map(p => ({
            ...readPokemon(p, true),
            isBoss: safe(() => (p as any).isBoss(), false),
          })),
        [],
      ),
    };
  } catch (e: any) {
    return { ready: false, error: e.message } as any;
  }
}
