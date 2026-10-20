// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C, invite draft)
// 邀请草拟生产者：连接 C0(校验 InviteDraft) + C1(过闸口产候选)；runner 注入。

import { describe, expect, it, vi } from "vitest";
import { buildInviteDraftPrompt, generateInviteDraft } from "./invite-draft-run.ts";

vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
}));
vi.mock("../billing/report-usage-event.js", () => ({
  reportUsageEvent: vi.fn(),
}));

function baseInput() {
  return {
    runId: "invite-run-1",
    organizerUserId: "user-1",
    enterpriseId: "ent-1",
    meetingTitle: "Q3 Kickoff",
    context: "Plan the Q3 roadmap with the platform team.",
    attendeeUserIds: ["user-1", "user-2"],
  };
}

describe("buildInviteDraftPrompt", () => {
  it("includes title, attendees, context, and the strict-JSON instruction", () => {
    const prompt = buildInviteDraftPrompt({
      meetingTitle: "Q3 Kickoff",
      context: "roadmap",
      attendeeUserIds: ["user-1", "user-2"],
    });
    expect(prompt).toContain("Q3 Kickoff");
    expect(prompt).toContain("user-1, user-2");
    expect(prompt).toContain("roadmap");
    expect(prompt).toContain('"subject"');
    expect(prompt).toContain('"attendeeUserIds"');
  });
});

describe("generateInviteDraft", () => {
  it("produces a validated InviteDraft from a valid model response", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const release = vi.fn().mockResolvedValue(undefined);
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const draftJson = JSON.stringify({
      subject: "Q3 Kickoff",
      body: "Please join to plan Q3.",
      attendeeUserIds: ["user-1", "user-2"],
    });
    const runModel = vi.fn().mockResolvedValue({ text: draftJson, usageQuantity: 88 });

    const res = await generateInviteDraft(baseInput(), { acquire, release, runModel, reportUsage });

    expect(res.status).toBe("produced");
    if (res.status === "produced") {
      expect(res.candidate.kind).toBe("invite_draft");
      expect(res.candidate.subject).toBe("Q3 Kickoff");
      expect(res.candidate.attendeeUserIds).toEqual(["user-1", "user-2"]);
    }
    expect(reportUsage.mock.calls[0]?.[0]).toMatchObject({ userId: "user-1", quantity: 88 });
    expect(release).toHaveBeenCalledWith("invite-run-1");
  });

  it("returns invalid when the model omits required fields", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ acquired: true, skipped: false, enterpriseId: "ent-1" });
    const runModel = vi.fn().mockResolvedValue({
      text: JSON.stringify({ body: "no subject" }),
      usageQuantity: 5,
    });
    const reportUsage = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);

    const res = await generateInviteDraft(baseInput(), { acquire, release, runModel, reportUsage });

    expect(res.status).toBe("invalid");
    expect(reportUsage).toHaveBeenCalledTimes(1); // tokens consumed
    expect(release).toHaveBeenCalledWith("invite-run-1");
  });

  it("skips the model for a non-enterprise actor (decision B)", async () => {
    const acquire = vi.fn().mockResolvedValue({ acquired: false, skipped: true });
    const runModel = vi.fn();
    const reportUsage = vi.fn();

    const res = await generateInviteDraft(baseInput(), {
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
