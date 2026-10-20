// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C, C0)
// 候选域确定性校验：LLM 输出经此边界 -> 类型化候选或报错，权威字段服务端盖章。

import { describe, expect, it } from "vitest";
import {
  scheduleEntryCandidateToConfirmedInput,
  validateInviteDraft,
  validateMinutesDraft,
  validateScheduleEntryCandidate,
  validateTaskCandidate,
} from "./lifecycle-candidates.ts";

describe("validateScheduleEntryCandidate", () => {
  it("接受合法输入并归一化 ISO 时间", () => {
    const result = validateScheduleEntryCandidate({
      title: "  Sync with team  ",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-01T10:00:00.000Z",
      timezone: "Asia/Shanghai",
      sourceText: "let's sync tomorrow 9am",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Sync with team");
      expect(result.value.startAt).toBe("2026-07-01T09:00:00.000Z");
      expect(result.value.endAt).toBe("2026-07-01T10:00:00.000Z");
      expect(result.value.timezone).toBe("Asia/Shanghai");
    }
  });

  it("剥离 LLM 注入的权威字段（id/ownerUserId/status）", () => {
    const result = validateScheduleEntryCandidate({
      title: "Standup",
      startAt: "2026-07-01T09:00:00.000Z",
      id: "evil-id",
      ownerUserId: "victim-user",
      status: "confirmed",
      sourceRef: { kind: "manual", id: "x" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const keys = Object.keys(result.value).toSorted();
      expect(keys).toEqual(["kind", "startAt", "title"]);
      expect(result.value).not.toHaveProperty("ownerUserId");
      expect(result.value).not.toHaveProperty("id");
      expect(result.value).not.toHaveProperty("status");
    }
  });

  it("缺 title / 非法 startAt / endAt 早于 startAt 均被拒", () => {
    expect(validateScheduleEntryCandidate({ startAt: "2026-07-01T09:00:00Z" }).ok).toBe(false);
    expect(validateScheduleEntryCandidate({ title: "x", startAt: "not-a-date" }).ok).toBe(false);
    const bad = validateScheduleEntryCandidate({
      title: "x",
      startAt: "2026-07-01T10:00:00Z",
      endAt: "2026-07-01T09:00:00Z",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toContain("endAt must not be before startAt");
    }
  });

  it("非对象输入被拒", () => {
    expect(validateScheduleEntryCandidate(null).ok).toBe(false);
    expect(validateScheduleEntryCandidate("string").ok).toBe(false);
    expect(validateScheduleEntryCandidate([]).ok).toBe(false);
  });
});

describe("validateTaskCandidate", () => {
  it("接受合法输入（含可选 assignee/dueAt）", () => {
    const result = validateTaskCandidate({
      title: "Write spec",
      assigneeUserId: "user-b",
      dueAt: "2026-07-05T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assigneeUserId).toBe("user-b");
      expect(result.value.dueAt).toBe("2026-07-05T00:00:00.000Z");
    }
  });

  it("缺 title 被拒；非法 dueAt 被拒", () => {
    expect(validateTaskCandidate({ assigneeUserId: "u" }).ok).toBe(false);
    expect(validateTaskCandidate({ title: "x", dueAt: "nope" }).ok).toBe(false);
  });
});

describe("validateInviteDraft", () => {
  it("接受合法草稿，去重 attendee 并丢空", () => {
    const result = validateInviteDraft({
      subject: "Kickoff",
      body: "Please join.",
      attendeeUserIds: ["a", "a", " ", "b", ""],
      proposedStartAt: "2026-07-02T09:00:00.000Z",
      proposedEndAt: "2026-07-02T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.attendeeUserIds).toEqual(["a", "b"]);
    }
  });

  it("缺 subject / body 被拒", () => {
    expect(validateInviteDraft({ body: "x" }).ok).toBe(false);
    expect(validateInviteDraft({ subject: "x" }).ok).toBe(false);
  });
});

describe("validateMinutesDraft", () => {
  it("接受合法纪要并逐条复校 actionItems", () => {
    const result = validateMinutesDraft({
      summary: "We agreed on the plan.",
      decisions: ["ship v1", "", "freeze scope"],
      actionItems: [
        { title: "draft doc", assigneeUserId: "a" },
        { title: "review", dueAt: "2026-07-10T00:00:00.000Z" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decisions).toEqual(["ship v1", "freeze scope"]);
      expect(result.value.actionItems).toHaveLength(2);
      expect(result.value.actionItems[0]?.kind).toBe("task");
    }
  });

  it("非法 actionItem 带索引报错；非数组 actionItems 被拒", () => {
    const bad = validateMinutesDraft({
      summary: "s",
      actionItems: [{ title: "ok" }, { assigneeUserId: "no-title" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.startsWith("actionItems[1]"))).toBe(true);
    }
    expect(validateMinutesDraft({ summary: "s", actionItems: "x" }).ok).toBe(false);
  });
});

describe("scheduleEntryCandidateToConfirmedInput", () => {
  it("盖章 ownerUserId/tenantId 并转 ms（忽略候选侧任何 owner）", () => {
    const validated = validateScheduleEntryCandidate({
      title: "Sync",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-01T10:00:00.000Z",
      timezone: "UTC",
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const input = scheduleEntryCandidateToConfirmedInput(validated.value, {
      ownerUserId: "actor-1",
      tenantId: "tenant-1",
    });
    expect(input.ownerUserId).toBe("actor-1");
    expect(input.tenantId).toBe("tenant-1");
    expect(input.startAtMs).toBe(Date.parse("2026-07-01T09:00:00.000Z"));
    expect(input.endAtMs).toBe(Date.parse("2026-07-01T10:00:00.000Z"));
    expect(input.timezone).toBe("UTC");
  });
});
