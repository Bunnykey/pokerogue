// src/agent/bridge.ts
// JSON-RPC bridge with PhaseInterceptor-style phase pump

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { createInterface } from "readline";
import { readGameState } from "./state-reader";

interface Command {
  cmd: string;
  [key: string]: any;
}

const BTN_MAP: Record<number, Button> = {
  0: Button.UP,
  1: Button.DOWN,
  2: Button.LEFT,
  3: Button.RIGHT,
  4: Button.SUBMIT,
  5: Button.ACTION,
  6: Button.CANCEL,
  15: Button.SPEED_UP,
  16: Button.SLOW_DOWN,
};

// UI modes that require player input (phase should pause here)
const INTERACTIVE_UI_MODES = new Set([
  2, // COMMAND
  3, // FIGHT
  4, // BALL
  5, // TARGET_SELECT
  6, // MODIFIER_SELECT
  7, // SAVE_SLOT
  8, // PARTY
  10, // STARTER_SELECT
  14, // CONFIRM
  15, // OPTION_SELECT
]);

// ============================================================
// Phase Pump — PhaseInterceptor pattern for headless mode
// ============================================================

let pumpInstalled = false;
let phaseReady = false; // true when a new phase is loaded but not yet started

/**
 * Install the phase pump by replacing PhaseManager.startCurrentPhase.
 * This gives us manual control over when each phase starts.
 */
function installPhasePump(): void {
  if (pumpInstalled) {
    return;
  }
  const pm = globalScene.phaseManager;
  // Replace the private startCurrentPhase method
  (pm as any).startCurrentPhase = () => {
    phaseReady = true;
  };

  // Patch UI to skip transition fades — these create nested async chains
  // (fadeOut → delayedCall → doSetMode → fadeIn) that stall the pump.
  // By skipping transitions, setMode resolves synchronously.
  const ui = globalScene.ui;
  (ui as any).setModeInternal = (
    mode: number,
    clear: boolean,
    _forceTransition: boolean,
    chainMode: boolean,
    args: any[],
  ): Promise<void> => {
    // Always call with forceTransition=false AND skip the fade path
    return new Promise<void>(resolve => {
      if (ui.mode === mode) {
        resolve();
        return;
      }
      if (clear) {
        ui.getHandler()?.clear?.();
      }
      if (chainMode && ui.mode && !clear) {
        (ui as any).modeChain.push(ui.mode);
      }
      (ui as any).mode = mode;
      ui.getHandler()?.show?.(args);
      resolve();
    });
  };

  // Patch Pokemon.prototype.updateInfo — done via patchUpdateInfo() below

  pumpInstalled = true;
  process.stderr.write("[bridge] Phase pump + sync UI + sync updateInfo installed\n");
}

/**
 * Run the phase pump: start phases one at a time until an interactive UI mode
 * is reached or maxPhases is exhausted. Yields to event loop between phases
 * to let async callbacks (MockClock timers, Promise chains) fire.
 */
