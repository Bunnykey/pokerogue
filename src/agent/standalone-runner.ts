#!/usr/bin/env -S npx vite-node --config vite.agent.config.ts
// src/agent/standalone-runner.ts
//
// Standalone headless PokeRogue runner using vite-node.
// Replicates vitest's jsdom/mock environment without vitest,
// so stdin/stdout are free for the JSON bridge.
//
// Usage: npx vite-node --config vite.agent.config.ts src/agent/standalone-runner.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Set env vars before any imports use import.meta.env
process.env.VITE_BYPASS_LOGIN = "1";

// Prevent crashes from missing mock methods — the game has many visual code paths
// that reference rendering APIs not available in headless mode
process.on("uncaughtException", err => {
  process.stderr.write(`[uncaught] ${err.message}\n`);
  // Don't exit — allow the game to continue
});
process.on("unhandledRejection", (reason: any) => {
  process.stderr.write(`[unhandled] ${reason?.message || reason}\n`);
});

// Redirect ALL console output to stderr — stdout is reserved for the JSON bridge protocol
const _origConsole = { ...console };
console.log = (...args: any[]) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args: any[]) => process.stderr.write("[warn] " + args.map(String).join(" ") + "\n");
console.error = (...args: any[]) => process.stderr.write("[error] " + args.map(String).join(" ") + "\n");
console.info = (...args: any[]) => process.stderr.write("[info] " + args.map(String).join(" ") + "\n");
console.debug = (..._args: any[]) => {}; // suppress debug noise

// ============================================================
// Phase 1: DOM environment (replaces vitest's jsdom environment)
// ============================================================

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
  url: "http://localhost:8000",
  pretendToBeVisual: true,
  // Don't use resources: "usable" — it causes JSDOM to load images which triggers renderer errors
});

// Install ALL window properties to globalThis (mimics vitest's jsdom env)
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key === "undefined" || key === "globalThis" || key === "global") {
    continue;
  }
  if (key in globalThis) {
    continue;
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(dom.window, key);
    if (desc) {
      Object.defineProperty(globalThis, key, desc);
    }
  } catch {
    // Some can't be overridden
  }
}

// Phaser checks window['Element'], window.cordova, etc.
try {
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
} catch {
  // Already set
}

// ============================================================
// Phase 2: FontFace mock (replaces font-face.setup.ts)
// ============================================================

class FontFaceMock {
  family: string;
  source: string;
  descriptors: any;
  constructor(family: string, source: string, descriptors?: any) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  load(): Promise<FontFaceMock> {
    return Promise.resolve(this);
  }
}
(globalThis as any).FontFace = FontFaceMock;

// ============================================================
// Phase 3: Canvas context mock via Proxy
// ============================================================

const canvasMock: any = { width: 800, height: 600, style: {} };
const ctxData: any = {
  font: "",
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  textBaseline: "alphabetic",
  textAlign: "start",
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  canvas: canvasMock,
};
const ctxProxy: any = new Proxy(ctxData, {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    if (prop === "createImageData") {
      return (w: number, h: number) => ({
        data: new Uint8ClampedArray((w || 1) * (h || 1) * 4),
        width: w || 1,
        height: h || 1,
      });
    }
    if (prop === "getImageData") {
      return (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray((w || 1) * (h || 1) * 4),
        width: w || 1,
        height: h || 1,
      });
    }
    if (prop === "measureText") {
      return () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 });
    }
    if (prop === "getLineDash") {
      return () => [];
    }
    if (prop === "isPointInPath" || prop === "isPointInStroke") {
      return () => false;
    }
    if (prop === "createLinearGradient" || prop === "createRadialGradient") {
      return () => ({ addColorStop: () => {} });
    }
    if (prop === "createPattern") {
      return () => ({});
    }
    // Everything else → no-op function
    return () => {};
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
});
canvasMock.getContext = () => ctxProxy;

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => ctxProxy) as any;
}

// ============================================================
// Phase 4: Stubs (replaces setupStubs from test-file-initialization.ts)
// ============================================================

const localStore: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => localStore[k] ?? null,
    setItem: (k: string, v: string) => {
      localStore[k] = v;
    },
    removeItem: (k: string) => {
      delete localStore[k];
    },
    clear: () => {
      for (const k of Object.keys(localStore)) {
        delete localStore[k];
      }
    },
    hasOwnProperty: (k: string) => k in localStore,
  },
  writable: true,
  configurable: true,
});

const matchMediaMock = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
Object.defineProperty(globalThis, "matchMedia", { value: matchMediaMock, writable: true, configurable: true });
// Also set on dom.window since window === dom.window
try {
  Object.defineProperty(dom.window, "matchMedia", { value: matchMediaMock, writable: true, configurable: true });
} catch {}

try {
  Object.defineProperty(document, "fonts", {
    writable: true,
    value: { add: () => {}, check: () => true, forEach: () => {}, entries: () => [] },
  });
} catch {}

if (typeof navigator !== "undefined") {
  (navigator as any).getGamepads = () => [];
}

