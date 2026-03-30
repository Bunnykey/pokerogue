// runner.test.ts — vitest wrapper to run the headless agent
// This runs under vitest's jsdom environment with all mocks pre-loaded.
//
// Usage: npx vitest run src/agent/runner.test.ts --no-file-parallelism

import { describe, it } from "vitest";
import { runAgent } from "#app/agent/runner";

describe("agent runner", () => {
  it("runs the headless game agent", async () => {
    await runAgent();
  }, 600_000); // 10 min timeout
});
