// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision } from "../../gateway/governance/decision.js";

const { appendMock } = vi.hoisted(() => ({ appendMock: vi.fn() }));
vi.mock("../../gateway/governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendMock,
}));

const { runWithModelFallback } = await import("../../agents/model-fallback.js");
const { makeModelFallbackCfg } =
  await import("../../agents/test-helpers/model-fallback-config-fixture.js");
const { resolveAgentCommandModelGovernance } = await import("./model-governance.js");
const { createExecutionIdentityContext } =
  await import("../../gateway/execution-identity-context.js");

const PRIMARY = "openai/gpt-4.1-mini";
const FALLBACK = "anthropic/claude-haiku-3-5";

function makeRun() {
  return vi.fn(async (provider: string, model: string) => {
    if (provider === "openai") {
      throw Object.assign(new Error("rate-limited"), { status: 429 });
    }
    return `ok:${provider}/${model}`;
  });
}

function calledKeys(run: ReturnType<typeof makeRun>): string[] {
  return run.mock.calls.map(([provider, model]) => `${provider}/${model}`);
}

function recordedDecisions(): GovernanceDecision[] {
  return appendMock.mock.calls.map(([decision]) => decision as GovernanceDecision);
}

describe("agent command gate → runWithModelFallback governance", () => {
  let agentDir: string;

  beforeEach(async () => {
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gov-agent-"));
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  async function runWith(extra: Record<string, unknown>) {
    const run = makeRun();
    const result = await runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      agentDir,
      run,
      ...extra,
    });
    return { run, result };
  }

  it("no enterprise scope (gate skipped) → effect=skipped, mode=legacy, even if env says enforced", async () => {
    const params = resolveAgentCommandModelGovernance(
      { status: "skipped" },
      { OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE: "enforced" },
    );
    const { run } = await runWith(params);
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()).toEqual([
      expect.objectContaining({ effect: "skipped", mode: "legacy", reason: "no-enterprise-scope" }),
    ]);
  });

  it("acquired gate under the default mode shadows the gate allowlist", async () => {
    const params = resolveAgentCommandModelGovernance(
      {
        status: "acquired",
        authorizationDecisionId: "auth-9",
        modelGate: {
          tenantId: "tenant-z",
          allowlist: [],
          effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
        },
      },
      {},
      createExecutionIdentityContext({ platformUserId: "emp-z" }),
    );
    const { run } = await runWith(params);
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "deny",
      mode: "shadow",
      tenantId: "tenant-z",
      actorId: "platform-user:emp-z",
      commercialAuthorizationId: "auth-9",
    });
  });
});
