import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("CLI embedded run lifecycle attribution path", () => {
  it("routes openbot agent through runEmbeddedPiAgent into attempt attribution helper", () => {
    const agentSrc = readRepo("src/commands/agent.ts");
    const runSrc = readRepo("src/agents/pi-embedded-runner/run.ts");
    const attemptSrc = readRepo("src/agents/pi-embedded-runner/run/attempt.ts");

    expect(agentSrc).toContain("runEmbeddedPiAgent");
    expect(runSrc).toContain("runEmbeddedAttempt");
    expect(attemptSrc).toContain("createLifecycleSkillToolAttributionHandler");
    expect(attemptSrc).toContain("subscribeEmbeddedPiSession");
  });
});