if (typeof URL !== "undefined") {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

(globalThis as any).AudioContext = class {
  createGain() {
    return { connect: () => {}, gain: { value: 1 } };
  }
  createBufferSource() {
    return { connect: () => {}, start: () => {}, stop: () => {}, buffer: null };
  }
  decodeAudioData() {
    return Promise.resolve({});
  }
  close() {
    return Promise.resolve();
  }
};
(globalThis as any).webkitAudioContext = (globalThis as any).AudioContext;

// Session cookie (bypass login)
localStore["pokerogue_sessionId"] = "fake_token";

// ============================================================
// Phase 5: Fetch override (replaces vi.mock of fetch-utils)
// ============================================================

const _origFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as any).url;

  if (url.includes("fonts.googleapis.com")) {
    return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
  }

  if (url.includes("/locales/")) {
    const match = url.match(/\/locales\/(.+)/);
    if (match) {
      const localePath = path.join(ROOT, "locales", match[1].split("?")[0]);
      try {
        const raw = fs.readFileSync(localePath, "utf8");
        return new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } });
      } catch {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
  }

  if (url.startsWith("./") || url.startsWith("assets/")) {
    const assetUrl = url.split("?")[0];
    const resolvedUrl = assetUrl.includes("battle-anims/")
      ? "assets/battle-anims/tackle.json"
      : assetUrl.startsWith("./")
        ? `assets/${assetUrl.slice(2)}`
        : assetUrl;
    try {
      const raw = fs.readFileSync(path.join(ROOT, resolvedUrl), "utf8");
      return new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } });
    } catch {
      return new Response("{}", { status: 404 });
    }
  }

  if (url.includes("/api/") || url.includes("pokerogue.net")) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await _origFetch(input, init);
  } catch {
    return new Response("{}", { status: 404 });
  }
}) as typeof fetch;

// ============================================================
// Phase 6: Load Phaser + Class polyfill + stubs
// ============================================================

process.stderr.write("[standalone] Environment ready, loading Phaser...\n");

import { installPhaserClassPolyfill } from "./mocks/phaser-class-polyfill";

const phaserMod = await import("phaser");
const Phaser = phaserMod.default || phaserMod;

// Install Phaser.Class polyfill (rex plugins need it at module load time)
installPhaserClassPolyfill(Phaser);
(globalThis as any).Phaser = Phaser;

// Rex plugins are aliased to test mocks via vite.agent.config.ts.
// The game code also imports BBCodeText/InputText from different paths,
// but those are handled by the alias config.

// Mock Phaser.GameObjects.Image with minimal stub
const { MockImage } = await import("#test/mocks/mocks-container/mock-image");
(Phaser as any).GameObjects.Image = MockImage as any;

// ============================================================
// Phase 7: Initialize i18n, then game data
// ============================================================

// i18n must be loaded FIRST — initializeGame uses locale data (biome names, etc.)
process.stderr.write("[standalone] Initializing i18n...\n");
const _i18nMod = await import("#plugins/i18n");

// Give i18next a moment to load locale files via our fetch override
await new Promise(r => setTimeout(r, 500));

process.stderr.write("[standalone] Initializing game data...\n");
const { initializeGame } = await import("#init/init");
initializeGame();

// ============================================================
// Phase 8: Boot Phaser headless + BattleScene (GameWrapper approach)
// ============================================================

process.stderr.write("[standalone] Booting Phaser headless...\n");

const { BattleScene } = await import("#app/battle-scene");
const { MoveAnim } = await import("#data/battle-anims");
const { Pokemon } = await import("#field/pokemon");
const { timedEventManager } = await import("#app/global-event-manager");
const { version } = await import("#package.json");
const { MockTextureManager } = await import("#test/mocks/mock-texture-manager");
const { MockLoader } = await import("#test/mocks/mock-loader");
const { MockGameObjectCreator } = await import("#test/mocks/mock-game-object-creator");
const { MockClock } = await import("#test/mocks/mock-clock");
const { MockContainer } = await import("#test/mocks/mocks-container/mock-container");
const { PokedexMonContainer } = await import("#ui/pokedex-mon-container");

const PhaserNS = Phaser as any;

const phaserGame = new PhaserNS.Game({
  type: PhaserNS.HEADLESS,
  width: 1920,
  height: 1080,
  scene: [],
  banner: false,
});

(globalThis as any).__PHASER_GAME__ = phaserGame;

// Disable timed events
timedEventManager.disable();

// Stub Pokemon methods that need rendering
MoveAnim.prototype.getAnim = (() => ({ frames: {} })) as any;
Pokemon.prototype.enableMask = (() => null) as any;
Pokemon.prototype.updateFusionPalette = (() => null) as any;
Pokemon.prototype.cry = (() => null) as any;
Pokemon.prototype.faintCry = ((cb: any) => cb?.()) as any;
// Mock updateInfo to resolve immediately — the real implementation tweens the HP bar
// which creates async chains that stall the phase pump.
Pokemon.prototype.updateInfo = ((_instant?: boolean) => Promise.resolve()) as any;
// @ts-expect-error
PokedexMonContainer.prototype.remove = MockContainer.prototype.remove;

