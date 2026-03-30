// Minimal Vite config for the standalone agent runner.
// Includes tsconfigPaths for path alias resolution.
// Redirects ALL phaser3-rex-plugins to lightweight mocks.

import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const mock = (f: string) => path.resolve("src/agent/mocks", f);

// Phaser ESM has no default export, but game code uses `import Phaser from "phaser"`.
// This plugin provides a synthetic default export wrapping the namespace.
function phaserDefaultExport(): Plugin {
  return {
    name: "phaser-default-export",
    enforce: "pre",
    resolveId(id) {
      if (id === "phaser") {
        return "\0virtual:phaser";
      }
      return null;
    },
    load(id) {
      if (id === "\0virtual:phaser") {
        // Create a mutable copy since ESM namespace objects are frozen
        return [
          'import * as _PhaserNS from "phaser/dist/phaser.esm.js";',
          "const Phaser = {};",
          "for (const k of Object.keys(_PhaserNS)) Phaser[k] = _PhaserNS[k];",
          "export default Phaser;",
          "export * from 'phaser/dist/phaser.esm.js';",
        ].join("\n");
      }
      return null;
    },
  };
}

// Custom plugin that intercepts all phaser3-rex-plugins imports
function rexPluginsMock(): Plugin {
  const routeMap: Record<string, string> = {
    bbcodetext: mock("bbcodetext.ts"),
    inputtext: mock("inputtext.ts"),
    soundfade: mock("soundfade.ts"),
    roundrectangle: mock("roundrectangle.ts"),
  };

  return {
    name: "rex-plugins-mock",
    enforce: "pre",
    resolveId(id) {
      if (!id.startsWith("phaser3-rex-plugins/")) {
        return null;
      }
      const lower = id.toLowerCase();

      // Route known plugin types to specific mocks
      for (const [key, mockPath] of Object.entries(routeMap)) {
        if (lower.includes(key)) {
          return mockPath;
        }
      }

      // Everything else → generic stub
      return mock("rex-plugin-stub.ts");
    },
  };
}

export default defineConfig({
  plugins: [phaserDefaultExport(), tsconfigPaths(), rexPluginsMock()],
  esbuild: {
    keepNames: true,
  },
});
