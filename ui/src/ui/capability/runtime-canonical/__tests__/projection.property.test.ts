// @vitest-environment node
// Feature: platform-agent-runtime-center, Property 1/2/3: Runtime Canonical Projection
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type EnterpriseHealthProjection,
  type EmployeeHealthProjection,
  isProjectionClean,
  projectBindingStateToStatus,
  projectBindingToInstallRelation,
  projectBindingTypeToSource,
  projectHealthToEmployee,
  projectHealthToEnterprise,
  projectLifecycleToNotification,
  RUNTIME_INTERNAL_FIELDS,
} from "../projection.ts";
import {
  BINDING_STATES,
  BINDING_TYPES,
  type BindingPolicy,
  type BindingState,
  type BindingType,
  type LoadStrategy,
  LOAD_STRATEGIES,
  type RuntimeCapabilityBinding,
  type RuntimeHealth,
  RUNTIME_HEALTH_STATUSES,
  type RuntimeLifecycle,
  RUNTIME_LIFECYCLES,
} from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────
// fast-check 任意值生成器（共享）
// ─────────────────────────────────────────────────────────────────────────

const arbRuntimeHealth: fc.Arbitrary<RuntimeHealth> = fc.constantFrom(...RUNTIME_HEALTH_STATUSES);
const arbBindingType: fc.Arbitrary<BindingType> = fc.constantFrom(...BINDING_TYPES);
const arbBindingState: fc.Arbitrary<BindingState> = fc.constantFrom(...BINDING_STATES);
const arbLoadStrategy: fc.Arbitrary<LoadStrategy> = fc.constantFrom(...LOAD_STRATEGIES);
const arbRuntimeLifecycle: fc.Arbitrary<RuntimeLifecycle> = fc.constantFrom(...RUNTIME_LIFECYCLES);

const arbBindingPolicy: fc.Arbitrary<BindingPolicy> = fc.record({
  sandbox: fc.string({ minLength: 1, maxLength: 20 }),
  resourceQuota: fc.string({ minLength: 1, maxLength: 20 }),
  hotReloadable: fc.boolean(),
});

const arbBinding: fc.Arbitrary<RuntimeCapabilityBinding> = fc.record({
  bindingId: fc.string({ minLength: 1, maxLength: 32 }),
  runtimeAgentId: fc.string({ minLength: 1, maxLength: 32 }),
  capabilityId: fc.string({ minLength: 1, maxLength: 32 }),
  capabilityVersion: fc.string({ minLength: 1, maxLength: 16 }),
  bindingType: arbBindingType,
  routingPriority: fc.integer({ min: 0, max: 1000 }),
  loadStrategy: arbLoadStrategy,
  bindingState: arbBindingState,
  healthStatus: arbRuntimeHealth,
  invocationMetrics: fc.record({
    calls7d: fc.nat({ max: 100_000 }),
    successRate7d: fc.double({ min: 0, max: 1, noNaN: true }),
    avgLatencyMs: fc.nat({ max: 60_000 }),
    p95LatencyMs: fc.nat({ max: 60_000 }),
    errorCount7d: fc.nat({ max: 100_000 }),
    tokenConsumption7d: fc.nat({ max: 10_000_000 }),
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
  fallbackBindingId: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: null }),
  createdAt: fc.nat(),
  updatedAt: fc.nat(),
});

// ─────────────────────────────────────────────────────────────────────────
// Property 1: 完备性 — RuntimeHealth 4 个枚举值都有非 undefined 投影
// Validates: Requirements 7.1, 7.4 (完备性子句)
// ─────────────────────────────────────────────────────────────────────────