// RNG seed
PhaserNS.Math.RND.sow(["test"]);

const scene = new BattleScene();

// --- Mock game renderer (from GameWrapper.injectMandatory) ---
phaserGame.config = { seed: ["test"], gameVersion: version } as any;
scene.game = phaserGame;
phaserGame.renderer = {
  maxTextures: -1,
  gl: {} as any,
  deleteTexture: () => null!,
  canvasToTexture: () => ({}) as any,
  createCanvasTexture: () => ({}) as any,
  createTextureFromSource: () => ({}) as any,
  pipelines: { add: () => null! } as any,
} as any;
scene.renderer = phaserGame.renderer as any;
(scene as any).children = { removeAll: () => null! };

// Mock sound
(scene as any).sound = {
  play: () => false,
  pause: () => false,
  setRate: () => null!,
  add: () => (scene as any).sound,
  get: () => ({ ...(scene as any).sound, totalDuration: 0 }),
  getAllPlaying: () => [],
  manager: { game: phaserGame },
  destroy: () => null,
  setVolume: () => null,
  stop: () => null,
  stopByKey: () => 0,
  on: (_evt: any, callback: any) => callback(),
  key: "",
};

// Mock cameras
(scene as any).cameras = {
  main: { setPostPipeline: () => null!, removePostPipeline: () => null! },
} as any;

// Mock tweens
(scene as any).tweens = {
  add: (data: any) => {
    data?.onComplete?.();
  },
  getTweensOf: () => [],
  killTweensOf: () => [],
  chain: (data: any) => {
    data?.tweens?.forEach((t: any) => t.onComplete?.());
    data?.onComplete?.();
  },
  addCounter: (data: any) => {
    data?.onComplete?.();
  },
};

// Mock various scene properties
scene.anims = phaserGame.anims;
scene.cache = phaserGame.cache;
scene.plugins = phaserGame.plugins;
scene.registry = phaserGame.registry;
scene.scale = phaserGame.scale;
(scene as any).textures = phaserGame.textures;
scene.events = phaserGame.events;
(scene as any)["manager"] = new PhaserNS.Input.InputManager(phaserGame, {});
(scene as any)["manager"].keyboard = new PhaserNS.Input.Keyboard.KeyboardManager(scene as any);
(scene as any)["pluginEvents"] = new PhaserNS.Events.EventEmitter();
phaserGame.domContainer = {} as HTMLDivElement;
(scene as any)["domContainer"] = {} as HTMLDivElement;
(scene as any).spritePipeline = {};
(scene as any).fieldSpritePipeline = {};

// Set up scene.sys FIRST (MockTextureManager needs scene.sys.events)
scene.load = new MockLoader(scene as any) as any;
scene.sys = {
  queueDepthSort: () => null,
  anims: phaserGame.anims,
  game: phaserGame,
  textures: {
    addCanvas: () => ({
      get: () => ({
        source: {},
        setSize: () => null!,
        glTexture: () => ({ spectorMetadata: {} }),
      }),
    }),
  },
  cache: (scene.load as any).cacheManager,
  scale: phaserGame.scale,
  events: new PhaserNS.Events.EventEmitter(),
  settings: { loader: { key: "battle" } },
  input: phaserGame.input,
} as any;

const mockTextureManager = new MockTextureManager(scene as any);
(scene as any).add = mockTextureManager.add;
(scene as any).textures = mockTextureManager as any;
// @ts-expect-error
scene.sys.displayList = (scene as any).add.displayList;
(scene as any).sys.updateList = new PhaserNS.GameObjects.UpdateList(scene);
(scene as any)["systems"] = scene.sys;
scene.input = phaserGame.input as any;
(scene as any).scene = scene;
scene.input.keyboard = new PhaserNS.Input.Keyboard.KeyboardPlugin(scene as any);
scene.input.gamepad = new PhaserNS.Input.Gamepad.GamepadPlugin(scene as any);
scene.make = new MockGameObjectCreator(mockTextureManager) as any;
(scene.sys as any).make = scene.make; // BitmapMask uses scene.sys.make.image()
(scene as any).time = new MockClock(scene as any);
(scene as any)["remove"] = () => {};

BattleScene.prototype.addPokemonIcon = (() => new PhaserNS.GameObjects.Container(scene)) as any;

// MessageWrapper stub (normally TextInterceptor in test framework)
(scene as any).messageWrapper = {
  showText: (_text: string) => {},
  showDialogue: (_text: string, _name: string) => {},
};

// --- Run scene lifecycle ---
process.stderr.write("[standalone] Running scene.preload + scene.create...\n");
scene.preload();
scene.create();

process.stderr.write("[standalone] Waiting for scene.ui...\n");
await new Promise<void>(resolve => {
  const check = () => {
    if (scene.ui) {
      resolve();
    } else {
      setTimeout(check, 100);
    }
  };
  setTimeout(check, 200);
});

process.stderr.write("[standalone] Scene ready! Starting bridge on stdin/stdout.\n");

// ============================================================
// Phase 9: Start stdin/stdout bridge
// ============================================================

const { startBridge } = await import("./bridge");
startBridge();

await new Promise(() => {});
