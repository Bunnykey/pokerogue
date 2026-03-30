// src/agent/runner.ts
// Headless PokeRogue runner — boots game via test framework, then enters bridge loop
//
// Usage: npx vitest run src/agent/runner.ts
// Or run directly with the test environment setup

import "vitest-canvas-mock";

// Setup jsdom globals that Phaser needs (mimicking vitest.setup.ts)
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body><canvas></canvas></body></html>", {
  pretendToBeVisual: true,
});
const w = dom.window;
for (const key of Object.getOwnPropertyNames(w)) {
  if (!(key in globalThis)) {
    try {
      (globalThis as any)[key] = (w as any)[key];
    } catch {}
  }
}
(globalThis as any).window = w;
(globalThis as any).document = w.document;

// Mock matchMedia
(globalThis as any).matchMedia = () => ({ matches: false });

// Mock document.fonts
Object.defineProperty(document, "fonts", {
  writable: true,
  value: { add: () => {}, load: () => Promise.resolve([]) },
});

// Mock navigator.getGamepads
(navigator as any).getGamepads = () => [];

import { BattleScene } from "#app/battle-scene";
import { initializeGame } from "#app/init/init";
import Phaser from "phaser";
import { startBridge } from "./bridge";

async function main() {
  process.stderr.write("[runner] Initializing...\n");

  // Initialize game data (moves, species, etc.)
  initializeGame();

  // Create headless Phaser game
  const phaserGame = new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 1920,
    height: 1080,
    scene: [],
  });

  // Store for bridge access
  (globalThis as any).__PHASER_GAME__ = phaserGame;

  // Create and initialize BattleScene
  const scene = new BattleScene();
  phaserGame.scene.add("battle", scene, true);

  // Wait for scene to be ready
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

  process.stderr.write("[runner] Game scene ready, entering bridge loop\n");

  // Enter the stdin/stdout bridge loop
  startBridge();
}

main().catch(e => {
  process.stderr.write(`[runner] Fatal: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
