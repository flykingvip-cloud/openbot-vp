// @vitest-environment node
// Feature: platform-agent-runtime-center, Property 7/8: Governance detector determinism + zombie correctness
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOVERNANCE_CONFIG,
  detectFallbackChainBroken,
  detectGovernanceIssues,
  detectOrphanedAgents,
  detectResourceOvercommit,
  detectVersionDrift,
  detectZombieBindings,
} from "../governance-detector.ts";
import {
  BINDING_STATES,
  BINDING_TYPES,
  type BindingPolicy,
  type BindingState,
  type LoadStrategy,
  LOAD_STRATEGIES,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeHealth,
  RUNTIME_HEALTH_STATUSES,
  type RuntimeLifecycle,
  RUNTIME_LIFECYCLES,
} from "../types.ts";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

// ─────────────────────────────────────────────────────────────────────────
// Arbitrary 生成器
// ─────────────────────────────────────────────────────────────────────────

const arbBindingPolicy: fc.Arbitrary<BindingPolicy> = fc.record({
  sandbox: fc.string({ minLength: 1, maxLength: 12 }),
  resourceQuota: fc.string({ minLength: 1, maxLength: 12 }),
  hotReloadable: fc.boolean(),
});

const arbBinding: fc.Arbitrary<RuntimeCapabilityBinding> = fc.record({
  bindingId: fc.string({ minLength: 1, maxLength: 16 }),
  runtimeAgentId: fc.string({ minLength: 1, maxLength: 16 }),
  capabilityId: fc.string({ minLength: 1, maxLength: 16 }),
  capabilityVersion: fc.string({ minLength: 1, maxLength: 8 }),
  bindingType: fc.constantFrom(...BINDING_TYPES),
  routingPriority: fc.integer({ min: 0, max: 100 }),
  loadStrategy: fc.constantFrom<LoadStrategy>(...LOAD_STRATEGIES),
  bindingState: fc.constantFrom<BindingState>(...BINDING_STATES),
  healthStatus: fc.constantFrom<RuntimeHealth>(...RUNTIME_HEALTH_STATUSES),
  invocationMetrics: fc.record({
    calls7d: fc.nat({ max: 1_000 }),
    successRate7d: fc.double({ min: 0, max: 1, noNaN: true }),
    avgLatencyMs: fc.nat({ max: 10_000 }),
    p95LatencyMs: fc.nat({ max: 10_000 }),
    errorCount7d: fc.nat({ max: 1_000 }),
    tokenConsumption7d: fc.nat({ max: 1_000_000 }),
  }),
  policy: arbBindingPolicy,
  configurationState: fc.constantFrom<"not-required" | "pending" | "complete">(
    "not-required",
    "pending",
    "complete",
  ),
  governanceState: fc.constantFrom<"none" | "restricted" | "review-required" | "disabled">(
    "none",
    "restricted",
    "review-required",
    "disabled",
  ),
  fallbackBindingId: fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: null }),
  createdAt: fc.integer({ min: 0, max: NOW }),
  updatedAt: fc.integer({ min: 0, max: NOW }),
});

const arbAgent: fc.Arbitrary<RuntimeAgent> = fc.record({
  runtimeAgentId: fc.string({ minLength: 1, maxLength: 16 }),
  name: fc.string({ minLength: 1, maxLength: 16 }),
  runtimeVersion: fc.string({ minLength: 1, maxLength: 8 }),
  lifecycle: fc.constantFrom<RuntimeLifecycle>(...RUNTIME_LIFECYCLES),
  health: fc.constantFrom<RuntimeHealth>(...RUNTIME_HEALTH_STATUSES),
  tenantCoverage: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 5 }),
  boundCapabilityCount: fc.nat({ max: 50 }),
  activeSessionCount: fc.nat({ max: 200 }),
  resourceUsage: fc.record({
    cpuPercent: fc.double({ min: 0, max: 100, noNaN: true }),
    memoryPercent: fc.double({ min: 0, max: 100, noNaN: true }),
    tokenBudgetUsedPercent: fc.double({ min: 0, max: 100, noNaN: true }),
  }),
  deployedAt: fc.integer({ min: 0, max: NOW }),
  lastActiveAt: fc.integer({ min: 0, max: NOW }),
});

// ─────────────────────────────────────────────────────────────────────────
// Property 7: 确定性 — 同输入返回相同 issue 集合
// Validates: Requirements 6 (overall), governance-detector.ts contract
// ─────────────────────────────────────────────────────────────────────────

