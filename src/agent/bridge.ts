// src/agent/bridge.ts

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { createInterface } from "readline";
import { readGameState } from "./state-reader";

interface Command {
  cmd: string;
  btn?: number;
  n?: number;
}

interface Response {
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

async function handleCommand(cmd: Command): Promise<Response> {
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

    case "run": {
      // Run N iterations with batched stepping and event loop yields
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
        // Yield after each batch — let async phase callbacks fire
        await new Promise<void>(r => setTimeout(r, 5));
      }
      return { ok: true, frames };
    }

    case "ping":
      return { ok: true, pong: true };

    case "eval": {
      // Execute code in the game context (mirrors page.evaluate)
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
}

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
      process.stderr.write(`[bridge] cmd: ${line.slice(0, 80)}\n`);
      const cmd: Command = JSON.parse(line);
      const response = await handleCommand(cmd);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (e: any) {
      process.stderr.write(`[bridge] error: ${e.message}\n`);
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
    }
    processing = false;
    processNext();
  };

  rl.on("line", (line: string) => {
    queue.push(line);
    processNext();
  });

  // Don't exit on close — async commands may still be pending.
  // The "quit" command handles explicit exit.
  rl.on("close", () => {
    // stdin closed (pipe ended). Allow pending async commands to finish.
    // Process will exit when the event loop is empty or via "quit" command.
  });

  // Keep the event loop alive (stdin pipe close removes the readline handle)
  const _keepAlive = setInterval(() => {}, 1 << 30);

  // Signal ready
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");
}
