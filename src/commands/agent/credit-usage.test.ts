// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";

const { enqueueUsageOutbox, drainUsageOutboxRecord } = vi.hoisted(() => ({
  enqueueUsageOutbox: vi.fn(async (payload: { taskId: string; userId?: string }) => ({
    id: payload.taskId,
    payload,
  })),
  drainUsageOutboxRecord: vi.fn(async () => ({})),
}));

vi.mock("../../gateway/billing/usage-outbox-store.js", () => ({ enqueueUsageOutbox }));
vi.mock("../../gateway/billing/usage-outbox-drain.js", () => ({ drainUsageOutboxRecord }));

const {
  AGENT_COMMAND_CREDIT_USAGE_ENV,
  isAgentCommandCreditUsageEnabled,
  recordAgentCommandCreditUsage,
  resolveAgentCommandCreditTaskId,
} = await import("./credit-usage.js");

const cfg = {} as OpenBotConfig;
const acquired = {
  status: "acquired" as const,
  authorizationDecisionId: "auth-1",
  subscriptionId: "sub-1",
  subscriptionSnapshotId: "snap-1",
  planId: "plan-1",
  planVersionId: "pv-1",
  modelGate: {
    tenantId: "tenant-a",
    creditReporting: { enterpriseId: "tenant-a", policyId: "policy-1" },
  },
} as const;

function baseParams(overrides: Partial<Parameters<typeof recordAgentCommandCreditUsage>[0]> = {}) {
  return {
    gate: acquired as never,
    cfg,
    runId: "run-1",
    sessionId: "sess-1",
    startedAt: 1000,
    provider: "openai",
    model: "gpt-5.2",
    agentId: "main",
    creditUserId: "alice@example.com",
    result: { meta: { durationMs: 42, agentMeta: { usage: { input: 10, output: 5 } } } },
    fallbackAttempts: [{ provider: "anthropic", model: "claude", error: "429" }],
    env: {},
    ...overrides,
  };
}

describe("agent command credit usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquired + creditReporting records one usage with auth / subscription / token facts", async () => {
    const outcome = await recordAgentCommandCreditUsage(baseParams());
    expect(outcome).toEqual({ status: "recorded", taskId: "run-1" });
    expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "tenant-a",
      policyId: "policy-1",
      taskId: "run-1",
      runId: "run-1",
      modelId: "openai/gpt-5.2",
      userId: "alice@example.com",
      agentId: "main",
      authorizationDecisionId: "auth-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      durationMs: 42,
      retryCount: 0,
      toolCallCount: 0,
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(drainUsageOutboxRecord).toHaveBeenCalledTimes(1);
  });

  it("skipped gate (no enterprise scope) records nothing", async () => {
    const outcome = await recordAgentCommandCreditUsage(
      baseParams({ gate: { status: "skipped" } }),
    );
    expect(outcome).toEqual({ status: "skipped", reason: "gate-not-acquired" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("subagent lane (gate never called) records nothing", async () => {
    const outcome = await recordAgentCommandCreditUsage(baseParams({ gate: undefined }));
    expect(outcome).toEqual({ status: "skipped", reason: "no-commercial-gate" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("acquired without creditReporting records nothing", async () => {
    const outcome = await recordAgentCommandCreditUsage(
      baseParams({ gate: { status: "acquired", modelGate: { tenantId: "t" } } as never }),
    );
    expect(outcome).toEqual({ status: "skipped", reason: "no-credit-reporting" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("CLI-backend provider records nothing (attributed by recordCliBackendUsage)", async () => {
    const outcome = await recordAgentCommandCreditUsage(baseParams({ provider: "claude-cli" }));
    expect(outcome).toEqual({ status: "skipped", reason: "cli-backend" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it("zero usage records nothing", async () => {
    const outcome = await recordAgentCommandCreditUsage(
      baseParams({ result: { meta: { durationMs: 1, agentMeta: { usage: { input: 0 } } } } }),
    );
    expect(outcome).toEqual({ status: "skipped", reason: "no-usage" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
  });

  it.each(["0", "false", "off", "no", " FALSE "])(
    "kill switch %j disables recording",
    async (v) => {
      const outcome = await recordAgentCommandCreditUsage(
        baseParams({ env: { [AGENT_COMMAND_CREDIT_USAGE_ENV]: v } }),
      );
      expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
      expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    },
  );

  it("kill switch defaults ON (unset, empty, 1, unknown)", () => {
    expect(isAgentCommandCreditUsageEnabled({})).toBe(true);
    expect(isAgentCommandCreditUsageEnabled({ [AGENT_COMMAND_CREDIT_USAGE_ENV]: "" })).toBe(true);
    expect(isAgentCommandCreditUsageEnabled({ [AGENT_COMMAND_CREDIT_USAGE_ENV]: "1" })).toBe(true);
    expect(isAgentCommandCreditUsageEnabled({ [AGENT_COMMAND_CREDIT_USAGE_ENV]: "x" })).toBe(true);
  });

  it("run id falling back to the session id gets a per-execution task id", () => {
    expect(resolveAgentCommandCreditTaskId({ runId: "r", sessionId: "s", startedAt: 5 })).toBe("r");
    expect(resolveAgentCommandCreditTaskId({ runId: "s", sessionId: "s", startedAt: 5 })).toBe(
      "agent-credit:s:5",
    );
  });

  it("omits the user when no trusted client user is known", async () => {
    await recordAgentCommandCreditUsage(baseParams({ creditUserId: "  " }));
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]?.userId).toBeUndefined();
  });

  it("enqueue failure is reported, never thrown (the completed run is not failed)", async () => {
    enqueueUsageOutbox.mockRejectedValueOnce(new Error("disk full"));
    const onError = vi.fn();
    const outcome = await recordAgentCommandCreditUsage(baseParams({ onError }));
    expect(outcome).toMatchObject({ status: "failed", taskId: "run-1" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("drain failure is deferred (record stays in the durable outbox)", async () => {
    drainUsageOutboxRecord.mockRejectedValueOnce(new Error("ledger down"));
    const onError = vi.fn();
    const outcome = await recordAgentCommandCreditUsage(baseParams({ onError }));
    expect(outcome).toEqual({ status: "recorded", taskId: "run-1" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("drain deferred"));
  });
});
