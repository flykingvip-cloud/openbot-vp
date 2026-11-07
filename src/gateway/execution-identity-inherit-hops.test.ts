/**
 * Execution-system contract: every reconstruct hop must inherit identity via
 * inheritExecutionIdentityRunFields (or the in-process spawn handoff), not by
 * hand-listing a subset of Gateway scalars. Agent id is irrelevant — this is
 * the digital-employee run path, not a single robot.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const RECONSTRUCT_HOPS = [
  "src/agent-runtime/execution/runner/embedded-run.ts",
  "src/agents/pi-embedded-runner/run/attempt.ts",
  "src/agents/pi-embedded-runner/compact.ts",
  "src/agent-runtime/execution/preparation/embedded-parameters.ts",
  "src/auto-reply/reply/followup-runner.ts",
  "src/agent-runtime/execution/runner/admitted-candidate.ts",
  "src/auto-reply/reply/commands-compact.ts",
  "src/auto-reply/reply/get-reply-inline-actions.ts",
  "src/agents/pi-tools.ts",
  "src/agent-runtime/execution/runner/command-candidate.ts",
  "src/gateway/server-methods/agent.ts",
  "src/gateway/tools-invoke-http.ts",
] as const;

describe("digital-employee execution identity inherit hops", () => {
  it("uses inheritExecutionIdentityRunFields at every reconstruct site", () => {
    for (const relativePath of RECONSTRUCT_HOPS) {
      const source = readRepo(relativePath);
      expect(source, relativePath).toContain("inheritExecutionIdentityRunFields");
    }
  });

  it("stages spawned child identity in-process instead of via model-controlled RPC params", () => {
    const spawn = readRepo("src/agents/subagent-spawn.ts");
    const spawnTool = readRepo("src/agents/tools/sessions-spawn-tool.ts");
    const tools = readRepo("src/agents/openclaw-tools.ts");
    expect(spawn).toContain("stageSpawnExecutionIdentity");
    expect(spawn).toContain("ctx.executionIdentity");
    expect(spawnTool).toContain("executionIdentity: opts?.executionIdentity");
    expect(tools).toContain("executionIdentity,");
    const agentRpc = spawn.slice(spawn.indexOf('method: "agent"'));
    const agentRpcParams = agentRpc.slice(0, agentRpc.indexOf("timeoutMs"));
    expect(agentRpcParams).not.toContain("executionIdentity");
  });
});
