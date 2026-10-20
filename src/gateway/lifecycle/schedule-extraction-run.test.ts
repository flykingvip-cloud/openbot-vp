// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C, scenario 2 extraction)
// 群对话提取生产者：连接 C0(逐条校验 ScheduleEntryCandidate) + C1(过闸口产候选)；runner 注入。

import { describe, expect, it, vi } from "vitest";
import {
  buildScheduleExtractionPrompt,
  extractScheduleCandidates,
} from "./schedule-extraction-run.ts";

vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
}));
vi.mock("../billing/report-usage-event.js", () => ({
  reportUsageEvent: vi.fn(),
}));

function baseInput() {
  return {
    runId: "extract-run-1",
    userId: "user-1",
    enterpriseId: "ent-1",
    conversationText: "Let's demo Friday 3pm and ship Monday.",
    sourceLabel: "Platform space",
  };
}

describe("buildScheduleExtractionPrompt", () => {
  it("includes the source, conversation, and the JSON-array instruction", () => {
    const prompt = buildScheduleExtractionPrompt({
      conversationText: "demo Friday",
      sourceLabel: "Platform space",
    });
    expect(prompt).toContain("Platform space");
    expect(prompt).toContain("demo Friday");
    expect(prompt).toContain('"startAt"');
    expect(prompt).toContain("JSON array");
  });
});

describe("extractScheduleCandidates", () => {
  it("produces only the valid candidates from a mixed array (drops invalid items)", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const release = vi.fn().mockResolvedValue(undefined);
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const arrayJson = JSON.stringify([
      { title: "Demo", startAt: "2026-07-03T15:00:00.000Z" },
      { title: "", startAt: "2026-07-06T09:00:00.000Z" }, // invalid: empty title
      { title: "Ship", startAt: "not-a-date" }, // invalid: bad date
    ]);
    const runModel = vi.fn().mockResolvedValue({ text: arrayJson, usageQuantity: 64 });

    const res = await extractScheduleCandidates(baseInput(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });

    expect(res.status).toBe("produced");
    if (res.status === "produced") {
      expect(res.candidate).toHaveLength(1);
      expect(res.candidate[0]?.title).toBe("Demo");
    }
    expect(reportUsage.mock.calls[0]?.[0]).toMatchObject({ userId: "user-1", quantity: 64 });
    expect(release).toHaveBeenCalledWith("extract-run-1");
  });

  it("produces an empty list when the model returns []", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const runModel = vi.fn().mockResolvedValue({ text: "[]", usageQuantity: 3 });
    const res = await extractScheduleCandidates(baseInput(), {
      acquire,
      release: vi.fn().mockResolvedValue(undefined),
      runModel,
      reportUsage: vi.fn().mockResolvedValue(undefined),
    });
    expect(res.status).toBe("produced");
    if (res.status === "produced") {
      expect(res.candidate).toEqual([]);
    }
  });

  it("returns invalid when the model output is not a JSON array", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const runModel = vi.fn().mockResolvedValue({ text: '{"not":"array"}', usageQuantity: 2 });
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const res = await extractScheduleCandidates(baseInput(), {
      acquire,
      release: vi.fn().mockResolvedValue(undefined),
      runModel,
      reportUsage,
    });
    expect(res.status).toBe("invalid");
    expect(reportUsage).toHaveBeenCalledTimes(1);
  });

  it("skips the model for a non-enterprise actor (decision B)", async () => {
    const acquire = vi.fn().mockResolvedValue({ acquired: false, skipped: true });
    const runModel = vi.fn();
    const res = await extractScheduleCandidates(baseInput(), {
      acquire,
      release: vi.fn(),
      runModel,
      reportUsage: vi.fn(),
    });
    expect(res).toEqual({ status: "skipped" });
    expect(runModel).not.toHaveBeenCalled();
  });
});
