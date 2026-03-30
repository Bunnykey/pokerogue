// src/agent/runner.ts
// Headless PokeRogue runner — designed to run under vitest environment
// which provides jsdom, canvas mocks, and all Phaser setup.
//
// Usage: npx vitest run src/agent/runner.test.ts

// This file exports the main function; runner.test.ts calls it.
import { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { PhaseManager } from "#app/phase-manager";
import Phaser from "phaser";
import { startBridge } from "./bridge";

export async function runAgent(): Promise<void> {
  process.stderr.write("[runner] Starting headless agent...\n");

  // Create headless Phaser game
  const phaserGame = new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 1920,
    height: 1080,
    scene: [],
  });

  (globalThis as any).__PHASER_GAME__ = phaserGame;

  // Create BattleScene
  const scene = new BattleScene();
  phaserGame.scene.add("battle", scene, true);

  // Wait for scene to initialize
  await new Promise<void>(resolve => {
    const check = () => {
      if (scene.ui) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    setTimeout(check, 500);
  });

  process.stderr.write("[runner] Scene ready, starting bridge\n");
  startBridge();

  // Keep process alive
  await new Promise(() => {});
}
