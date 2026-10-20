/**
 * Agent command credit usage — wiring through `agentCommandFromIngress`.
 *
 * Real commercial-run gate wrapper, real `runWithModelFallback`, real credit usage helper.
 * Replaced: billing authority (`tryAcquireEnterpriseAgentRun`), the embedded / CLI runners,
 * and the usage outbox (so nothing touches disk ledgers).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import "../cron/isolated-agent.mocks.js";
import { runCliAgent } from "../agents/cli-runner.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import * as modelSelectionModule from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import type { OpenBotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import type { GovernanceDecision, RunGovernanceSnapshot } from "../gateway/governance/decision.js";
import {
  appendGovernanceShadowDecision,
  GOVERNANCE_SHADOW_LOG_ENV,
} from "../gateway/governance/shadow-sink.js";
import { lookupRunModelSet } from "../gateway/governance/spawn-snapshot-handoff.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCommandFromIngress } from "./agent.js";
import { AGENT_COMMAND_CREDIT_USAGE_ENV } from "./agent/credit-usage.js";
import { SUBAGENT_CREDIT_USAGE_ENV } from "./agent/subagent-credit-usage.js";

const { tryAcquireEnterpriseAgentRun, releaseEnterpriseAgentRun, enqueueUsageOutbox } = vi.hoisted(
  () => ({
    tryAcquireEnterpriseAgentRun: vi.fn(),
    releaseEnterpriseAgentRun: vi.fn(async () => {}),
    enqueueUsageOutbox: vi.fn(async (payload: { taskId: string }) => ({
      id: payload.taskId,
      payload,
    })),
  }),
);

vi.mock("../gateway/billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
}));

vi.mock("../gateway/billing/usage-outbox-store.js", () => ({ enqueueUsageOutbox }));
vi.mock("../gateway/billing/usage-outbox-drain.js", () => ({
  drainUsageOutboxRecord: vi.fn(async () => ({})),
}));

vi.mock("../gateway/governance/shadow-sink.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../gateway/governance/shadow-sink.js")>()),
  appendGovernanceShadowDecision: vi.fn(async () => true),
}));

vi.mock("../agents/cli-runner.js", () => ({ runCliAgent: vi.fn() }));

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

const EMBEDDED = "openai/gpt-5.2";
const CLI = "claude-cli/opus";

function mockConfig(home: string, primary: string) {
  vi.spyOn(configModule, "loadConfig").mockReturnValue({
    agents: {
      defaults: {
        model: { primary },
        models: { [primary]: {} },
        workspace: path.join(home, "openclaw"),
      },
    },
    session: { store: path.join(home, "sessions.json"), mainKey: "main" },
  } as OpenBotConfig);
}

const acquiredGate = {
  acquired: true,
  skipped: false,
  enterpriseId: "tenant-a",
  authorizationDecisionId: "auth-commercial-1",
  planVersionId: "pv-1",
  modelGate: {
    tenantId: "tenant-a",
    creditReporting: { enterpriseId: "tenant-a", policyId: "policy-1" },
  },
};

function runResult(provider: string, model: string) {
  return {
    payloads: [{ text: "ok" }],
    meta: {
      durationMs: 7,
      agentMeta: { sessionId: "s", provider, model, usage: { input: 12, output: 3 } },
    },
  } as never;
}

async function runAgent(
  opts: {
    primary?: string;
    lane?: string;
    runId?: string;
    spawnGovernanceSnapshot?: RunGovernanceSnapshot;
  } = {},
) {
  await withTempHomeBase(
    async (home) => {
      mockConfig(home, opts.primary ?? EMBEDDED);
      await agentCommandFromIngress(
        {
          message: "hi",
          to: "+1555",
          senderIsOwner: false,
          gatewayClientUser: "alice@example.com",
          runId: opts.runId ?? "rpc-run-1",
          ...(opts.lane ? { lane: opts.lane } : {}),
          ...(opts.spawnGovernanceSnapshot
            ? { spawnGovernanceSnapshot: opts.spawnGovernanceSnapshot }
            : {}),
        },
        runtime,
      );
    },
    { prefix: "openbot-agent-credit-" },
  );
}

describe("agent command credit usage — wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configModule.clearRuntimeConfigSnapshot();
    delete process.env[AGENT_COMMAND_CREDIT_USAGE_ENV];
    // P4-1 switch is off unless a test turns it on.
    delete process.env[SUBAGENT_CREDIT_USAGE_ENV];
    vi.mocked(loadModelCatalog).mockResolvedValue([]);
    vi.mocked(modelSelectionModule.isCliProvider).mockImplementation(
      (provider: string) => provider === "claude-cli",
    );
    vi.spyOn(configModule, "readConfigFileSnapshotForWrite").mockResolvedValue({
      snapshot: { valid: false, resolved: {} as OpenBotConfig },
      writeOptions: {},
    } as Awaited<ReturnType<typeof configModule.readConfigFileSnapshotForWrite>>);
    vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) =>
      runResult(params.provider ?? "", params.model ?? ""),
    );
    vi.mocked(runCliAgent).mockImplementation(async () => runResult("claude-cli", "opus"));
  });

  it("acquired enterprise run records one credit usage keyed by the run id", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate);
    await runAgent();
    expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "tenant-a",
      policyId: "policy-1",
      taskId: "rpc-run-1",
      runId: "rpc-run-1",
      modelId: EMBEDDED,
      userId: "alice@example.com",
      authorizationDecisionId: "auth-commercial-1",
      planVersionId: "pv-1",
      tokenUsage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it("skipped (no enterprise scope) records nothing", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
    await runAgent();
    expect(runEmbeddedPiAgent).toHaveBeenCalled();
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("subagent lane acquires a slot and records its own credit usage", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate);
    await runAgent({ lane: "subagent" });
    expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
    expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "tenant-a",
      authorizationDecisionId: "auth-commercial-1",
    });
  });

  describe("P4-0 subagent usage attribution (shadow only, never billed)", () => {
    // Shape produced by snapshotForChildModelHandoff for a parent that held an
    // enterprise commercial authorization.
    const parentSnapshot: RunGovernanceSnapshot = {
      snapshotId: "gd-parent-snapshot",
      runId: "parent-run-1",
      parentRunId: "parent-run-1",
      governanceMode: "shadow",
      decisions: [],
      effectiveModelSet: { allowlist: [EMBEDDED] },
      commercialAuthorizationId: "auth-parent-1",
      createdAt: "2026-09-28T00:00:00.000Z",
    };

    function commercialRunShadows(): GovernanceDecision[] {
      return vi
        .mocked(appendGovernanceShadowDecision)
        .mock.calls.map(([decision]) => decision)
        .filter((decision) => decision.source === "commercial-run");
    }

    it("parent authorization id + usage + SHADOW_LOG=1: writes the child attribution, no outbox", async () => {
      const sink = await vi.importActual<typeof import("../gateway/governance/shadow-sink.js")>(
        "../gateway/governance/shadow-sink.js",
      );
      const logPath = sink.governanceShadowDecisionsPath();
      await fs.rm(logPath, { force: true });
      process.env[GOVERNANCE_SHADOW_LOG_ENV] = "1";
      vi.mocked(appendGovernanceShadowDecision).mockImplementation(
        sink.appendGovernanceShadowDecision,
      );
      try {
        tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
        await runAgent({
          lane: "subagent",
          runId: "child-run-1",
          spawnGovernanceSnapshot: parentSnapshot,
        });
        const lines = (await fs.readFile(logPath, "utf8"))
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as GovernanceDecision);
        const attribution = lines.filter(
          (decision) =>
            decision.source === "commercial-run" &&
            decision.runId === "child-run-1" &&
            decision.reason === "subagent-usage-not-billed",
        );
        expect(attribution).toHaveLength(1);
        expect(attribution[0]).toMatchObject({
          source: "commercial-run",
          mode: "shadow",
          effect: "skipped",
          reason: "subagent-usage-not-billed",
          runId: "child-run-1",
          parentRunId: "parent-run-1",
          parentDecisionId: "gd-parent-snapshot",
          commercialAuthorizationId: "auth-parent-1",
          shadow: {
            existing: { effect: "skipped", source: "commercial-run", reason: "no-commercial-gate" },
            divergence: "D5",
          },
        });
        expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
        expect(enqueueUsageOutbox).not.toHaveBeenCalled();
      } finally {
        delete process.env[GOVERNANCE_SHADOW_LOG_ENV];
        vi.mocked(appendGovernanceShadowDecision).mockImplementation(async () => true);
        await fs.rm(logPath, { force: true });
      }
    });

    it("no parent authorization id + usage: missing-parent-authorization, no outbox", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({ lane: "subagent", runId: "child-run-2" });
      const attribution = commercialRunShadows().filter(
        (decision) => decision.reason === "missing-parent-authorization",
      );
      expect(attribution).toHaveLength(1);
      expect(attribution[0]).toMatchObject({
        effect: "skipped",
        reason: "missing-parent-authorization",
        runId: "child-run-2",
      });
      expect(attribution[0]).not.toHaveProperty("commercialAuthorizationId");
      expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    });

    it("zero usage: no attribution envelope, no outbox", async () => {
      vi.mocked(runEmbeddedPiAgent).mockImplementation(
        async (params) =>
          ({
            payloads: [{ text: "ok" }],
            meta: {
              durationMs: 7,
              agentMeta: {
                sessionId: "s",
                provider: params.provider,
                model: params.model,
                usage: { input: 0, output: 0 },
              },
            },
          }) as never,
      );
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({
        lane: "subagent",
        runId: "child-run-3",
        spawnGovernanceSnapshot: parentSnapshot,
      });
      expect(runEmbeddedPiAgent).toHaveBeenCalled();
      expect(
        commercialRunShadows().filter(
          (decision) => decision.reason === "subagent-usage-not-billed",
        ),
      ).toEqual([]);
      expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    });
  });

  describe("P4-1 subagent credit usage (OPENBOT_SUBAGENT_CREDIT_USAGE, default off)", () => {
    // A child snapshot whose parent held an enterprise authorization with billing context.
    const billableSnapshot: RunGovernanceSnapshot = {
      snapshotId: "gd-parent-snapshot",
      runId: "parent-run-1",
      parentRunId: "parent-run-1",
      governanceMode: "shadow",
      decisions: [],
      effectiveModelSet: { allowlist: [EMBEDDED] },
      commercialAuthorizationId: "auth-parent-1",
      creditReporting: {
        enterpriseId: "tenant-a",
        policyId: "policy-1",
        subscriptionId: "sub-1",
        planVersionId: "pv-1",
      },
      createdAt: "2026-09-28T00:00:00.000Z",
    };

    function commercialRunShadows(): GovernanceDecision[] {
      return vi
        .mocked(appendGovernanceShadowDecision)
        .mock.calls.map(([decision]) => decision)
        .filter((decision) => decision.source === "commercial-run");
    }

    afterEach(() => {
      delete process.env[SUBAGENT_CREDIT_USAGE_ENV];
    });

    it("switch unset + full billing context: still the P4-0 shadow only, no outbox", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({
        lane: "subagent",
        runId: "child-run-off",
        spawnGovernanceSnapshot: billableSnapshot,
      });
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
      expect(
        commercialRunShadows().filter(
          (decision) => decision.reason === "subagent-usage-not-billed",
        ),
      ).toEqual([
        expect.objectContaining({
          reason: "subagent-usage-not-billed",
          runId: "child-run-off",
          commercialAuthorizationId: "auth-parent-1",
        }),
      ]);
    });

    it("switch on + full context + usage: outbox exactly once for the child run, no gate", async () => {
      process.env[SUBAGENT_CREDIT_USAGE_ENV] = "1";
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({
        lane: "subagent",
        runId: "child-run-bill",
        spawnGovernanceSnapshot: billableSnapshot,
      });
      expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
      expect(enqueueUsageOutbox.mock.calls[0]?.[0]).toMatchObject({
        taskId: "child-run-bill",
        runId: "child-run-bill",
        authorizationDecisionId: "auth-parent-1",
        enterpriseId: "tenant-a",
        policyId: "policy-1",
        subscriptionId: "sub-1",
        planVersionId: "pv-1",
        modelId: EMBEDDED,
        userId: "alice@example.com",
        toolCallCount: 0,
        toolClasses: [],
        tokenUsage: { inputTokens: 12, outputTokens: 3 },
      });
      // The child consulted the commercial gate. A skipped gate holds no slot.
      // Parent billing remains only for that skipped case.
      expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
      expect(releaseEnterpriseAgentRun).not.toHaveBeenCalled();
      expect(
        commercialRunShadows().filter((d) => d.reason === "subagent-usage-not-billed"),
      ).toEqual([]);
    });

    it("switch on + missing policyId: no outbox, subagent-billing-context-absent", async () => {
      process.env[SUBAGENT_CREDIT_USAGE_ENV] = "1";
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({
        lane: "subagent",
        runId: "child-run-no-policy",
        spawnGovernanceSnapshot: {
          ...billableSnapshot,
          creditReporting: { enterpriseId: "tenant-a", planVersionId: "pv-1" },
        },
      });
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
      expect(
        commercialRunShadows().filter(
          (decision) => decision.reason === "subagent-billing-context-absent",
        ),
      ).toEqual([
        expect.objectContaining({
          effect: "skipped",
          reason: "subagent-billing-context-absent",
          runId: "child-run-no-policy",
          commercialAuthorizationId: "auth-parent-1",
        }),
      ]);
    });

    it("switch on + CLI backend: no outbox", async () => {
      process.env[SUBAGENT_CREDIT_USAGE_ENV] = "1";
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      await runAgent({
        primary: CLI,
        lane: "subagent",
        runId: "child-run-cli",
        spawnGovernanceSnapshot: billableSnapshot,
      });
      expect(runCliAgent).toHaveBeenCalled();
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
      expect(
        commercialRunShadows().filter(
          (decision) => decision.reason === "subagent-usage-not-billed",
        ),
      ).toEqual([]);
      expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalled();
    });

    it("an acquired parent run puts its billing context on its run snapshot", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({
        ...acquiredGate,
        subscriptionId: "sub-1",
        subscriptionSnapshotId: "sub-snap-1",
        planId: "plan-1",
        modelGate: { ...acquiredGate.modelGate, allowlist: [EMBEDDED] },
      });
      let seen: RunGovernanceSnapshot | undefined;
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
        seen = lookupRunModelSet("rpc-run-1");
        return runResult(params.provider ?? "", params.model ?? "");
      });
      await runAgent();
      expect(seen).toMatchObject({
        runId: "rpc-run-1",
        commercialAuthorizationId: "auth-commercial-1",
        creditReporting: {
          enterpriseId: "tenant-a",
          policyId: "policy-1",
          subscriptionId: "sub-1",
          subscriptionSnapshotId: "sub-snap-1",
          planId: "plan-1",
          planVersionId: "pv-1",
        },
      });
    });

    it("a skipped parent gate stores no snapshot and no billing context", async () => {
      tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
      let seen: RunGovernanceSnapshot | undefined | null = null;
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
        seen = lookupRunModelSet("rpc-run-1");
        return runResult(params.provider ?? "", params.model ?? "");
      });
      await runAgent();
      expect(seen).toBeUndefined();
    });
  });

  it("CLI-backend run records no credit usage (no double count with recordCliBackendUsage)", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate);
    await runAgent({ primary: CLI });
    expect(runCliAgent).toHaveBeenCalled();
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("kill switch off records nothing", async () => {
    process.env[AGENT_COMMAND_CREDIT_USAGE_ENV] = "0";
    tryAcquireEnterpriseAgentRun.mockResolvedValue(acquiredGate);
    await runAgent();
    expect(runEmbeddedPiAgent).toHaveBeenCalled();
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    delete process.env[AGENT_COMMAND_CREDIT_USAGE_ENV];
  });
});
