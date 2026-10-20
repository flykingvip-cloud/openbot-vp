// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C1)
// 过闸口的 LLM 候选生产编排：skipped 不调模型；denied 不调模型；acquired 调模型 +
// 按用户报用量 + 释放槽；非法输出仍报用量（已耗 token）；runModel 抛错仍释放槽。

import { describe, expect, it, vi } from "vitest";
import type {
  CandidateValidation,
  ScheduleEntryCandidate,
} from "../../organization/lifecycle-candidates.ts";
import { validateScheduleEntryCandidate } from "../../organization/lifecycle-candidates.ts";
import {
  type GatedCandidateRunParams,
  type GatedModelOutput,
  runGatedCandidateRun,
} from "./gated-candidate-run.ts";

// The producer statically imports the real commercial gate (agent-run-governance ->
// model-entitlement -> @openbot/aor-core) only for its default dep values. Every test
// injects acquire/release/reportUsage, so mock those modules to keep this unit test
// free of the heavy gate chain (same pattern as commands/agent/commercial-run-gate.test).
vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
}));
vi.mock("../billing/report-usage-event.js", () => ({
  reportUsageEvent: vi.fn(),
}));

function parseScheduleEntry(raw: string): CandidateValidation<ScheduleEntryCandidate> {
  try {
    return validateScheduleEntryCandidate(JSON.parse(raw));
  } catch {
    return { ok: false, errors: ["invalid json"] };
  }
}

function baseParams(
  overrides: Partial<GatedCandidateRunParams<ScheduleEntryCandidate>> = {},
): GatedCandidateRunParams<ScheduleEntryCandidate> {
  return {
    runId: "run-1",
    userId: "user-1",
    enterpriseId: "ent-1",
    prompt: "draft a schedule entry",
    parse: parseScheduleEntry,
    ...overrides,
  };
}

describe("runGatedCandidateRun", () => {
  it("skipped（非企业）→ 不调用模型、不报用量、不释放槽", async () => {
    const acquire = vi.fn().mockResolvedValue({ acquired: false, skipped: true });
    const release = vi.fn().mockResolvedValue(undefined);
    const runModel = vi.fn();
    const reportUsage = vi.fn();
    const res = await runGatedCandidateRun(baseParams(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });
    expect(res).toEqual({ status: "skipped" });
    expect(runModel).not.toHaveBeenCalled();
    expect(reportUsage).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("denied（预算/额度拒）→ 不调用模型", async () => {
    const acquire = vi.fn().mockResolvedValue({
      acquired: false,
      skipped: false,
      reason: "BUDGET_EXCEEDED",
      message: "over budget",
    });
    const runModel = vi.fn();
    const reportUsage = vi.fn();
    const release = vi.fn();
    const res = await runGatedCandidateRun(baseParams(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });
    expect(res).toEqual({ status: "denied", reason: "BUDGET_EXCEEDED", message: "over budget" });
    expect(runModel).not.toHaveBeenCalled();
    expect(reportUsage).not.toHaveBeenCalled();
  });

  it("acquired + 合法输出 → produced，按用户报用量，释放槽", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-9" });
    const validJson = JSON.stringify({ title: "Sync", startAt: "2026-07-01T09:00:00.000Z" });
    const runModel = vi
      .fn()
      .mockResolvedValue({ text: validJson, usageQuantity: 123 } satisfies GatedModelOutput);
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const res = await runGatedCandidateRun(baseParams(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });
    expect(res.status).toBe("produced");
    if (res.status === "produced") {
      expect(res.candidate.title).toBe("Sync");
      expect(res.enterpriseId).toBe("ent-9");
      expect(res.usageQuantity).toBe(123);
    }
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "ent-9",
      userId: "user-1",
      key: "ai_token",
      quantity: 123,
      eventId: "run-1:ai_token",
      agentId: "main",
    });
    expect(release).toHaveBeenCalledWith("run-1");
  });

  it("acquired + 非法输出 → invalid，仍报用量（已耗 token），释放槽", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const runModel = vi.fn().mockResolvedValue({ text: "{not json", usageQuantity: 50 });
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const res = await runGatedCandidateRun(baseParams(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });
    expect(res.status).toBe("invalid");
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("run-1");
  });

  it("runModel 抛错 → failed，不报用量，仍释放槽（finally）", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const runModel = vi.fn().mockRejectedValue(new Error("model boom"));
    const reportUsage = vi.fn();
    const release = vi.fn().mockResolvedValue(undefined);
    const res = await runGatedCandidateRun(baseParams(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });
    expect(res).toMatchObject({ status: "failed", message: "model boom", enterpriseId: "ent-1" });
    expect(reportUsage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith("run-1");
  });

  it("默认 agentId=main，enterpriseId 透传给闸口", async () => {
    const acquire = vi.fn().mockResolvedValue({ acquired: false, skipped: true });
    const runModel = vi.fn();
    await runGatedCandidateRun(baseParams(), { acquire, release: vi.fn(), runModel });
    expect(acquire.mock.calls[0]?.[0]).toMatchObject({
      runId: "run-1",
      agentId: "main",
      enterpriseId: "ent-1",
    });
  });
});
