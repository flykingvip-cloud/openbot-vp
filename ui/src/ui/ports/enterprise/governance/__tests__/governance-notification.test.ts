import { describe, expect, it } from "vitest";
import {
  buildCriticalNotification,
  buildEscalationNotification,
  shouldEscalate,
  hoursUnhandled,
} from "../governance-notification.ts";
import type { GovernanceItem, MeshOwnership } from "../types.ts";

const baseOwnership: MeshOwnership = {
  positionId: "pos-eng",
  positionLabel: "Engineering",
  createdByUserId: "creator-1",
  createdByUserLabel: "Creator",
  currentManagerUserId: "manager-1",
  currentManagerLabel: "Manager",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function makeIssue(overrides: Partial<GovernanceItem> = {}): GovernanceItem {
  return {
    id: "consecutive_errors:agent:agent-1",
    level: "critical",
    category: "consecutive_errors",
    target: {
      kind: "agent",
      id: "agent-1",
      name: "Test Bot",
      ownership: baseOwnership,
    },
    title: "Test Bot 连续错误 5 次",
    evidence: { consecutiveErrors: 5 },
    suggestedAction: "建议暂停机器人并排查错误原因",
    detectedAt: "2026-05-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildCriticalNotification", () => {
  it("builds notification targeting the current manager", () => {
    const issue = makeIssue();
    const notification = buildCriticalNotification(issue, "/enterprise/acme/mesh/overview");

    expect(notification.recipientUserId).toBe("manager-1");
    expect(notification.recipientPositionId).toBe("pos-eng");
    expect(notification.issueId).toBe("consecutive_errors:agent:agent-1");
    expect(notification.title).toContain("紧急");
    expect(notification.title).toContain("Test Bot");
    expect(notification.targetName).toBe("Test Bot");
    expect(notification.suggestedAction).toContain("暂停");
    expect(notification.directLink).toBe("/enterprise/acme/mesh/overview");
    expect(notification.isEscalation).toBe(false);
  });
});

describe("buildEscalationNotification", () => {
  it("builds escalation notification targeting the superior", () => {
    const issue = makeIssue();
    const notification = buildEscalationNotification(
      issue,
      { userId: "superior-1", positionId: "pos-director" },
      5,
      "/enterprise/acme/mesh/overview",
    );

    expect(notification.recipientUserId).toBe("superior-1");
    expect(notification.recipientPositionId).toBe("pos-director");
    expect(notification.title).toContain("升级");
    expect(notification.title).toContain("5 小时");
    expect(notification.isEscalation).toBe(true);
  });
});

describe("shouldEscalate", () => {
  const detectedAt = "2026-05-17T12:00:00.000Z";
  const detectedMs = new Date(detectedAt).getTime();

  it("returns true when critical issue is unhandled for >= 4 hours", () => {
    const issue = makeIssue({ detectedAt });
    const now = detectedMs + 4 * 60 * 60 * 1000; // exactly 4 hours later
    expect(shouldEscalate(issue, now)).toBe(true);
  });

  it("returns false when critical issue is unhandled for < 4 hours", () => {
    const issue = makeIssue({ detectedAt });
    const now = detectedMs + 3.9 * 60 * 60 * 1000;
    expect(shouldEscalate(issue, now)).toBe(false);
  });

  it("returns false for non-critical issues regardless of time", () => {
    const issue = makeIssue({ level: "warning", detectedAt });
    const now = detectedMs + 24 * 60 * 60 * 1000;
    expect(shouldEscalate(issue, now)).toBe(false);
  });

  it("respects custom threshold", () => {
    const issue = makeIssue({ detectedAt });
    const now = detectedMs + 2 * 60 * 60 * 1000;
    expect(shouldEscalate(issue, now, 2)).toBe(true);
    expect(shouldEscalate(issue, now, 3)).toBe(false);
  });
});

describe("hoursUnhandled", () => {
  it("calculates hours since detection", () => {
    const detectedAt = "2026-05-17T12:00:00.000Z";
    const detectedMs = new Date(detectedAt).getTime();
    const issue = makeIssue({ detectedAt });

    expect(hoursUnhandled(issue, detectedMs + 5 * 60 * 60 * 1000)).toBe(5);
    expect(hoursUnhandled(issue, detectedMs + 0.5 * 60 * 60 * 1000)).toBe(0);
  });
});
