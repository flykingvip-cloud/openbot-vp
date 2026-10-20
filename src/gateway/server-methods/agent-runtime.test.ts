// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  __agentRuntimeStoreInternals,
  getBinding,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
} from "../agent-runtime-store.js";
import { ErrorCodes, type ErrorShape } from "../protocol/index.js";
import { agentRuntimeHandlers } from "./agent-runtime.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

/**
 * 集成测试：直接调用 handler，跳过 connect/scope 中间件，验证：
 * - Catalog / binding CRUD 全链路
 * - Lifecycle 转换合法性 + archived 级联禁用
 * - Governance 检测 + acknowledgement
 * - KPI 派生
 *
 * 测试夹具通过 `__agentRuntimeStoreInternals.seed` 注入，每个 test reset。
 */

function call(handlerName: string, params: Record<string, unknown> = {}) {
  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: ErrorShape) => {
    result = { ok, payload, error };
  };
  const handler = agentRuntimeHandlers[handlerName] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`Unknown handler: ${handlerName}`);
  }
  const options = {
    req: { jsonrpc: "2.0", method: handlerName, params, id: "1" },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestHandlerOptions["context"],
  } as unknown as GatewayRequestHandlerOptions;
  const ret = handler(options);
  // handlers may be sync; ensure caller sees final state
  void ret;
  return result;
}

function makeAgent(overrides: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    runtimeAgentId: "agent-1",
    name: "Agent One",
    runtimeVersion: "1.0.0",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 0,
    activeSessionCount: 5,
    resourceUsage: { cpuPercent: 10, memoryPercent: 20, tokenBudgetUsedPercent: 5 },
    deployedAt: 0,
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

function makeBinding(overrides: Partial<RuntimeCapabilityBinding> = {}): RuntimeCapabilityBinding {
  return {
    bindingId: "b-1",
    runtimeAgentId: "agent-1",
    capabilityId: "cap-1",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    routingPriority: 50,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 100,
      successRate7d: 1,
      avgLatencyMs: 200,
      p95LatencyMs: 400,
      errorCount7d: 0,
      tokenConsumption7d: 0,
    },
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
    createdAt: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  __agentRuntimeStoreInternals.reset();
  // seeded fixtures: 1 agent + 1 binding
  __agentRuntimeStoreInternals.seed({
    agents: { "agent-1": makeAgent() },
    bindings: { "b-1": makeBinding() },
  });
});

describe("agent-runtime.list-agents", () => {
  it("returns the seeded agent", () => {
    const r = call("agent-runtime.list-agents");
    expect(r.ok).toBe(true);
    const agents = (r.payload as { agents: RuntimeAgent[] }).agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]?.runtimeAgentId).toBe("agent-1");
  });

  it("supports lifecycle and health filters", () => {
    const r = call("agent-runtime.list-agents", { lifecycle: "draining" });
    expect((r.payload as { agents: RuntimeAgent[] }).agents).toHaveLength(0);
  });
});

