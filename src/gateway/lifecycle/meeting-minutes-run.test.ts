// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C3)
// 会议纪要生成（minutes-specific gated producer）：连接 C0(校验 MinutesDraft) + C1(过闸口产候选)。
// 模型 runner 注入 → 不触碰重型模型链；断言 produced/invalid/skipped 与提示词构造。

import { describe, expect, it, vi } from "vitest";
import { buildMeetingMinutesPrompt, generateMeetingMinutes } from "./meeting-minutes-run.ts";

// gated-candidate-run statically imports the real commercial gate (heavy chain);
// minutes-run delegates to it. Mock the gate + emit modules so this stays a unit
// test with everything injected (same pattern as gated-candidate-run.test).
vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
}));
vi.mock("../billing/report-usage-event.js", () => ({
  reportUsageEvent: vi.fn(),
}));

function baseInput() {
  return {
    runId: "minutes-run-1",
    organizerUserId: "user-1",
    enterpriseId: "ent-1",
    meetingTitle: "Q3 Planning",
    transcript: "We agreed to ship v1 by July. Alice will draft the spec.",
    attendeeUserIds: ["user-1", "user-2"],
  };
}

describe("buildMeetingMinutesPrompt", () => {
  it("includes title, attendees, transcript, and the strict-JSON instruction", () => {
    const prompt = buildMeetingMinutesPrompt({
      meetingTitle: "Q3 Planning",
      transcript: "ship v1 by July",
      attendeeUserIds: ["user-1", "user-2"],
    });
    expect(prompt).toContain("Q3 Planning");
    expect(prompt).toContain("user-1, user-2");
    expect(prompt).toContain("ship v1 by July");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"actionItems"');
  });

  it("renders unspecified attendees when none are given", () => {
    const prompt = buildMeetingMinutesPrompt({ meetingTitle: "Sync", transcript: "x" });
    expect(prompt).toContain("Attendees: (unspecified)");
  });
});

describe("generateMeetingMinutes", () => {
  it("produces a validated MinutesDraft from a valid model response", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const release = vi.fn().mockResolvedValue(undefined);
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const minutesJson = JSON.stringify({
      summary: "Agreed to ship v1 in July.",
      decisions: ["ship v1 in July"],
      actionItems: [{ title: "draft the spec", assigneeUserId: "user-2" }],
    });
    const runModel = vi.fn().mockResolvedValue({ text: minutesJson, usageQuantity: 420 });

    const res = await generateMeetingMinutes(baseInput(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });

    expect(res.status).toBe("produced");
    if (res.status === "produced") {
      expect(res.candidate.kind).toBe("minutes_draft");
      expect(res.candidate.summary).toBe("Agreed to ship v1 in July.");
      expect(res.candidate.actionItems).toHaveLength(1);
      expect(res.candidate.actionItems[0]?.assigneeUserId).toBe("user-2");
    }
    // The prompt the model received carries the meeting context + JSON contract.
    expect(runModel.mock.calls[0]?.[0]?.prompt).toContain("Q3 Planning");
    // Usage attributed to the organizer.
    expect(reportUsage.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      quantity: 420,
      key: "ai_token",
    });
    expect(release).toHaveBeenCalledWith("minutes-run-1");
  });

  it("returns invalid when the model output is not valid MinutesDraft JSON", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const release = vi.fn().mockResolvedValue(undefined);
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const runModel = vi.fn().mockResolvedValue({ text: "not json at all", usageQuantity: 10 });

    const res = await generateMeetingMinutes(baseInput(), {
      acquire,
      release,
      runModel,
      reportUsage,
    });

    expect(res.status).toBe("invalid");
    // Usage is still reported (the model consumed tokens) and the slot released.
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("minutes-run-1");
  });

  it("skips the model for a non-enterprise actor (decision B)", async () => {
    const acquire = vi.fn().mockResolvedValue({ acquired: false, skipped: true });
    const runModel = vi.fn();
    const reportUsage = vi.fn();

    const res = await generateMeetingMinutes(baseInput(), {
      acquire,
      release: vi.fn(),
      runModel,
      reportUsage,
    });

    expect(res).toEqual({ status: "skipped" });
    expect(runModel).not.toHaveBeenCalled();
    expect(reportUsage).not.toHaveBeenCalled();
  });
});