describe("Property 1: Runtime → Enterprise/Employee 投影完备性", () => {
  it("projectHealthToEnterprise covers every RuntimeHealth value", () => {
    fc.assert(
      fc.property(arbRuntimeHealth, (health) => {
        const result = projectHealthToEnterprise(health);
        // Total function: never returns undefined for any enum value.
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("projectHealthToEnterprise mapping table is exhaustive and stable", () => {
    const expected: Record<RuntimeHealth, EnterpriseHealthProjection> = {
      healthy: "效果稳定",
      degraded: "偶尔结果不理想",
      unhealthy: "建议重新整理",
      unavailable: "已不适合继续推广",
    };
    for (const health of RUNTIME_HEALTH_STATUSES) {
      expect(projectHealthToEnterprise(health)).toBe(expected[health]);
    }
  });

  it("projectHealthToEmployee returns null only for unavailable", () => {
    fc.assert(
      fc.property(arbRuntimeHealth, (health) => {
        const result = projectHealthToEmployee(health);
        if (health === "unavailable") {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(typeof result).toBe("string");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("projectHealthToEmployee mapping table is exhaustive and stable", () => {
    const expected: Record<RuntimeHealth, EmployeeHealthProjection | null> = {
      healthy: "运行稳定",
      degraded: "偶尔异常",
      unhealthy: "需要重新整理",
      unavailable: null,
    };
    for (const health of RUNTIME_HEALTH_STATUSES) {
      expect(projectHealthToEmployee(health)).toBe(expected[health]);
    }
  });

  it("projectBindingTypeToSource covers every BindingType", () => {
    fc.assert(
      fc.property(arbBindingType, (type) => {
        const result = projectBindingTypeToSource(type);
        expect(result === "管理员推送" || result === "员工自主安装").toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("projectBindingStateToStatus covers every BindingState", () => {
    fc.assert(
      fc.property(arbBindingState, (state) => {
        const result = projectBindingStateToStatus(state);
        expect(["正常运行", "已暂停", "待更新"]).toContain(result);
      }),
      { numRuns: 100 },
    );
  });

  it("projectLifecycleToNotification covers every RuntimeLifecycle", () => {
    fc.assert(
      fc.property(arbRuntimeLifecycle, (lifecycle) => {
        const result = projectLifecycleToNotification(lifecycle);
        if (lifecycle === "deprecated") {
          expect(result).toEqual({ kind: "deprecation-warning", message: "即将下线" });
        } else if (lifecycle === "archived") {
          expect(result).toEqual({ kind: "archived-notice", message: "已下线" });
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 2: 纯净性 — projectBindingToInstallRelation 输出不含 RUNTIME_INTERNAL_FIELDS
// Validates: Requirements 7.2, 7.5
// ─────────────────────────────────────────────────────────────────────────

describe("Property 2: 投影输出对 Runtime 内部字段保持纯净", () => {
  it("projectBindingToInstallRelation output never contains runtime internal fields", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (binding, agentName, capabilityName) => {
          const projected = projectBindingToInstallRelation(binding, agentName, capabilityName);
          expect(isProjectionClean(projected)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("projectBindingToInstallRelation top-level keys are exactly the InstallRelation business surface", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (binding, agentName, capabilityName) => {
          const projected = projectBindingToInstallRelation(binding, agentName, capabilityName);
          const expectedKeys = [
            "capabilityId",
            "capabilityName",
            "robotId",
            "robotName",
            "installedAt",
            "source",
            "status",
          ].toSorted();
          expect(Object.keys(projected).toSorted()).toEqual(expectedKeys);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("isProjectionClean detects runtime field leakage at any depth", () => {
    // Sanity check: the guard itself must catch every blacklisted field name
    // at top-level, nested, and within arrays.
    for (const field of RUNTIME_INTERNAL_FIELDS) {
      const flat = { [field]: "leaked" };
      expect(isProjectionClean(flat)).toBe(false);

      const nested = { wrapper: { inner: { [field]: "leaked" } } };
      expect(isProjectionClean(nested)).toBe(false);

      const arrayLeak = { records: [{ ok: 1 }, { [field]: "leaked" }] };
      expect(isProjectionClean(arrayLeak)).toBe(false);
    }
  });

  it("isProjectionClean treats primitives, null/undefined, and Date as clean", () => {
    expect(isProjectionClean(null)).toBe(true);
    expect(isProjectionClean(undefined)).toBe(true);
    expect(isProjectionClean(123)).toBe(true);
    expect(isProjectionClean("hello")).toBe(true);
    expect(isProjectionClean(true)).toBe(true);
    expect(isProjectionClean(new Date())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 3: 幂等性 — 同一输入多次调用返回 deep-equal
// Validates: Requirements 7.4 (幂等性子句)
// ─────────────────────────────────────────────────────────────────────────

describe("Property 3: 投影函数幂等且不修改入参", () => {
  it("projectBindingToInstallRelation is idempotent on identical input", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (binding, agentName, capabilityName) => {
          const a = projectBindingToInstallRelation(binding, agentName, capabilityName);
          const b = projectBindingToInstallRelation(binding, agentName, capabilityName);
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("projectBindingToInstallRelation does not mutate the input binding", () => {
    fc.assert(
      fc.property(
        arbBinding,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (binding, agentName, capabilityName) => {
          const snapshot = JSON.parse(JSON.stringify(binding)) as RuntimeCapabilityBinding;
          projectBindingToInstallRelation(binding, agentName, capabilityName);
          expect(binding).toEqual(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("projectHealthToEnterprise/Employee are idempotent (pure)", () => {
    fc.assert(
      fc.property(arbRuntimeHealth, (health) => {
        expect(projectHealthToEnterprise(health)).toBe(projectHealthToEnterprise(health));
        expect(projectHealthToEmployee(health)).toBe(projectHealthToEmployee(health));
      }),
      { numRuns: 100 },
    );
  });

  it("projectLifecycleToNotification is idempotent (deep equal)", () => {
    fc.assert(
      fc.property(arbRuntimeLifecycle, (lc) => {
        expect(projectLifecycleToNotification(lc)).toEqual(projectLifecycleToNotification(lc));
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 单元层映射断言（与属性测试互补，保证字面量映射不被无意修改）
// ─────────────────────────────────────────────────────────────────────────

describe("Mapping invariants — sanity checks", () => {
  it("BindingType.tenant-installed projects to '员工自主安装'", () => {
    expect(projectBindingTypeToSource("tenant-installed")).toBe("员工自主安装");
  });

  it("BindingType.{platform-default,dynamic-runtime,fallback} all project to '管理员推送'", () => {
    expect(projectBindingTypeToSource("platform-default")).toBe("管理员推送");
    expect(projectBindingTypeToSource("dynamic-runtime")).toBe("管理员推送");
    expect(projectBindingTypeToSource("fallback")).toBe("管理员推送");
  });

  it("BindingState mapping table is exact", () => {
    expect(projectBindingStateToStatus("active")).toBe("正常运行");
    expect(projectBindingStateToStatus("warming")).toBe("待更新");
    expect(projectBindingStateToStatus("degraded")).toBe("正常运行");
    expect(projectBindingStateToStatus("disabled")).toBe("已暂停");
  });
});