describe("agent-runtime.get-agent", () => {
  it("returns agent + bindings", () => {
    const r = call("agent-runtime.get-agent", { runtimeAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    const payload = r.payload as { agent: RuntimeAgent; bindings: RuntimeCapabilityBinding[] };
    expect(payload.agent.runtimeAgentId).toBe("agent-1");
    expect(payload.bindings).toHaveLength(1);
  });

  it("rejects unknown agent with INVALID_REQUEST", () => {
    const r = call("agent-runtime.get-agent", { runtimeAgentId: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });
});

describe("agent-runtime.list-bindings", () => {
  it("filters by capabilityId", () => {
    const r = call("agent-runtime.list-bindings", { capabilityId: "cap-other" });
    expect(r.ok).toBe(true);
    expect((r.payload as { bindings: RuntimeCapabilityBinding[] }).bindings).toHaveLength(0);
  });
});

describe("agent-runtime.create-binding", () => {
  it("creates a new binding for an existing agent", () => {
    const r = call("agent-runtime.create-binding", {
      runtimeAgentId: "agent-1",
      capabilityId: "cap-new",
      capabilityVersion: "1.0.0",
      bindingType: "tenant-installed",
      loadStrategy: "lazy",
    });
    expect(r.ok).toBe(true);
    const created = (r.payload as { binding: RuntimeCapabilityBinding }).binding;
    expect(created.capabilityId).toBe("cap-new");
    expect(created.bindingState).toBe("active");
  });

  it("rejects duplicate active binding for same (agent, capability)", () => {
    const r = call("agent-runtime.create-binding", {
      runtimeAgentId: "agent-1",
      capabilityId: "cap-1",
      capabilityVersion: "1.0.0",
      bindingType: "tenant-installed",
      loadStrategy: "lazy",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("rejects unknown agent", () => {
    const r = call("agent-runtime.create-binding", {
      runtimeAgentId: "ghost",
      capabilityId: "cap-x",
      capabilityVersion: "1.0.0",
      bindingType: "tenant-installed",
      loadStrategy: "lazy",
    });
    expect(r.ok).toBe(false);
  });
});

describe("agent-runtime.update-binding-* family", () => {
  it("updates state", () => {
    const r = call("agent-runtime.update-binding-state", {
      bindingId: "b-1",
      bindingState: "disabled",
    });
    expect(r.ok).toBe(true);
    expect((r.payload as { binding: RuntimeCapabilityBinding }).binding.bindingState).toBe(
      "disabled",
    );
  });

  it("rejects negative priority", () => {
    const r = call("agent-runtime.update-binding-priority", {
      bindingId: "b-1",
      routingPriority: -1,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-number priority", () => {
    const r = call("agent-runtime.update-binding-priority", {
      bindingId: "b-1",
      routingPriority: "high",
    });
    expect(r.ok).toBe(false);
  });

  it("updates load strategy", () => {
    const r = call("agent-runtime.update-binding-strategy", {
      bindingId: "b-1",
      loadStrategy: "eager",
    });
    expect(r.ok).toBe(true);
    expect((r.payload as { binding: RuntimeCapabilityBinding }).binding.loadStrategy).toBe("eager");
  });
});

describe("agent-runtime.delete-binding", () => {
  it("removes the binding and reports deleted=true", () => {
    const r = call("agent-runtime.delete-binding", { bindingId: "b-1" });
    expect(r.ok).toBe(true);
    expect((r.payload as { deleted: boolean }).deleted).toBe(true);
    const list = call("agent-runtime.list-bindings");
    expect((list.payload as { bindings: RuntimeCapabilityBinding[] }).bindings).toHaveLength(0);
  });

  it("returns deleted=false for unknown binding (no error)", () => {
    const r = call("agent-runtime.delete-binding", { bindingId: "ghost" });
    expect(r.ok).toBe(true);
    expect((r.payload as { deleted: boolean }).deleted).toBe(false);
  });
});

describe("agent-runtime.update-lifecycle", () => {
  it("performs legal transition deployed → deprecated", () => {
    const r = call("agent-runtime.update-lifecycle", {
      runtimeAgentId: "agent-1",
      targetLifecycle: "deprecated",
      reason: "scheduled-deprecation",
    });
    expect(r.ok).toBe(true);
    const payload = r.payload as {
      agent: RuntimeAgent;
      rejectionReason: string | null;
      impact: { triggersDownstreamNotification: boolean };
    };
    expect(payload.agent.lifecycle).toBe("deprecated");
    expect(payload.rejectionReason).toBeNull();
    expect(payload.impact.triggersDownstreamNotification).toBe(true);
  });

  it("rejects illegal transition with rejectionReason", () => {
    const r = call("agent-runtime.update-lifecycle", {
      runtimeAgentId: "agent-1",
      targetLifecycle: "archived",
      reason: "skip-states",
    });
    expect(r.ok).toBe(true);
    const payload = r.payload as { rejectionReason: string | null };
    expect(payload.rejectionReason).toContain("不能转换");
  });

  it("cascade-disables all bindings on archive", () => {
    // Force agent into deprecated then archived
    call("agent-runtime.update-lifecycle", {
      runtimeAgentId: "agent-1",
      targetLifecycle: "deprecated",
      reason: "step-1",
    });
    const r = call("agent-runtime.update-lifecycle", {
      runtimeAgentId: "agent-1",
      targetLifecycle: "archived",
      reason: "final",
    });
    expect(r.ok).toBe(true);
    const list = call("agent-runtime.list-bindings");
    const bindings = (list.payload as { bindings: RuntimeCapabilityBinding[] }).bindings;
    expect(bindings.every((b) => b.bindingState === "disabled")).toBe(true);
  });
});

describe("agent-runtime.get-lifecycle-history", () => {
  it("records every successful transition", () => {
    call("agent-runtime.update-lifecycle", {
      runtimeAgentId: "agent-1",
      targetLifecycle: "deprecated",
      reason: "step-1",
    });
    const r = call("agent-runtime.get-lifecycle-history", { runtimeAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    const events = (r.payload as { events: { fromLifecycle: string; toLifecycle: string }[] })
      .events;
    expect(events).toHaveLength(1);
    expect(events[0]?.fromLifecycle).toBe("deployed");
    expect(events[0]?.toLifecycle).toBe("deprecated");
  });
});

describe("agent-runtime.list-governance-issues", () => {
  it("detects zombie binding (active + 0 calls + > threshold days)", () => {
    const ancient = Date.now() - 60 * 24 * 60 * 60 * 1000;
    __agentRuntimeStoreInternals.reset();
    __agentRuntimeStoreInternals.seed({
      agents: { "agent-1": makeAgent() },
      bindings: {
        zombie: makeBinding({
          bindingId: "zombie",
          updatedAt: ancient,
          invocationMetrics: { ...makeBinding().invocationMetrics, calls7d: 0 },
        }),
      },
    });
    const r = call("agent-runtime.list-governance-issues");
    expect(r.ok).toBe(true);
    const issues = (r.payload as { issues: { category: string; bindingId: string | null }[] })
      .issues;
    expect(issues.some((i) => i.category === "zombie-binding")).toBe(true);
  });

  it("acknowledged issues hidden by default; visible with includeAcknowledged=true", () => {
    const ancient = Date.now() - 60 * 24 * 60 * 60 * 1000;
    __agentRuntimeStoreInternals.reset();
    __agentRuntimeStoreInternals.seed({
      agents: { "agent-1": makeAgent() },
      bindings: {
        zombie: makeBinding({
          bindingId: "zombie",
          updatedAt: ancient,
          invocationMetrics: { ...makeBinding().invocationMetrics, calls7d: 0 },
        }),
      },
    });
    const list1 = call("agent-runtime.list-governance-issues");
    const issues = (list1.payload as { issues: { id: string }[] }).issues;
    expect(issues).toHaveLength(1);
    const issueId = issues[0].id;

    const ackResp = call("agent-runtime.acknowledge-issue", {
      issueId,
      reviewerId: "ops:peter",
      note: "noted",
    });
    expect(ackResp.ok).toBe(true);

    const hidden = call("agent-runtime.list-governance-issues");
    expect((hidden.payload as { issues: unknown[] }).issues).toHaveLength(0);

    const visible = call("agent-runtime.list-governance-issues", {
      includeAcknowledged: true,
    });
    const visibleIssues = (visible.payload as { issues: { acknowledgedBy: string | null }[] })
      .issues;
    expect(visibleIssues[0]?.acknowledgedBy).toBe("ops:peter");
  });
});

describe("agent-runtime.update-governance-config", () => {
  it("rejects negative threshold values", () => {
    const r = call("agent-runtime.update-governance-config", {
      config: { zombieBindingDays: -1 },
    });
    expect(r.ok).toBe(false);
  });

  it("partial update preserves other fields", () => {
    const r = call("agent-runtime.update-governance-config", {
      config: { zombieBindingDays: 14 },
    });
    expect(r.ok).toBe(true);
    const config = (
      r.payload as { config: { zombieBindingDays: number; orphanedAgentDays: number } }
    ).config;
    expect(config.zombieBindingDays).toBe(14);
    expect(config.orphanedAgentDays).toBe(30); // default preserved
  });
});

describe("agent-runtime.get-runtime-kpi", () => {
  it("computes totals across seeded data", () => {
    const r = call("agent-runtime.get-runtime-kpi");
    expect(r.ok).toBe(true);
    const kpi = (
      r.payload as {
        kpi: {
          agentCountTotal: number;
          bindingCountTotal: number;
          healthyAgentRatio: number;
        };
      }
    ).kpi;
    expect(kpi.agentCountTotal).toBe(1);
    expect(kpi.bindingCountTotal).toBe(1);
    expect(kpi.healthyAgentRatio).toBe(1);
  });
});

describe("agent-runtime.get-health-summary", () => {
  it("groups counts by health status", () => {
    const r = call("agent-runtime.get-health-summary");
    expect(r.ok).toBe(true);
    const payload = r.payload as {
      agentCountByHealth: Record<string, number>;
      bindingCountByHealth: Record<string, number>;
    };
    expect(payload.agentCountByHealth.healthy).toBe(1);
    expect(payload.bindingCountByHealth.healthy).toBe(1);
  });
});

describe("agent-runtime binding batch and policy", () => {
  it("applies batch state with partial rejection", () => {
    __agentRuntimeStoreInternals.seed({
      agents: { "agent-1": makeAgent() },
      bindings: {
        "b-1": makeBinding({ bindingId: "b-1" }),
        "b-2": makeBinding({ bindingId: "b-2", capabilityId: "cap-2" }),
      },
    });
    const result = call("agent-runtime.binding.batch-set-state", {
      bindingIds: ["b-1", "missing", "b-1"],
      bindingState: "disabled",
    });
    expect(result.ok).toBe(true);
    const payload = result.payload as {
      applied: RuntimeCapabilityBinding[];
      rejected: Array<{ bindingId: string; reason: string }>;
    };
    expect(payload.applied.map((binding) => binding.bindingId)).toEqual(["b-1"]);
    expect(payload.applied[0]?.bindingState).toBe("disabled");
    expect(payload.rejected.map((entry) => entry.bindingId)).toEqual(["missing"]);
    expect(getBinding("b-2")?.bindingState).toBe("active");

    const strategy = call("agent-runtime.binding.batch-set-strategy", {
      bindingIds: ["b-2", "missing"],
      loadStrategy: "eager",
    });
    const strategyPayload = strategy.payload as {
      applied: RuntimeCapabilityBinding[];
      rejected: Array<{ bindingId: string }>;
    };
    expect(strategyPayload.applied.map((binding) => binding.loadStrategy)).toEqual(["eager"]);
    expect(strategyPayload.rejected).toHaveLength(1);
    expect(getBinding("b-2")?.loadStrategy).toBe("eager");
  });

  it("keeps policy unconfigured until update and rejects a negative cap", () => {
    const initial = call("agent-runtime.policy.get");
    expect(initial.ok).toBe(true);
    expect(initial.payload).toEqual({
      loadDefaults: null,
      conflict: null,
      fallback: { mode: null },
      rateLimit: null,
    });
    const updated = call("agent-runtime.policy.update", {
      conflict: "priority",
      rateLimit: { perCapabilityQps: 3, perTenantDailyCap: null },
      fallback: { mode: "none" },
    });
    expect(updated.ok).toBe(true);
    expect(updated.payload).toMatchObject({
      conflict: "priority",
      fallback: { mode: "none" },
      rateLimit: { perCapabilityQps: 3, perTenantDailyCap: null },
    });
    const rejected = call("agent-runtime.policy.update", {
      rateLimit: { perCapabilityQps: -1 },
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.message).toContain("requests per second");
    const fractionalDay = call("agent-runtime.policy.update", {
      rateLimit: { perTenantDailyCap: 1.5 },
    });
    expect(fractionalDay.ok).toBe(false);
    expect(fractionalDay.error?.message).toContain("requests per day");
    const after = call("agent-runtime.policy.get");
    expect(after.payload).toMatchObject({
      rateLimit: { perCapabilityQps: 3, perTenantDailyCap: null },
      fallback: { mode: "none" },
    });
    const withUnits = call("agent-runtime.policy.update", {
      rateLimit: { perCapabilityQps: 0.5, perTenantDailyCap: 40 },
      fallback: { mode: "auto-standby" },
    });
    expect(withUnits.ok).toBe(true);
    expect(withUnits.payload).toMatchObject({
      fallback: { mode: "auto-standby" },
      rateLimit: { perCapabilityQps: 0.5, perTenantDailyCap: 40 },
    });
  });

  it("upgrades only catalog versions that are newer and reports the rest", () => {
    expect(agentRuntimeHandlers["agent-runtime.binding.upgrade"]).toEqual(expect.any(Function));
    __agentRuntimeStoreInternals.seed({
      agents: { "agent-1": makeAgent() },
      bindings: {
        old: makeBinding({
          bindingId: "old",
          capabilityId: "cap-upgrade-541c",
          capabilityVersion: "1.0.0",
        }),
        current: makeBinding({
          bindingId: "current",
          capabilityId: "cap-upgrade-541c",
          capabilityVersion: "1.2.0",
        }),
        anchor: makeBinding({
          bindingId: "anchor",
          capabilityId: "cap-upgrade-541c",
          capabilityVersion: "1.0.0",
        }),
        label: makeBinding({
          bindingId: "label",
          capabilityId: "cap-upgrade-541c",
          capabilityVersion: "latest",
        }),
        other: makeBinding({
          bindingId: "other",
          capabilityId: "cap-upgrade-541c-other",
          capabilityVersion: "1.0.0",
        }),
      },
    });
    const listed = call("agent-runtime.capability-versions.list", {
      capabilityId: "cap-upgrade-541c",
    });
    expect(listed.ok).toBe(true);
    const versions = (
      listed.payload as { entries: Array<{ version: string; eligible: boolean }> }
    ).entries.map((entry) => entry.version);
    expect(versions).toEqual(["1.2.0", "1.0.0", "latest"]);

    const upgraded = call("agent-runtime.binding.upgrade", {
      bindingIds: ["old", "current", "other", "missing"],
      capabilityVersion: "1.2.0",
    });
    expect(upgraded.ok).toBe(true);
    const payload = upgraded.payload as {
      applied: RuntimeCapabilityBinding[];
      rejected: Array<{ bindingId: string; reason: string }>;
    };
    expect(payload.applied.map((binding) => binding.bindingId)).toEqual(["old"]);
    expect(payload.applied[0]?.capabilityVersion).toBe("1.2.0");
    expect(payload.rejected).toEqual([
      { bindingId: "current", reason: "incompatible: already at capabilityVersion" },
      { bindingId: "other", reason: "version unknown" },
      { bindingId: "missing", reason: "Unknown binding: missing" },
    ]);
    expect(getBinding("old")?.capabilityVersion).toBe("1.2.0");
    expect(getBinding("other")?.capabilityVersion).toBe("1.0.0");

    const downgrade = call("agent-runtime.binding.upgrade", {
      bindingIds: ["old"],
      capabilityVersion: "1.0.0",
    });
    const downgraded = downgrade.payload as {
      applied: unknown[];
      rejected: Array<{ reason: string }>;
    };
    expect(downgraded.applied).toEqual([]);
    expect(downgraded.rejected[0]?.reason).toBe("incompatible: target is not newer");
    expect(getBinding("old")?.capabilityVersion).toBe("1.2.0");

    const opaque = call("agent-runtime.binding.upgrade", {
      bindingIds: ["old"],
      capabilityVersion: "latest",
    });
    expect((opaque.payload as { applied: unknown[] }).applied).toEqual([]);
    expect((opaque.payload as { rejected: Array<{ reason: string }> }).rejected[0]?.reason).toBe(
      "incompatible: version is not a comparable semver",
    );
  });
});

describe("agent-runtime.governance.fix", () => {
  it("disables zombie bindings, clears a missing fallback, and skips conflicts", () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    __agentRuntimeStoreInternals.seed({
      agents: { "agent-1": makeAgent() },
      bindings: {
        "zombie-1": makeBinding({
          bindingId: "zombie-1",
          capabilityId: "cap-zombie",
          updatedAt: old,
          createdAt: old,
          invocationMetrics: {
            calls7d: 0,
            successRate7d: 1,
            avgLatencyMs: 0,
            p95LatencyMs: 0,
            errorCount7d: 0,
            tokenConsumption7d: 0,
          },
        }),
        primary: makeBinding({
          bindingId: "primary",
          capabilityId: "cap-fb",
          fallbackBindingId: "missing-fb",
        }),
        "conflict-a": makeBinding({
          bindingId: "conflict-a",
          capabilityId: "cap-conflict",
          capabilityVersion: "1.0.0",
        }),
        "conflict-b": makeBinding({
          bindingId: "conflict-b",
          capabilityId: "cap-conflict",
          capabilityVersion: "2.0.0",
        }),
      },
    });

    const dry = call("agent-runtime.governance.fix", {
      category: "zombie-binding",
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    const dryPayload = dry.payload as {
      dryRun: boolean;
      applied: Array<{ issueId: string; bindingId: string; action: string }>;
    };
    expect(dryPayload.dryRun).toBe(true);
    expect(dryPayload.applied).toEqual([
      {
        issueId: "zombie-binding::zombie-1",
        bindingId: "zombie-1",
        action: "disable-binding",
      },
    ]);
    expect(getBinding("zombie-1")?.bindingState).toBe("active");

    const fixed = call("agent-runtime.governance.fix", {
      category: "zombie-binding",
      dryRun: false,
    });
    expect(fixed.ok).toBe(true);
    expect(getBinding("zombie-1")?.bindingState).toBe("disabled");

    const fallback = call("agent-runtime.governance.fix", {
      category: "fallback-chain-broken",
      dryRun: false,
    });
    const fallbackPayload = fallback.payload as {
      applied: Array<{ action: string; bindingId: string }>;
    };
    expect(fallbackPayload.applied).toEqual([
      {
        issueId: "fallback-chain-broken::primary",
        bindingId: "primary",
        action: "clear-missing-fallback",
      },
    ]);
    expect(getBinding("primary")?.fallbackBindingId).toBeNull();

    const conflict = call("agent-runtime.governance.fix", {
      category: "capability-conflict",
      dryRun: false,
    });
    const conflictPayload = conflict.payload as {
      applied: unknown[];
      skipped: Array<{ reason: string }>;
    };
    expect(conflictPayload.applied).toEqual([]);
    expect(conflictPayload.skipped[0]?.reason).toContain("version target");
    expect(getBinding("conflict-a")?.capabilityVersion).toBe("1.0.0");
    expect(getBinding("conflict-b")?.capabilityVersion).toBe("2.0.0");
  });
});
