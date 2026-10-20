import { describe, expect, it } from "vitest";
import type { RuntimeCapabilityBinding } from "./agent-runtime-store.js";
import type { GovernanceRegistryEntry } from "./capability-governance-store.js";
import {
  effectiveMaturity,
  maturityFromUsage,
  monthlyExecutionsFromBindings,
  uniqueAgentCount,
} from "./capability-maturity.js";

function binding(
  runtimeAgentId: string,
  capabilityId: string,
  calls7d: number,
): RuntimeCapabilityBinding {
  return {
    bindingId: `binding-${runtimeAgentId}`,
    runtimeAgentId,
    capabilityId,
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    routingPriority: 50,
    loadStrategy: "eager",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d,
      successRate7d: 0.95,
      avgLatencyMs: 200,
      p95LatencyMs: 400,
      errorCount7d: 0,
      tokenConsumption7d: 100,
    },
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function entry(grant?: string): GovernanceRegistryEntry {
  return {
    manifest: {
      id: "urn:openclaw:skill:demo@1.0.0",
      kind: "skill",
      version: "1.0.0",
      skillKey: "demo",
      name: "演示",
      description: "演示",
      source: { kind: "personal", origin: "test", trustTier: "user" },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    },
    lifecycleState: "active",
    distribution: {
      capabilityId: "urn:openclaw:skill:demo@1.0.0",
      scope: {},
      defaultEnabled: false,
      employeeVisibilityMode: "enterprise_review_required",
      updatedAt: "2026-09-18T00:00:00.000Z",
    },
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...(grant ? { manualMaturityGrant: grant } : {}),
  };
}

describe("capability maturity SoT", () => {
  it("counts unique robots and 30-day call estimates once", () => {
    const bindings = [binding("a", "cap", 10), binding("b", "cap", 15)];
    expect(uniqueAgentCount(bindings)).toBe(2);
    expect(monthlyExecutionsFromBindings(bindings)).toBe(100);
  });

  it("uses the same usage ladder for list and incubation", () => {
    expect(maturityFromUsage([])).toBe("初步形成");
    expect(maturityFromUsage([binding("a", "cap", 1)])).toBe("稳定使用");
    expect(maturityFromUsage([binding("a", "cap", 1), binding("b", "cap", 1)])).toBe("多人复用");
    expect(maturityFromUsage([binding("a", "cap", 30)])).toBe("企业认证");
  });

  it("lets an admin grant raise the badge without replacing stronger usage", () => {
    expect(effectiveMaturity(entry("企业认证"), [])).toBe("企业认证");
    expect(effectiveMaturity(entry("企业认证"), [binding("a", "cap", 200)])).toBe("企业标准");
  });
});
