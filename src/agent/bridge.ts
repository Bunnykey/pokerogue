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

function handleCommand(cmd: Command): Response {
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

    case "ping":
      return { ok: true, pong: true };

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

  rl.on("line", (line: string) => {
    try {
      const cmd: Command = JSON.parse(line);
      const response = handleCommand(cmd);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
    }
  });

  rl.on("close", () => process.exit(0));

  // Signal ready
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");
}
