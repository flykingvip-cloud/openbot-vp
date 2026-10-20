/**
 * P4-1 site test for runAgentTurnWithFallback (reached through runReplyAgent).
 *
 * While the run holds an acquired commercial gate, the parent run snapshot that
 * child runs copy must carry the parent authorization id and the billing context
 * of that gate. A gate without `modelGate.creditReporting` puts no billing
 * context on the snapshot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunGovernanceSnapshot } from "../../gateway/governance/decision.js";
import { lookupRunModelSet } from "../../gateway/governance/spawn-snapshot-handoff.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const mocks = vi.hoisted(() => ({
  runEmbeddedPiAgent: vi.fn(),
  runWithModelFallback: vi.fn(),
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
  recordCreditUsage: vi.fn(),
}));

vi.mock("../../agents/model-fallback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/model-fallback.js")>();
  return { ...actual, runWithModelFallback: mocks.runWithModelFallback };
});

vi.mock("../../agents/pi-embedded.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/pi-embedded.js")>();
  return {
    ...actual,
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
  };
});

vi.mock("./queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queue.js")>();
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

vi.mock("../../gateway/billing/agent-run-governance.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../gateway/billing/agent-run-governance.js")>();
  return {
    ...actual,
    tryAcquireEnterpriseAgentRun: mocks.tryAcquireEnterpriseAgentRun,
    releaseEnterpriseAgentRun: mocks.releaseEnterpriseAgentRun,
  };
});

vi.mock("../../gateway/billing/record-credit-usage.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../gateway/billing/record-credit-usage.js")>();
  return { ...actual, recordCreditUsage: mocks.recordCreditUsage };
});

import { runReplyAgent } from "./agent-runner.js";

const RUN_ID = "run-reply-p41";

function buildParams(): Parameters<typeof runReplyAgent>[0] {
  return {
    commandBody: "hello",
    followupRun: {
      prompt: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "main",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "main",
        messageProvider: "telegram",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        config: {},
        provider: "anthropic",
        model: "claude",
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun,
    queueKey: "main",
    resolvedQueue: { mode: "interrupt" } as QueueSettings,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    opts: { runId: RUN_ID },
    typing: createMockTypingController(),
    sessionCtx: {
      Provider: "telegram",
      Surface: "telegram",
      To: "chat-1",
      OriginatingTo: "chat-1",
      AccountId: "default",
      MessageSid: "msg-1",
    } as unknown as TemplateContext,
    defaultModel: "anthropic/claude",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  };
}

describe("runAgentTurnWithFallback parent billing context on the run snapshot (P4-1)", () => {
  let seen: RunGovernanceSnapshot | undefined | null;

  beforeEach(() => {
    seen = null;
    mocks.tryAcquireEnterpriseAgentRun.mockReset();
    mocks.releaseEnterpriseAgentRun.mockReset();
    mocks.releaseEnterpriseAgentRun.mockResolvedValue(undefined);
    mocks.recordCreditUsage.mockReset();
    mocks.recordCreditUsage.mockResolvedValue(undefined);
    mocks.runEmbeddedPiAgent.mockReset();
    mocks.runEmbeddedPiAgent.mockImplementation(async (params: { runId?: string }) => {
      // The parent snapshot is live while the run is inside the model call.
      seen = lookupRunModelSet(params.runId);
      return {
        payloads: [{ text: "ok" }],
        meta: {
          agentMeta: {
            sessionId: "session",
            provider: "anthropic",
            model: "claude",
            usage: { input: 10, output: 20 },
          },
        },
      };
    });
    mocks.runWithModelFallback.mockReset();
    mocks.runWithModelFallback.mockImplementation(
      async (params: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => ({
        result: await params.run(params.provider, params.model),
        provider: params.provider,
        model: params.model,
      }),
    );
  });

  it("an acquired gate puts the parent authorization and billing context on the snapshot", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "ent-1",
      authorizationDecisionId: "auth-reply-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "sub-snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      modelGate: {
        tenantId: "ent-1",
        allowlist: ["anthropic/claude"],
        creditReporting: { enterpriseId: "ent-1", policyId: "balanced" },
      },
    });

    const result = await runReplyAgent(buildParams());

    expect(result).toMatchObject({ text: "ok" });
    expect(mocks.tryAcquireEnterpriseAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({
      runId: RUN_ID,
      commercialAuthorizationId: "auth-reply-1",
      creditReporting: {
        enterpriseId: "ent-1",
        policyId: "balanced",
        subscriptionId: "sub-1",
        subscriptionSnapshotId: "sub-snap-1",
        planId: "plan-1",
        planVersionId: "pv-1",
      },
    });
    // The parent's own run still bills through the existing path.
    expect(mocks.recordCreditUsage).toHaveBeenCalledTimes(1);
    // Released with the slot.
    expect(lookupRunModelSet(RUN_ID)).toBeUndefined();
  });

  it("an acquired gate without creditReporting leaves the snapshot without billing context", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "ent-1",
      authorizationDecisionId: "auth-reply-2",
      subscriptionId: "sub-1",
      planVersionId: "pv-1",
      modelGate: { tenantId: "ent-1", allowlist: ["anthropic/claude"] },
    });

    const result = await runReplyAgent(buildParams());

    expect(result).toMatchObject({ text: "ok" });
    expect(seen).toMatchObject({ runId: RUN_ID, commercialAuthorizationId: "auth-reply-2" });
    expect(seen?.creditReporting).toBeUndefined();
    expect(mocks.recordCreditUsage).not.toHaveBeenCalled();
  });
});
