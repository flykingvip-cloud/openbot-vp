// @vitest-environment node

import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type {
  GovernanceDecision,
  RunGovernanceSnapshot,
} from "../../gateway/governance/decision.js";

const { enqueueUsageOutbox, appendMock } = vi.hoisted(() => ({
  enqueueUsageOutbox: vi.fn(),
  appendMock: vi.fn(),
}));
vi.mock("../../gateway/billing/usage-outbox-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../gateway/billing/usage-outbox-store.js")>()),
  enqueueUsageOutbox,
}));
vi.mock("../../gateway/governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendMock,
}));

const { SUBAGENT_CREDIT_USAGE_ENV, isSubagentCreditUsageEnabled, recordSubagentRunUsage } =
  await import("./subagent-credit-usage.js");

const ON = { [SUBAGENT_CREDIT_USAGE_ENV]: "1" };

const parentSnapshot: RunGovernanceSnapshot = {
  snapshotId: "gd-parent-snapshot",
  runId: "parent-run",
  parentRunId: "parent-run",
  governanceMode: "shadow",
  decisions: [],
  effectiveModelSet: { allowlist: ["openai/gpt-5.2"] },
  commercialAuthorizationId: "auth-parent-1",
  creditReporting: {
    enterpriseId: "tenant-a",
    policyId: "policy-1",
    subscriptionId: "sub-1",
    subscriptionSnapshotId: "sub-snap-1",
    planId: "plan-1",
    planVersionId: "pv-1",
  },
  createdAt: "2026-09-28T00:00:00.000Z",
};

function params(overrides: Partial<Parameters<typeof recordSubagentRunUsage>[0]> = {}) {
  return {
    isSubagentLane: true,
    cfg: {} as OpenBotConfig,
    runId: "child-run-1",
    provider: "openai",
    model: "gpt-5.2",
    agentId: "main",
    creditUserId: "alice@example.com",
    snapshot: parentSnapshot,
    result: { meta: { durationMs: 42, agentMeta: { usage: { input: 10, output: 5 } } } },
    fallbackAttempts: [],
    env: {},
    ...overrides,
  };
}

function shadowReasons(): (string | undefined)[] {
  return appendMock.mock.calls.map(([decision]) => (decision as GovernanceDecision).reason);
}

describe("subagent credit usage (P4-1)", () => {
  beforeEach(() => {
    enqueueUsageOutbox.mockReset();
    enqueueUsageOutbox.mockImplementation(async (payload: { taskId: string }) => ({
      id: payload.taskId,
      payload,
    }));
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
  });

  it("the switch is off unless the process env says 1 / true / yes / on", () => {
    for (const value of [undefined, "", " ", "0", "false", "off", "no", "enabled", "2"]) {
      expect(isSubagentCreditUsageEnabled({ [SUBAGENT_CREDIT_USAGE_ENV]: value }), value).toBe(
        false,
      );
    }
    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      expect(isSubagentCreditUsageEnabled({ [SUBAGENT_CREDIT_USAGE_ENV]: value }), value).toBe(
        true,
      );
    }
    // Independent of the agent command switch, which defaults on.
    expect(isSubagentCreditUsageEnabled({ OPENBOT_AGENT_COMMAND_CREDIT_USAGE: "1" })).toBe(false);
  });

  it("switch off: the P4-0 shadow only, outbox not called", async () => {
    const outcome = await recordSubagentRunUsage(params());
    expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    expect(shadowReasons()).toEqual(["subagent-usage-not-billed"]);
  });

  it("switch on + full context: one usage record for the child run against the parent id", async () => {
    const outcome = await recordSubagentRunUsage(params({ env: ON }));
    expect(outcome).toEqual({ status: "recorded", taskId: "child-run-1" });
    expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "tenant-a",
      policyId: "policy-1",
      taskId: "child-run-1",
      runId: "child-run-1",
      modelId: "openai/gpt-5.2",
      userId: "alice@example.com",
      agentId: "main",
      authorizationDecisionId: "auth-parent-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "sub-snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      durationMs: 42,
      toolCallCount: 0,
      toolClasses: [],
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });
    // Billed: no "not billed" envelope.
    expect(appendMock).not.toHaveBeenCalled();
  });

  it.each([
    ["policyId", { enterpriseId: "tenant-a" }],
    ["enterpriseId", { policyId: "policy-1" }],
    ["the whole creditReporting", undefined],
  ])("switch on without %s: no outbox, subagent-billing-context-absent", async (_label, cr) => {
    const outcome = await recordSubagentRunUsage(
      params({ env: ON, snapshot: { ...parentSnapshot, creditReporting: cr } }),
    );
    expect(outcome).toEqual({ status: "skipped", reason: "billing-context-absent" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    expect(shadowReasons()).toEqual(["subagent-billing-context-absent"]);
  });

  it("switch on without a parent authorization id: missing-parent-authorization", async () => {
    const outcome = await recordSubagentRunUsage(
      params({ env: ON, snapshot: { ...parentSnapshot, commercialAuthorizationId: undefined } }),
    );
    expect(outcome).toEqual({ status: "skipped", reason: "missing-parent-authorization" });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    expect(shadowReasons()).toEqual(["missing-parent-authorization"]);
  });

  it.each([
    ["a CLI backend", { provider: "claude-cli", model: "opus" }, "cli-backend"],
    [
      "zero usage",
      { result: { meta: { durationMs: 1, agentMeta: { usage: { input: 0 } } } } },
      "no-usage",
    ],
    ["not the subagent lane", { isSubagentLane: false }, "not-subagent-lane"],
  ])("switch on with %s: nothing is billed or shadowed", async (_label, extra, reason) => {
    const outcome = await recordSubagentRunUsage(params({ env: ON, ...extra }));
    expect(outcome).toEqual({ status: "skipped", reason });
    expect(enqueueUsageOutbox).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("omits the user when this call has no trusted gateway user", async () => {
    await recordSubagentRunUsage(params({ env: ON, creditUserId: "  " }));
    expect(enqueueUsageOutbox).toHaveBeenCalledTimes(1);
    expect(enqueueUsageOutbox.mock.calls[0]?.[0]?.userId).toBeUndefined();
  });

  it("an enqueue failure is reported, never thrown, and writes no not-billed envelope", async () => {
    enqueueUsageOutbox.mockRejectedValueOnce(new Error("disk full"));
    const onError = vi.fn();
    const outcome = await recordSubagentRunUsage(params({ env: ON, onError }));
    expect(outcome).toMatchObject({ status: "failed", taskId: "child-run-1" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("the same child run id is charged once: the outbox is idempotent on taskId", async () => {
    const store = await vi.importActual<
      typeof import("../../gateway/billing/usage-outbox-store.js")
    >("../../gateway/billing/usage-outbox-store.js");
    const storePath = store.resolveDefaultUsageOutboxStorePath();
    await fs.rm(storePath, { force: true });
    enqueueUsageOutbox.mockImplementation(store.enqueueUsageOutbox);
    try {
      const first = await recordSubagentRunUsage(params({ env: ON }));
      const second = await recordSubagentRunUsage(params({ env: ON }));
      expect(first).toEqual({ status: "recorded", taskId: "child-run-1" });
      expect(second).toEqual({ status: "recorded", taskId: "child-run-1" });
      const saved = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        byId: Record<string, { taskId: string }>;
      };
      expect(Object.values(saved.byId).filter((r) => r.taskId === "child-run-1")).toHaveLength(1);
    } finally {
      await fs.rm(storePath, { force: true });
    }
  });
});
