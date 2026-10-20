/**
 * Full-path agent command governance test (governance closure plan v1.0 §7.3 / §7.7).
 *
 * Drives `agentCommandFromIngress` through the real commercial-run gate wrapper,
 * `resolveAgentCommandModelGovernance`, and the real `runWithModelFallback`. Only the
 * billing authority (`tryAcquireEnterpriseAgentRun`), the embedded runner, and the
 * shadow sink's disk write are replaced.
 */

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import "../cron/isolated-agent.mocks.js";
import { FailoverError } from "../agents/failover-error.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import * as modelFallbackModule from "../agents/model-fallback.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import type { OpenBotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import { createExecutionIdentityContext } from "../gateway/execution-identity-context.js";
import type { GovernanceDecision } from "../gateway/governance/decision.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand, agentCommandFromIngress } from "./agent.js";

const { tryAcquireEnterpriseAgentRun, releaseEnterpriseAgentRun, appendShadow } = vi.hoisted(
  () => ({
    tryAcquireEnterpriseAgentRun: vi.fn(),
    releaseEnterpriseAgentRun: vi.fn(async () => {}),
    appendShadow: vi.fn(async () => true),
  }),
);

vi.mock("../gateway/billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
}));

vi.mock("../gateway/governance/shadow-sink.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../gateway/governance/shadow-sink.js")>()),
  appendGovernanceShadowDecision: appendShadow,
}));

vi.mock("../agents/model-fallback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/model-fallback.js")>();
  return { ...actual, runWithModelFallback: vi.fn(actual.runWithModelFallback) };
});

vi.mock("../agents/auth-profiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/auth-profiles.js")>()),
  ensureAuthProfileStore: vi.fn(() => ({ version: 1, profiles: {} })),
}));

vi.mock("../agents/workspace.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/workspace.js")>()),
  ensureAgentWorkspace: vi.fn(async ({ dir }: { dir: string }) => ({ dir })),
}));

vi.mock("../agents/skills.js", () => ({ buildWorkspaceSkillSnapshot: vi.fn(() => undefined) }));
vi.mock("../agents/skills/refresh.js", () => ({ getSkillsSnapshotVersion: vi.fn(() => 0) }));

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

const MODE_ENV = "OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE";
const PRIMARY = "anthropic/claude-opus-4-5";
const FALLBACK = "openai/gpt-5.2";
const identity = createExecutionIdentityContext({
  user: "alice@example.com",
  platformUserId: "emp-1",
  sessionDomain: "employee",
});

function mockConfig(home: string) {
  vi.spyOn(configModule, "loadConfig").mockReturnValue({
    agents: {
      defaults: {
        model: { primary: PRIMARY, fallbacks: [FALLBACK] },
        models: { [PRIMARY]: {}, [FALLBACK]: {} },
        workspace: path.join(home, "openclaw"),
      },
    },
    session: { store: path.join(home, "sessions.json"), mainKey: "main" },
  } as OpenBotConfig);
}

function acquiredGate(allowlist: string[]) {
  return {
    acquired: true,
    skipped: false,
    enterpriseId: "tenant-a",
    authorizationDecisionId: "auth-commercial-1",
    modelGate: { tenantId: "tenant-a", allowlist },
  };
}

function triedModels(): string[] {
  return vi
    .mocked(runEmbeddedPiAgent)
    .mock.calls.map(([params]) => `${params.provider}/${params.model}`);
}

function shadowDecisions(): GovernanceDecision[] {
  return (appendShadow.mock.calls as unknown as Array<[unknown]>).map(
    ([decision]) => decision as GovernanceDecision,
  );
}

function modelShadowDecisions(): GovernanceDecision[] {
  return shadowDecisions().filter((d) => d.source === "model-entitlement");
}

function commercialShadowDecisions(): GovernanceDecision[] {
  return shadowDecisions().filter((d) => d.source === "commercial-run");
}

function lastFallbackParams() {
  return vi.mocked(modelFallbackModule.runWithModelFallback).mock.calls.at(-1)?.[0];
}

