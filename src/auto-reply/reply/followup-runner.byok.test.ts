import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunGovernanceSnapshot } from "../../gateway/governance/decision.js";
import { lookupRunModelSet } from "../../gateway/governance/spawn-snapshot-handoff.js";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();
const tryAcquireEnterpriseAgentRunMock = vi.fn();
const releaseEnterpriseAgentRunMock = vi.fn();
const resolveEnterpriseRuntimeInvocationMock = vi.fn();
const enqueueUsageOutboxMock = vi.fn();
const drainUsageOutboxRecordMock = vi.fn();

vi.mock(
  "../../agents/model-fallback.js",
  async () => await import("../../test-utils/model-fallback.mock.js"),
);

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn(),
  abortEmbeddedPiRun: vi.fn(),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("../../gateway/billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: (...args: unknown[]) => tryAcquireEnterpriseAgentRunMock(...args),
  releaseEnterpriseAgentRun: (...args: unknown[]) => releaseEnterpriseAgentRunMock(...args),
}));

vi.mock("../../gateway/enterprise-model/runtime-invocation.js", () => ({
  resolveEnterpriseRuntimeInvocation: (...args: unknown[]) =>
    resolveEnterpriseRuntimeInvocationMock(...args),
}));

vi.mock("../../gateway/billing/usage-outbox-store.js", () => ({
  enqueueUsageOutbox: (...args: unknown[]) => enqueueUsageOutboxMock(...args),
}));

vi.mock("../../gateway/billing/usage-outbox-drain.js", () => ({
  drainUsageOutboxRecord: (...args: unknown[]) => drainUsageOutboxRecordMock(...args),
}));

vi.mock("./route-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./route-reply.js")>();
  return {
    ...actual,
    isRoutableChannel: () => false,
    routeReply: vi.fn(async () => ({ ok: true })),
  };
});

import { createFollowupRunner } from "./followup-runner.js";

const BYOK_MODEL = "abcd1234/gpt-4o";

function createByokQueuedRun(): FollowupRun {
  return {
    prompt: "hello byok",
    summaryLine: "hello byok",
    enqueuedAt: Date.now(),
    originatingTo: "channel:C1",
    run: {
      sessionId: "session",
      sessionKey: "main",
      agentId: "bot-1",
      messageProvider: "whatsapp",
      agentAccountId: "primary",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      agentDir: "/tmp/agent",
      config: {},
      skillsSnapshot: {},
      provider: "ent",
      model: BYOK_MODEL,
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as FollowupRun;
}

describe("createFollowupRunner BYOK", () => {
  beforeEach(() => {
    runEmbeddedPiAgentMock.mockReset();
    tryAcquireEnterpriseAgentRunMock.mockReset();
    releaseEnterpriseAgentRunMock.mockReset();
    resolveEnterpriseRuntimeInvocationMock.mockReset();
    enqueueUsageOutboxMock.mockReset();
    drainUsageOutboxRecordMock.mockReset();

    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: true,
      skipped: false,
      modelGate: {
        tenantId: "ent-1",
        creditReporting: { enterpriseId: "ent-1", policyId: "balanced" },
      },
    });
    resolveEnterpriseRuntimeInvocationMock.mockResolvedValue({
      runtimeModelId: `ent/${BYOK_MODEL}`,
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-tenant-byok",
      baseUrl: "https://byok.example/v1",
      protocol: "openai",
      billingOwner: "enterprise",
      source: "enterprise",
      tenantId: "ent-1",
    });
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "byok ok" }],
      meta: {
        durationMs: 11,
        agentMeta: { usage: { input: 10, output: 20 }, model: "gpt-4o" },
      },
    });
    enqueueUsageOutboxMock.mockResolvedValue({ id: "receipt-1" });
    drainUsageOutboxRecordMock.mockResolvedValue(undefined);
  });

  it("remaps ent/ models and enqueues enterprise credit usage", async () => {
    const onBlockReply = vi.fn(async () => {});
    const runner = createFollowupRunner({
      opts: { onBlockReply },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "claude",
    });

    await runner(createByokQueuedRun());

    expect(resolveEnterpriseRuntimeInvocationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "ent-1",
        provider: "ent",
        model: BYOK_MODEL,
      }),
    );
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o",
        enterpriseRuntimeModelId: `ent/${BYOK_MODEL}`,
        providerAuthOverride: expect.objectContaining({
          apiKey: "sk-tenant-byok",
          source: "enterprise-byok",
          baseUrl: "https://byok.example/v1",
        }),
      }),
    );
    expect(enqueueUsageOutboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "ent-1",
        modelId: `ent/${BYOK_MODEL}`,
        policyId: "balanced",
      }),
    );
    expect(drainUsageOutboxRecordMock).toHaveBeenCalled();
    expect(onBlockReply).toHaveBeenCalled();
    expect(releaseEnterpriseAgentRunMock).toHaveBeenCalled();
  });

  it("an acquired gate puts the parent billing context on the run snapshot (P4-1)", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: true,
      skipped: false,
      authorizationDecisionId: "auth-followup-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "sub-snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      modelGate: {
        tenantId: "ent-1",
        allowlist: [`ent/${BYOK_MODEL}`],
        creditReporting: { enterpriseId: "ent-1", policyId: "balanced" },
      },
    });
    let seen: RunGovernanceSnapshot | undefined | null = null;
    runEmbeddedPiAgentMock.mockImplementation(async (params: { runId?: string }) => {
      // The parent snapshot is live while the run is inside the model call.
      seen = lookupRunModelSet(params.runId);
      return {
        payloads: [{ text: "byok ok" }],
        meta: { durationMs: 11, agentMeta: { usage: { input: 10, output: 20 }, model: "gpt-4o" } },
      };
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "claude",
    });

    await runner(createByokQueuedRun());

    expect(seen).toMatchObject({
      commercialAuthorizationId: "auth-followup-1",
      creditReporting: {
        enterpriseId: "ent-1",
        policyId: "balanced",
        subscriptionId: "sub-1",
        subscriptionSnapshotId: "sub-snap-1",
        planId: "plan-1",
        planVersionId: "pv-1",
      },
    });
  });
});

vi.mock("../../agent-runtime/execution/runner/embedded-run.js", async () => {
  const { runEmbeddedPiAgent } = await import("../../agents/pi-embedded.js");
  return { runEmbeddedPiAgent };
});
