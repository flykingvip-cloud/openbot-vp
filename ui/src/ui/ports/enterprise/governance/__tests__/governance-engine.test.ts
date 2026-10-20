import { describe, expect, it } from "vitest";
import { detectGovernanceIssues } from "../governance-engine.ts";
import type { GovernanceAgentInput, GovernanceGroupInput } from "../governance-engine.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "../types.ts";
import type { GovernanceConfig, MeshOwnership } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z").getTime();

const baseOwnership: MeshOwnership = {
  positionId: "pos-eng",
  positionLabel: "Engineering",
  createdByUserId: "creator-1",
  createdByUserLabel: "Creator",
  currentManagerUserId: "manager-1",
  currentManagerLabel: "Manager",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function makeAgent(overrides: Partial<GovernanceAgentInput> = {}): GovernanceAgentInput {
  return {
    agentId: "agent-1",
    name: "Test Bot",
    ownership: baseOwnership,
    status: "online",
    consecutiveErrors: 0,
    offlineHours: 0,
    hasActiveSessions: false,
    errorRate7d: 0,
    successRate7d: 1,
    previousSuccessRate7d: 1,
    dailyCost: 0,
    avgDailyCost7d: 0,
    monthlyCost: 0,
    budgetLimit: null,
    costPerSession: 0,
    peerAvgCostPerSession: 0,
    lastSessionAt: NOW - 1000 * 60 * 60, // 1 hour ago
    deployedAt: NOW - 1000 * 60 * 60 * 24 * 60, // 60 days ago
    sessionCount7d: 10,
    hasSensitiveContentViolation: false,
    hasPermissionViolation: false,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GovernanceGroupInput> = {}): GovernanceGroupInput {
  return {
    groupId: "group-1",
    name: "Test Group",
    ownership: baseOwnership,
    members: [],
    errorRate7d: 0,
    monthlyCost: 0,
    budgetLimit: null,
    lastSessionAt: NOW - 1000 * 60 * 60, // 1 hour ago
    sessionCount30d: 10,
    ...overrides,
  };
}

describe("detectGovernanceIssues", () => {
  describe("queue purity — no missing_owner or missing_attribution", () => {
    it("never produces missing_owner or missing_attribution categories", () => {
      const agents = [
        makeAgent({ consecutiveErrors: 10 }),
        makeAgent({ agentId: "agent-2", hasSensitiveContentViolation: true }),
      ];
      const groups = [makeGroup({ errorRate7d: 0.5 })];

      const issues = detectGovernanceIssues(agents, groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      for (const issue of issues) {
        expect(issue.category).not.toBe("missing_owner");
        expect(issue.category).not.toBe("missing_attribution");
      }
    });
  });

  describe("idempotency", () => {
    it("produces identical results on consecutive calls with same input", () => {
      const agents = [makeAgent({ consecutiveErrors: 10, dailyCost: 100, avgDailyCost7d: 10 })];
      const groups = [
        makeGroup({ sessionCount30d: 0, lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 45 }),
      ];

      const result1 = detectGovernanceIssues(agents, groups, DEFAULT_GOVERNANCE_CONFIG, NOW);
      const result2 = detectGovernanceIssues(agents, groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(result1).toEqual(result2);
    });
  });

  describe("ID stability", () => {
    it("generates deterministic IDs from category + kind + id", () => {
      const agents = [makeAgent({ consecutiveErrors: 10 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      const errorIssue = issues.find((i) => i.category === "consecutive_errors");
      expect(errorIssue?.id).toBe("consecutive_errors:agent:agent-1");
    });
  });

  describe("level ordering", () => {
    it("sorts Critical before Warning before Info", () => {
      const agents = [
        makeAgent({
          agentId: "critical-bot",
          consecutiveErrors: 10,
        }),
        makeAgent({
          agentId: "warning-bot",
          errorRate7d: 0.5,
          consecutiveErrors: 0,
        }),
        makeAgent({
          agentId: "info-bot",
          consecutiveErrors: 0,
          errorRate7d: 0,
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 45,
          sessionCount7d: 0,
        }),
      ];

      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      const levels = issues.map((i) => i.level);
      const criticalIdx = levels.indexOf("critical");
      const warningIdx = levels.indexOf("warning");
      const infoIdx = levels.indexOf("info");

      if (criticalIdx >= 0 && warningIdx >= 0) {
        expect(criticalIdx).toBeLessThan(warningIdx);
      }
      if (warningIdx >= 0 && infoIdx >= 0) {
        expect(warningIdx).toBeLessThan(infoIdx);
      }
    });
  });

  describe("Critical: consecutive_errors", () => {
    it("triggers when errors >= threshold", () => {
      const agents = [makeAgent({ consecutiveErrors: 5 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "consecutive_errors")).toBe(true);
    });

    it("does NOT trigger when errors < threshold", () => {
      const agents = [makeAgent({ consecutiveErrors: 4 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "consecutive_errors")).toBe(false);
    });

    it("does NOT trigger when errors exactly at threshold - 1", () => {
      const config: GovernanceConfig = {
        ...DEFAULT_GOVERNANCE_CONFIG,
        consecutiveErrorThreshold: 5,
      };
      const agents = [makeAgent({ consecutiveErrors: 4 })];
      const issues = detectGovernanceIssues(agents, [], config, NOW);

      expect(issues.some((i) => i.category === "consecutive_errors")).toBe(false);
    });
  });

  describe("Critical: offline_with_active_sessions", () => {
    it("triggers when offline >= threshold hours and has active sessions", () => {
      const agents = [makeAgent({ status: "offline", offlineHours: 24, hasActiveSessions: true })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "offline_with_active_sessions")).toBe(true);
    });

    it("does NOT trigger when offline but no active sessions", () => {
      const agents = [makeAgent({ status: "offline", offlineHours: 48, hasActiveSessions: false })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "offline_with_active_sessions")).toBe(false);
    });

    it("does NOT trigger when online", () => {
      const agents = [makeAgent({ status: "online", offlineHours: 0, hasActiveSessions: true })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "offline_with_active_sessions")).toBe(false);
    });
  });

  describe("Critical: cost_spike", () => {
    it("triggers when daily cost >= avg * multiplier", () => {
      const agents = [makeAgent({ dailyCost: 30, avgDailyCost7d: 10 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "cost_spike")).toBe(true);
    });

    it("does NOT trigger when daily cost < avg * multiplier", () => {
      const agents = [makeAgent({ dailyCost: 29, avgDailyCost7d: 10 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "cost_spike")).toBe(false);
    });

    it("does NOT trigger when avgDailyCost7d is 0", () => {
      const agents = [makeAgent({ dailyCost: 100, avgDailyCost7d: 0 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "cost_spike")).toBe(false);
    });
  });

  describe("Warning: budget_exceeded", () => {
    it("triggers when monthly cost >= budget limit", () => {
      const agents = [makeAgent({ monthlyCost: 100, budgetLimit: 100 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "budget_exceeded")).toBe(true);
    });

    it("does NOT trigger when budget limit is null", () => {
      const agents = [makeAgent({ monthlyCost: 1000, budgetLimit: null })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "budget_exceeded")).toBe(false);
    });
  });

  describe("Warning: high_error_rate", () => {
    it("triggers when error rate > threshold", () => {
      const agents = [makeAgent({ errorRate7d: 0.31 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "high_error_rate")).toBe(true);
    });

    it("does NOT trigger when error rate = threshold", () => {
      const agents = [makeAgent({ errorRate7d: 0.3 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "high_error_rate")).toBe(false);
    });
  });

  describe("Warning: quality_drop", () => {
    it("triggers when success rate drops >= qualityDropPoints", () => {
      const agents = [makeAgent({ successRate7d: 0.7, previousSuccessRate7d: 0.95 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "quality_drop")).toBe(true);
    });

    it("does NOT trigger when drop < qualityDropPoints", () => {
      const agents = [makeAgent({ successRate7d: 0.8, previousSuccessRate7d: 0.95 })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "quality_drop")).toBe(false);
    });
  });

  describe("Info: zombie_agent", () => {
    it("triggers when no session for >= zombieDays and deployed > 30 days", () => {
      const agents = [
        makeAgent({
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 35, // 35 days ago
          deployedAt: NOW - 1000 * 60 * 60 * 24 * 60, // 60 days ago
          sessionCount7d: 0,
        }),
      ];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "zombie_agent")).toBe(true);
    });

    it("does NOT trigger when last session < zombieDays ago", () => {
      const agents = [
        makeAgent({
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 25, // 25 days ago
          deployedAt: NOW - 1000 * 60 * 60 * 24 * 60,
        }),
      ];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "zombie_agent")).toBe(false);
    });

    it("does NOT trigger when deployed < 30 days", () => {
      const agents = [
        makeAgent({
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 35,
          deployedAt: NOW - 1000 * 60 * 60 * 24 * 20, // only 20 days ago
        }),
      ];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "zombie_agent")).toBe(false);
    });
  });

  describe("Group: zombie_group", () => {
    it("triggers when no session for >= groupZombieDays", () => {
      const groups = [
        makeGroup({
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 35,
          sessionCount30d: 0,
        }),
      ];
      const issues = detectGovernanceIssues([], groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "zombie_group")).toBe(true);
    });

    it("does NOT trigger when sessionCount30d > 0", () => {
      const groups = [
        makeGroup({
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 35,
          sessionCount30d: 1,
        }),
      ];
      const issues = detectGovernanceIssues([], groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "zombie_group")).toBe(false);
    });
  });

  describe("Group: redundant_members", () => {
    it("triggers when members share the same domain", () => {
      const groups = [
        makeGroup({
          members: [
            { agentId: "a1", name: "Bot A", domain: "coding", description: "Code assistant" },
            { agentId: "a2", name: "Bot B", domain: "coding", description: "Code helper" },
          ],
        }),
      ];
      const issues = detectGovernanceIssues([], groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "redundant_members")).toBe(true);
    });

    it("does NOT trigger when members have different domains", () => {
      const groups = [
        makeGroup({
          members: [
            { agentId: "a1", name: "Bot A", domain: "coding", description: "Code assistant" },
            { agentId: "a2", name: "Bot B", domain: "writing", description: "Writing helper" },
          ],
        }),
      ];
      const issues = detectGovernanceIssues([], groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "redundant_members")).toBe(false);
    });
  });

  describe("Group: group_budget_exceeded", () => {
    it("triggers when monthly cost >= budget limit", () => {
      const groups = [makeGroup({ monthlyCost: 200, budgetLimit: 150 })];
      const issues = detectGovernanceIssues([], groups, DEFAULT_GOVERNANCE_CONFIG, NOW);

      expect(issues.some((i) => i.category === "group_budget_exceeded")).toBe(true);
    });
  });

  describe("Security: sensitive_content", () => {
    it("triggers as Critical when sensitive content violation detected", () => {
      const agents = [makeAgent({ hasSensitiveContentViolation: true })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      const issue = issues.find((i) => i.category === "sensitive_content");
      expect(issue).toBeDefined();
      expect(issue?.level).toBe("critical");
    });
  });

  describe("Security: permission_violation", () => {
    it("triggers as Critical when permission violation detected", () => {
      const agents = [makeAgent({ hasPermissionViolation: true })];
      const issues = detectGovernanceIssues(agents, [], DEFAULT_GOVERNANCE_CONFIG, NOW);

      const issue = issues.find((i) => i.category === "permission_violation");
      expect(issue).toBeDefined();
      expect(issue?.level).toBe("critical");
    });
  });

  describe("custom config", () => {
    it("respects custom thresholds", () => {
      const config: GovernanceConfig = {
        ...DEFAULT_GOVERNANCE_CONFIG,
        consecutiveErrorThreshold: 3,
        zombieDays: 14,
      };

      const agents = [
        makeAgent({ consecutiveErrors: 3 }), // should trigger with threshold=3
        makeAgent({
          agentId: "agent-zombie",
          lastSessionAt: NOW - 1000 * 60 * 60 * 24 * 15, // 15 days
          deployedAt: NOW - 1000 * 60 * 60 * 24 * 60,
          consecutiveErrors: 0,
          sessionCount7d: 0,
        }),
      ];

      const issues = detectGovernanceIssues(agents, [], config, NOW);

      expect(issues.some((i) => i.category === "consecutive_errors")).toBe(true);
      expect(issues.some((i) => i.category === "zombie_agent")).toBe(true);
    });
  });
});
