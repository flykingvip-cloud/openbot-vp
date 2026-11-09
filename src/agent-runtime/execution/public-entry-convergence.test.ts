import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as legacyCli from "../../agents/cli-runner.js";
import * as legacyEmbedded from "../../agents/pi-embedded.js";
import * as execution from "./index.js";

describe("execution public entry convergence", () => {
  it("exposes the unique CLI adapter through execution/index with facade identity", () => {
    expect(execution.runCliAgent).toBe(legacyCli.runCliAgent);
    expect(execution.runClaudeCliAgent).toBe(legacyCli.runClaudeCliAgent);
  });

  it("exposes the unique embedded adapter through execution/index with facade identity", () => {
    expect(execution.runEmbeddedPiAgent).toBe(legacyEmbedded.runEmbeddedPiAgent);
  });

  it("keeps residual production hosts on execution/index rather than legacy facades", () => {
    const root = process.cwd();
    const hosts = [
      "src/gateway/supervisor/worker-executor.ts",
      "src/hooks/llm-slug-generator.ts",
      "src/auto-reply/reply/agent-runner-memory.ts",
      "src/commands/agent.ts",
      "src/extensionAPI.ts",
    ];
    for (const rel of hosts) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      expect(source, rel).not.toMatch(/from ["'][^"']*agents\/cli-runner/);
      expect(source, rel).not.toMatch(/from ["'][^"']*agents\/pi-embedded["']/);
      expect(source, rel).not.toMatch(/from ["'][^"']*agents\/pi-embedded\.js["']/);
      expect(source, rel).not.toMatch(/from ["'][^"']*pi-embedded-runner\/types/);
      expect(source, rel).toMatch(/agent-runtime\/execution/);
    }
  });
});
