import { describe, expect, it } from "vitest";
import {
  isValidActionForLevel,
  availableActionsForLevel,
  actionLabel,
  createGovernanceActionExecutor,
  removeFromQueue,
  addToIgnored,
  filterIgnored,
} from "../governance-actions.ts";
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
    suggestedAction: "暂停",
    detectedAt: "2026-05-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("isValidActionForLevel", () => {
  it("allows pause/throttle/offline for critical", () => {
    expect(isValidActionForLevel("pause", "critical")).toBe(true);
    expect(isValidActionForLevel("throttle", "critical")).toBe(true);
    expect(isValidActionForLevel("offline", "critical")).toBe(true);
  });

  it("disallows archive for critical", () => {
    expect(isValidActionForLevel("archive", "critical")).toBe(false);
  });

  it("allows downgrade_model/set_budget_cap/mark_known for warning", () => {
    expect(isValidActionForLevel("downgrade_model", "warning")).toBe(true);
    expect(isValidActionForLevel("set_budget_cap", "warning")).toBe(true);
    expect(isValidActionForLevel("mark_known", "warning")).toBe(true);
  });

  it("allows archive/merge/ignore for info", () => {
    expect(isValidActionForLevel("archive", "info")).toBe(true);
    expect(isValidActionForLevel("merge", "info")).toBe(true);
    expect(isValidActionForLevel("ignore", "info")).toBe(true);
  });
});

describe("availableActionsForLevel", () => {
  it("returns 3 actions for each level", () => {
    expect(availableActionsForLevel("critical")).toHaveLength(3);
    expect(availableActionsForLevel("warning")).toHaveLength(3);
    expect(availableActionsForLevel("info")).toHaveLength(3);
  });
});

describe("actionLabel", () => {
  it("returns Chinese labels for all action types", () => {
    expect(actionLabel("pause")).toBe("暂停");
    expect(actionLabel("throttle")).toBe("限流");
    expect(actionLabel("offline")).toBe("下线");
    expect(actionLabel("downgrade_model")).toBe("降级模型");
    expect(actionLabel("set_budget_cap")).toBe("设置预算上限");
    expect(actionLabel("mark_known")).toBe("标记为已知问题");
    expect(actionLabel("archive")).toBe("归档");
    expect(actionLabel("merge")).toBe("合并");
    expect(actionLabel("ignore")).toBe("忽略");
  });
});

describe("createGovernanceActionExecutor", () => {
  it("executes action and records audit log on success", async () => {
    const executor = createGovernanceActionExecutor(async () => ({ ok: true }));

    const result = await executor.execute({
      issueId: "consecutive_errors:agent:agent-1",
      actionType: "pause",
      targetId: "agent-1",
      targetKind: "agent",
      operatorUserId: "admin-1",
      operatorPositionId: "pos-admin",
      reason: "连续错误过多",
    });

    expect(result).toEqual({ ok: true, removedIssueId: "consecutive_errors:agent:agent-1" });

    const log = executor.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].issueId).toBe("consecutive_errors:agent:agent-1");
    expect(log[0].actionType).toBe("pause");
    expect(log[0].operatorUserId).toBe("admin-1");
    expect(log[0].reason).toBe("连续错误过多");
    expect(log[0].executedAt).toBeTruthy();
  });

  it("returns error and does NOT record audit log on failure", async () => {
    const executor = createGovernanceActionExecutor(async () => ({
      ok: false,
      error: "机器人已被其他管理员处理",
    }));

    const result = await executor.execute({
      issueId: "consecutive_errors:agent:agent-1",
      actionType: "pause",
      targetId: "agent-1",
      targetKind: "agent",
      operatorUserId: "admin-1",
      operatorPositionId: "pos-admin",
    });

    expect(result).toEqual({ ok: false, error: "机器人已被其他管理员处理" });
    expect(executor.getAuditLog()).toHaveLength(0);
  });
});

describe("removeFromQueue", () => {
  it("removes the item with matching id", () => {
    const queue = [makeIssue(), makeIssue({ id: "other:agent:agent-2" })];
    const result = removeFromQueue(queue, "consecutive_errors:agent:agent-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other:agent:agent-2");
  });

  it("returns same array when id not found", () => {
    const queue = [makeIssue()];
    const result = removeFromQueue(queue, "nonexistent");
    expect(result).toHaveLength(1);
  });

  it("does not mutate original array", () => {
    const queue = [makeIssue()];
    removeFromQueue(queue, "consecutive_errors:agent:agent-1");
    expect(queue).toHaveLength(1);
  });
});

describe("addToIgnored / filterIgnored", () => {
  it("adds issue to ignored set", () => {
    const set = new Set<string>();
    const next = addToIgnored(set, "issue-1");
    expect(next.has("issue-1")).toBe(true);
    expect(set.has("issue-1")).toBe(false); // original not mutated
  });

  it("filters ignored issues from queue", () => {
    const queue = [makeIssue(), makeIssue({ id: "other:agent:agent-2" })];
    const ignored = new Set(["consecutive_errors:agent:agent-1"]);
    const result = filterIgnored(queue, ignored);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other:agent:agent-2");
  });
});