/** Each run gets a fresh home so session / cooldown state never leaks between runs. */
async function runAgent(): Promise<string[]> {
  vi.mocked(runEmbeddedPiAgent).mockClear();
  appendShadow.mockClear();
  return withTempHomeBase(
    async (home) => {
      mockConfig(home);
      await agentCommandFromIngress(
        { message: "hi", to: "+1555", senderIsOwner: false, executionIdentity: identity },
        runtime,
      );
      return triedModels();
    },
    { prefix: "openbot-gov-path-" },
  );
}

describe("agent command governance — full path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configModule.clearRuntimeConfigSnapshot();
    delete process.env[MODE_ENV];
    vi.mocked(loadModelCatalog).mockResolvedValue([]);
    vi.spyOn(configModule, "readConfigFileSnapshotForWrite").mockResolvedValue({
      snapshot: { valid: false, resolved: {} as OpenBotConfig },
      writeOptions: {},
    } as Awaited<ReturnType<typeof configModule.readConfigFileSnapshotForWrite>>);
    // Primary fails over so every candidate is visible in the call log.
    vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
      if (params.provider === "anthropic") {
        throw new FailoverError("rate limited", {
          reason: "rate_limit",
          provider: "anthropic",
          model: "claude-opus-4-5",
          status: 429,
        });
      }
      return {
        payloads: [{ text: "ok" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: params.provider, model: params.model },
        },
      } as never;
    });
  });

  it("enterprise scope, default mode: shadow would-deny recorded, candidates unchanged vs legacy", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate(["other/model"]));

    process.env[MODE_ENV] = "legacy";
    const legacyTried = await runAgent();
    expect(modelShadowDecisions()[0]).toMatchObject({ effect: "skipped", mode: "legacy" });
    expect(commercialShadowDecisions()[0]).toMatchObject({
      source: "commercial-run",
      effect: "allow",
      decisionId: "auth-commercial-1",
      tenantId: "tenant-a",
    });

    delete process.env[MODE_ENV];
    const shadowTried = await runAgent();

    // governanceMode + allowlist reached runWithModelFallback.
    expect(lastFallbackParams()).toMatchObject({
      governanceMode: "shadow",
      entitlementAllowlist: ["other/model"],
      governanceContext: {
        tenantId: "tenant-a",
        actorId: "platform-user:emp-1",
        commercialAuthorizationId: "auth-commercial-1",
      },
    });
    expect(lastFallbackParams()).not.toHaveProperty("preferredModelOrder");

    // Shadow does not filter: identical candidates to legacy.
    expect(shadowTried).toEqual([PRIMARY, FALLBACK]);
    expect(shadowTried).toEqual(legacyTried);

    const [decision] = modelShadowDecisions();
    expect(decision).toMatchObject({
      source: "model-entitlement",
      mode: "shadow",
      effect: "deny",
      reason: "entitlement-empty",
      tenantId: "tenant-a",
      actorId: "platform-user:emp-1",
      commercialAuthorizationId: "auth-commercial-1",
      shadow: { divergence: "D1" },
    });
    expect(decision?.decisionId).toMatch(/^gd-/);
    expect(decision?.decisionId).not.toBe("auth-commercial-1");
    expect(JSON.stringify(decision)).not.toContain("alice@example.com");
    expect(releaseEnterpriseAgentRun).toHaveBeenCalled();
  });

  it("no enterprise scope: skipped + legacy, no allowlist, nothing filtered", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
    process.env[MODE_ENV] = "enforced";
    const tried = await runAgent();
    expect(tried).toEqual([PRIMARY, FALLBACK]);
    expect(lastFallbackParams()).toMatchObject({ governanceMode: "legacy" });
    expect(lastFallbackParams()?.entitlementAllowlist).toBeUndefined();
    expect(modelShadowDecisions()).toEqual([
      expect.objectContaining({
        effect: "skipped",
        mode: "legacy",
        reason: "no-enterprise-scope",
        actorId: "platform-user:emp-1",
      }),
    ]);
    expect(modelShadowDecisions()[0]).not.toHaveProperty("tenantId");
    expect(commercialShadowDecisions()).toEqual([
      expect.objectContaining({
        source: "commercial-run",
        effect: "skipped",
        mode: "legacy",
        reason: "no-enterprise-scope",
      }),
    ]);
    expect(releaseEnterpriseAgentRun).not.toHaveBeenCalled();
  });

  it("subagent lane acquires quota and keeps model params on the parent snapshot", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
    await withTempHomeBase(
      async (home) => {
        mockConfig(home);
        await agentCommandFromIngress(
          { message: "hi", to: "+1555", senderIsOwner: false, lane: "subagent" },
          runtime,
        );
        expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
        expect(lastFallbackParams()).not.toHaveProperty("governanceMode");
        expect(commercialShadowDecisions()).toEqual([
          expect.objectContaining({
            source: "commercial-run",
            entry: "E6",
            effect: "skipped",
          }),
        ]);
        expect(modelShadowDecisions()).toEqual([
          expect.objectContaining({
            source: "model-entitlement",
            reason: "missing-parent-snapshot",
          }),
        ]);
      },
      { prefix: "openbot-gov-path-" },
    );
  });

  describe("envelope entry stamp (P3)", () => {
    function entries(decisions: GovernanceDecision[]): (string | undefined)[] {
      return decisions.map((decision) => decision.entry);
    }

    async function inTempHome(run: () => Promise<unknown>): Promise<void> {
      appendShadow.mockClear();
      await withTempHomeBase(
        async (home) => {
          mockConfig(home);
          await run();
        },
        { prefix: "openbot-gov-entry-" },
      );
    }

    it("gateway ingress stamps E2 on the model row and the commercial-gate row", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate([PRIMARY, FALLBACK]));
      await runAgent();
      expect(entries(modelShadowDecisions())).toEqual(["E2"]);
      expect(entries(commercialShadowDecisions())).toEqual(["E2"]);
    });

    it("gateway ingress stamps E2 on legacy rows and ignores a caller-supplied entry", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await inTempHome(() =>
        agentCommandFromIngress(
          // Not part of the ingress type; a caller cannot choose E3.
          { message: "hi", to: "+1555", senderIsOwner: false, governanceEntry: "E3" } as never,
          runtime,
        ),
      );
      expect(modelShadowDecisions()).toEqual([
        expect.objectContaining({ mode: "legacy", entry: "E2" }),
      ]);
      expect(commercialShadowDecisions()).toEqual([
        expect.objectContaining({ mode: "legacy", entry: "E2" }),
      ]);
    });

    it("CLI --local stamps E3 on the model row and the commercial-gate row", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate([PRIMARY, FALLBACK]));
      await inTempHome(() => agentCliCommand({ message: "hi", to: "+1555", local: true }, runtime));
      expect(entries(modelShadowDecisions())).toEqual(["E3"]);
      expect(entries(commercialShadowDecisions())).toEqual(["E3"]);
    });

    it("agentCommand without a caller entry stamps nothing", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate([PRIMARY, FALLBACK]));
      await inTempHome(() => agentCommand({ message: "hi", to: "+1555" }, runtime));
      expect(modelShadowDecisions()).toHaveLength(1);
      expect(modelShadowDecisions()[0]).not.toHaveProperty("entry");
      expect(commercialShadowDecisions()).toHaveLength(1);
      expect(commercialShadowDecisions()[0]).not.toHaveProperty("entry");
    });

    it("subagent lane stamps E6 on the model row and the commercial row", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await inTempHome(() =>
        agentCommandFromIngress(
          { message: "hi", to: "+1555", senderIsOwner: false, lane: "subagent" },
          runtime,
        ),
      );
      expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
      expect(entries(commercialShadowDecisions())).toEqual(["E6"]);
      expect(entries(modelShadowDecisions())).toEqual(["E6"]);
    });
  });
});