async function phasePump(maxPhases: number): Promise<{ phases: number; uiMode: number; phaseName: string }> {
  const pm = globalScene.phaseManager;
  let processed = 0;

  for (let i = 0; i < maxPhases; i++) {
    // First check: is the UI already interactive? (from a currently-running phase)
    try {
      const uiMode = globalScene.ui?.getMode() ?? 0;
      if (INTERACTIVE_UI_MODES.has(uiMode)) {
        const phase = pm.getCurrentPhase();
        return {
          phases: processed,
          uiMode,
          phaseName: phase?.phaseName || "none",
        };
      }
    } catch {}

    // Wait for a phase to be ready
    if (!phaseReady) {
      // Yield to let the current phase's async callbacks complete
      // Needs 15+ yields for deep async chains (fadeOut → delayedCall → .then → resolve)
      for (let y = 0; y < 30; y++) {
        await new Promise<void>(r => setTimeout(r, 3));
        if (phaseReady) {
          break;
        }
        // Also check if UI became interactive while waiting
        try {
          const uiMode = globalScene.ui?.getMode() ?? 0;
          if (INTERACTIVE_UI_MODES.has(uiMode)) {
            const phase = pm.getCurrentPhase();
            return {
              phases: processed,
              uiMode,
              phaseName: phase?.phaseName || "none",
            };
          }
        } catch {}
      }
      if (!phaseReady) {
        break;
      }
    }

    // Start the phase
    const phase = pm.getCurrentPhase();
    if (!phase) {
      break;
    }
    const phaseName = phase.phaseName || phase.constructor.name;

    // Patch DamageAnimPhase: skip flash animation, call end() directly
    if (phaseName === "DamageAnimPhase") {
      (phase as any).applyDamage = function (this: any) {
        if (this.amount) {
          try {
            globalScene.damageNumberHandler?.add?.(this.getPokemon(), this.amount, this.damageResult, this.critical);
          } catch {}
        }
        this.getPokemon()
          .updateInfo(true)
          .then(() => this.end());
      };
    }

    // Force CommandPhase to always prompt the player (clear move queue to prevent auto-skip)
    // Also patch end() to be synchronous (the async setMode.then chain stalls the pump)
    if (phaseName === "CommandPhase") {
      try {
        const fieldIdx = (phase as any).fieldIndex ?? 0;
        const playerPokemon = globalScene.getPlayerField()[fieldIdx];
        if (playerPokemon?.getMoveQueue) {
          playerPokemon.getMoveQueue().length = 0;
        }
      } catch {}
      phase.end = () => {
        (globalScene.ui as any).mode = 0; // UiMode.MESSAGE
        globalScene.phaseManager.shiftPhase();
      };
    }

    phaseReady = false;
    try {
      phase.start();
    } catch (e: any) {
      process.stderr.write(`[pump] ${phaseName} error: ${e.message}\n`);
    }
    processed++;

    // Yield to let async phase callbacks complete.
    // Uses combination of microtask flushing (for .then() chains) and
    // macrotask yields (for MockClock setInterval ticks).
    // Flush microtasks + yield to macrotask queue
    // DamageAnimPhase: updateInfo() → Promise.resolve() → .then(end) → shiftPhase → phaseReady
    // This chain needs: 1 microtask (Promise resolve) + 1 microtask (.then callback)
    for (let y = 0; y < 15; y++) {
      // setImmediate fires before setTimeout but after microtasks
      await new Promise<void>(r => setImmediate(r));
      if (phaseReady) {
        break;
      }
    }
  }

  const uiMode = globalScene.ui?.getMode() ?? 0;
  const currentPhase = pm.getCurrentPhase();
  return {
    phases: processed,
    uiMode,
    phaseName: currentPhase?.phaseName || "none",
  };
}

// ============================================================
// Command handler
// ============================================================

async function handleCommand(cmd: Command): Promise<Record<string, any>> {
  switch (cmd.cmd) {
    case "get_state":
      return readGameState();

    case "input": {
      const button = BTN_MAP[cmd.btn ?? 5] ?? Button.ACTION;
      try {
        globalScene.ui.processInput(button);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }

    case "flush": {
      // Flush microtasks — lets pending .then() callbacks execute
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>(r => setTimeout(r, 1));
      return { ok: true };
    }

    case "tick": {
      const n = cmd.n ?? 1;
      try {
        const game = (globalThis as any).__PHASER_GAME__;
        if (game?.loop) {
          for (let i = 0; i < n; i++) {
            game.loop.step(performance.now());
          }
        }
        return { ok: true, frames: n };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }

    case "pump": {
      // Phase pump: advance up to N phases, stopping at interactive UI
      const max = cmd.n ?? 200;
      installPhasePump();
      const result = await phasePump(max);
      return { ok: true, ...result };
    }

    case "run": {
      // Legacy: step game loop N frames with event loop yields
      const n = cmd.n ?? 60;
      const game = (globalThis as any).__PHASER_GAME__;
      const scene = globalScene;
      let frames = 0;
      const BATCH = 10;
      for (let b = 0; b < n; b += BATCH) {
        const end = Math.min(b + BATCH, n);
        for (let i = b; i < end; i++) {
          try {
            game?.loop?.step(performance.now());
            scene?.update?.();
            frames++;
          } catch {}
        }
        await new Promise<void>(r => setTimeout(r, 5));
      }
      return { ok: true, frames };
    }

    case "ping":
      return { ok: true, pong: true };

    case "eval": {
      try {
        const fn = new Function("globalScene", "scene", "game", cmd.code || "");
        const game = (globalThis as any).__PHASER_GAME__;
        const scene = globalScene;
        const result = fn(globalScene, scene, game);
        return { ok: true, result: result ?? null };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }

    case "quit":
      process.exit(0);
      break;

    default:
      return { ok: false, error: `unknown command: ${cmd.cmd}` };
  }
  return { ok: false, error: "unreachable" };
}

// ============================================================
// Bridge I/O
// ============================================================

export function startBridge(): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let processing = false;
  const queue: string[] = [];

  const processNext = async () => {
    if (processing || queue.length === 0) {
      return;
    }
    processing = true;
    const line = queue.shift()!;
    try {
      const cmd: Command = JSON.parse(line);
      const response = await handleCommand(cmd);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
    }
    processing = false;
    processNext();
  };

  rl.on("line", (line: string) => {
    queue.push(line);
    processNext();
  });

  rl.on("close", () => {});

  // Keep event loop alive
  setInterval(() => {}, 1 << 30);

  // Signal ready
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");
}