describe("Property 7: detectGovernanceIssues is deterministic", () => {
  it("returns deep-equal results for the same input across runs", () => {
    fc.assert(
      fc.property(
        fc.array(arbAgent, { maxLength: 8 }),
        fc.array(arbBinding, { maxLength: 12 }),
        (agents, bindings) => {
          const a = detectGovernanceIssues(agents, bindings, undefined, NOW);
          const b = detectGovernanceIssues(agents, bindings, undefined, NOW);
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("output is sorted by stable issue id", () => {
    fc.assert(
      fc.property(
        fc.array(arbAgent, { maxLength: 8 }),
        fc.array(arbBinding, { maxLength: 12 }),
        (agents, bindings) => {
          const issues = detectGovernanceIssues(agents, bindings, undefined, NOW);
          const ids = issues.map((i) => i.id);
          const sorted = [...ids].toSorted();
          expect(ids).toEqual(sorted);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not mutate input arrays or items", () => {
    fc.assert(
      fc.property(
        fc.array(arbAgent, { maxLength: 6 }),
        fc.array(arbBinding, { maxLength: 8 }),
        (agents, bindings) => {
          const agentsSnap = JSON.parse(JSON.stringify(agents));
          const bindingsSnap = JSON.parse(JSON.stringify(bindings));
          detectGovernanceIssues(agents, bindings, undefined, NOW);
          expect(agents).toEqual(agentsSnap);
          expect(bindings).toEqual(bindingsSnap);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 8: Zombie 检测正确性 — 满足条件的 binding 必生成 issue
// Validates: Requirements 6.2
// ─────────────────────────────────────────────────────────────────────────

describe("Property 8: detectZombieBindings completeness and soundness", () => {
  it("an active binding with calls7d=0 and updatedAt older than threshold MUST be flagged", () => {
    fc.assert(
      fc.property(arbBinding, fc.integer({ min: 1, max: 365 }), (binding, days) => {
        const updatedAt = NOW - (days + 1) * MS_PER_DAY;
        const subject: RuntimeCapabilityBinding = {
          ...binding,
          bindingState: "active",
          invocationMetrics: { ...binding.invocationMetrics, calls7d: 0 },
          updatedAt,
        };
        const issues = detectZombieBindings([subject], days, NOW);
        // Expect exactly one zombie issue for this binding.
        expect(issues).toHaveLength(1);
        expect(issues[0].bindingId).toBe(subject.bindingId);
        expect(issues[0].category).toBe("zombie-binding");
      }),
      { numRuns: 100 },
    );
  });

  it("a binding with calls7d>0 is NEVER flagged (soundness)", () => {
    fc.assert(
      fc.property(arbBinding, fc.integer({ min: 1, max: 100 }), (binding, calls) => {
        const subject: RuntimeCapabilityBinding = {
          ...binding,
          bindingState: "active",
          invocationMetrics: { ...binding.invocationMetrics, calls7d: calls },
          updatedAt: 0,
        };
        const issues = detectZombieBindings([subject], 1, NOW);
        expect(issues).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("a binding within the threshold window is NOT flagged", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.integer({ min: 1, max: 365 }),
        fc.integer({ min: 0, max: 23 }),
        (binding, days, hoursAgo) => {
          // updatedAt within the window: hoursAgo < 24 hours, well within `days`.
          const subject: RuntimeCapabilityBinding = {
            ...binding,
            bindingState: "active",
            invocationMetrics: { ...binding.invocationMetrics, calls7d: 0 },
            updatedAt: NOW - hoursAgo * 60 * 60 * 1_000,
          };
          const issues = detectZombieBindings([subject], days, NOW);
          expect(issues).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-active states are never flagged as zombie", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.constantFrom<BindingState>("warming", "degraded", "disabled"),
        (binding, state) => {
          const subject: RuntimeCapabilityBinding = {
            ...binding,
            bindingState: state,
            invocationMetrics: { ...binding.invocationMetrics, calls7d: 0 },
            updatedAt: 0,
          };
          const issues = detectZombieBindings([subject], 1, NOW);
          expect(issues).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 单元测试：每个检测器的边界情形
// ─────────────────────────────────────────────────────────────────────────

describe("detectVersionDrift", () => {
  it("flags a capability bound to multiple distinct versions across agents", () => {
    const base: RuntimeCapabilityBinding = makeBaseBinding();
    const a: RuntimeCapabilityBinding = {
      ...base,
      bindingId: "b1",
      runtimeAgentId: "agent-1",
      capabilityVersion: "1.0.0",
    };
    const b: RuntimeCapabilityBinding = {
      ...base,
      bindingId: "b2",
      runtimeAgentId: "agent-2",
      capabilityVersion: "1.1.0",
    };
    const issues = detectVersionDrift([a, b], NOW);
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("version-drift");
  });

  it("does not flag when versions agree", () => {
    const base: RuntimeCapabilityBinding = makeBaseBinding();
    const a: RuntimeCapabilityBinding = { ...base, bindingId: "b1", runtimeAgentId: "agent-1" };
    const b: RuntimeCapabilityBinding = { ...base, bindingId: "b2", runtimeAgentId: "agent-2" };
    expect(detectVersionDrift([a, b], NOW)).toEqual([]);
  });

  it("ignores disabled bindings when checking drift", () => {
    const base: RuntimeCapabilityBinding = makeBaseBinding();
    const a: RuntimeCapabilityBinding = { ...base, bindingId: "b1", runtimeAgentId: "agent-1" };
    const b: RuntimeCapabilityBinding = {
      ...base,
      bindingId: "b2",
      runtimeAgentId: "agent-2",
      capabilityVersion: "9.9.9",
      bindingState: "disabled",
    };
    expect(detectVersionDrift([a, b], NOW)).toEqual([]);
  });
});

describe("detectFallbackChainBroken", () => {
  it("flags a binding whose fallback target is missing", () => {
    const subject: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "main",
      fallbackBindingId: "ghost",
    };
    const issues = detectFallbackChainBroken([subject], NOW);
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence.reason).toBe("missing");
  });

  it("flags a binding whose fallback target is disabled or unhealthy", () => {
    const fallback: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "fb",
      bindingState: "disabled",
    };
    const main: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "main",
      fallbackBindingId: "fb",
    };
    const issues = detectFallbackChainBroken([main, fallback], NOW);
    expect(issues).toHaveLength(1);
  });

  it("does not flag when fallback target is healthy and active", () => {
    const fallback: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "fb",
      bindingState: "active",
      healthStatus: "healthy",
    };
    const main: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "main",
      fallbackBindingId: "fb",
    };
    expect(detectFallbackChainBroken([main, fallback], NOW)).toEqual([]);
  });
});

describe("detectResourceOvercommit", () => {
  it("flags a deployed agent with cpu or memory above threshold", () => {
    const agent: RuntimeAgent = {
      ...makeBaseAgent(),
      lifecycle: "deployed",
      resourceUsage: { cpuPercent: 95, memoryPercent: 30, tokenBudgetUsedPercent: 10 },
    };
    expect(detectResourceOvercommit([agent], 0.9, NOW)).toHaveLength(1);
  });

  it("does not flag agents in non-deployed lifecycle states", () => {
    const agent: RuntimeAgent = {
      ...makeBaseAgent(),
      lifecycle: "draining",
      resourceUsage: { cpuPercent: 99, memoryPercent: 99, tokenBudgetUsedPercent: 99 },
    };
    expect(detectResourceOvercommit([agent], 0.9, NOW)).toEqual([]);
  });
});

describe("detectOrphanedAgents", () => {
  it("flags an active agent with no bindings and no recent activity", () => {
    const agent: RuntimeAgent = {
      ...makeBaseAgent(),
      lifecycle: "deployed",
      lastActiveAt: NOW - 31 * MS_PER_DAY,
    };
    expect(detectOrphanedAgents([agent], [], 30, NOW)).toHaveLength(1);
  });

  it("does not flag archived agents", () => {
    const agent: RuntimeAgent = {
      ...makeBaseAgent(),
      lifecycle: "archived",
      lastActiveAt: 0,
    };
    expect(detectOrphanedAgents([agent], [], 30, NOW)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 入口聚合器
// ─────────────────────────────────────────────────────────────────────────

describe("detectGovernanceIssues integration", () => {
  it("merges issues from all detectors", () => {
    // Compose a scenario hitting multiple detectors.
    const zombie: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "zombie-1",
      runtimeAgentId: "agent-1",
      capabilityId: "cap-1",
      capabilityVersion: "1.0.0",
      bindingState: "active",
      invocationMetrics: { ...makeBaseBinding().invocationMetrics, calls7d: 0 },
      updatedAt: NOW - 60 * MS_PER_DAY,
    };
    const driftA: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "drift-a",
      runtimeAgentId: "agent-2",
      capabilityId: "cap-2",
      capabilityVersion: "1.0.0",
      bindingState: "active",
    };
    const driftB: RuntimeCapabilityBinding = {
      ...makeBaseBinding(),
      bindingId: "drift-b",
      runtimeAgentId: "agent-3",
      capabilityId: "cap-2",
      capabilityVersion: "2.0.0",
      bindingState: "active",
    };

    const issues = detectGovernanceIssues([], [zombie, driftA, driftB], undefined, NOW);
    const categories = issues.map((i) => i.category).toSorted();
    expect(categories).toContain("zombie-binding");
    expect(categories).toContain("version-drift");
  });

  it("uses the default config when none provided", () => {
    const issues = detectGovernanceIssues([], [], undefined, NOW);
    expect(issues).toEqual([]);
    // Sanity: the defaults should be present
    expect(DEFAULT_GOVERNANCE_CONFIG.zombieBindingDays).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试夹具
// ─────────────────────────────────────────────────────────────────────────

function makeBaseBinding(): RuntimeCapabilityBinding {
  return {
    bindingId: "b-base",
    runtimeAgentId: "agent-base",
    capabilityId: "cap-base",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    routingPriority: 0,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 100,
      successRate7d: 1,
      avgLatencyMs: 100,
      p95LatencyMs: 200,
      errorCount7d: 0,
      tokenConsumption7d: 0,
    },
    policy: { sandbox: "default", resourceQuota: "small", hotReloadable: true },
    configurationState: "not-required",
    governanceState: "none",
    fallbackBindingId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeBaseAgent(): RuntimeAgent {
  return {
    runtimeAgentId: "agent-base",
    name: "Base Agent",
    runtimeVersion: "1.0.0",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: [],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 10, memoryPercent: 10, tokenBudgetUsedPercent: 10 },
    deployedAt: 0,
    lastActiveAt: NOW,
  };
}
