// @vitest-environment node
// Feature: platform-agent-runtime-center, Property 5/6: Runtime Lifecycle state machine
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canTransition,
  isTerminalLifecycle,
  nextLifecycleStates,
  validateTransition,
} from "../lifecycle-state-machine.ts";
import {
  RUNTIME_LIFECYCLE_TRANSITIONS,
  type RuntimeLifecycle,
  RUNTIME_LIFECYCLES,
} from "../types.ts";

const arbLifecycle: fc.Arbitrary<RuntimeLifecycle> = fc.constantFrom(...RUNTIME_LIFECYCLES);

// ─────────────────────────────────────────────────────────────────────────
// Property 5: 状态转换合法性 — canTransition iff target ∈ RUNTIME_LIFECYCLE_TRANSITIONS[current]
// Validates: Requirements 5.1
// ─────────────────────────────────────────────────────────────────────────

describe("Property 5: canTransition agrees with the adjacency table", () => {
  it("canTransition(current, target) === RUNTIME_LIFECYCLE_TRANSITIONS[current].includes(target)", () => {
    fc.assert(
      fc.property(arbLifecycle, arbLifecycle, (current, target) => {
        const expected = RUNTIME_LIFECYCLE_TRANSITIONS[current].includes(target);
        expect(canTransition(current, target)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("nextLifecycleStates(current) returns exactly the adjacency entry", () => {
    for (const current of RUNTIME_LIFECYCLES) {
      expect(nextLifecycleStates(current)).toEqual(RUNTIME_LIFECYCLE_TRANSITIONS[current]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// validateTransition 行为
// ─────────────────────────────────────────────────────────────────────────

describe("validateTransition delivers actionable rejection reasons", () => {
  it("returns ok for legal transitions and not-ok with reason for illegal ones", () => {
    fc.assert(
      fc.property(arbLifecycle, arbLifecycle, (current, target) => {
        const result = validateTransition(current, target);
        if (current === target) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toContain(current);
          }
        } else if (RUNTIME_LIFECYCLE_TRANSITIONS[current].includes(target)) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("rejects self-loops with a dedicated message", () => {
    for (const lifecycle of RUNTIME_LIFECYCLES) {
      const result = validateTransition(lifecycle, lifecycle);
      expect(result.ok).toBe(false);
    }
  });

  it("indicates terminal state in rejection reason when source has no outgoing edges", () => {
    // archived is the terminal state per types.ts.
    expect(isTerminalLifecycle("archived")).toBe(true);
    const result = validateTransition("archived", "deployed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("终态");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 6: 与 AssetLifecycle 独立性 — 状态机邻接表不暗含企业资产语义
//
// 严格独立性的"类型层隔离"由 TypeScript 的 string-literal 类型在编译期保证
// （RuntimeLifecycle 与 AssetLifecycle 不可互相赋值）。本节通过运行期断言：
// 即便存在同名值（例如 "deprecated"），其在 RUNTIME_LIFECYCLE_TRANSITIONS 中
// 的合法出度集合与 enterprise-capability 的资产生命周期定义不一致，从而保证
// 状态机层面也是独立的。
// Validates: Requirements 5.6
// ─────────────────────────────────────────────────────────────────────────

describe("Property 6: Runtime Lifecycle independent from Enterprise AssetLifecycle", () => {
  it("Runtime Lifecycle adjacency does not match enterprise asset lifecycle semantics", () => {
    // Enterprise AssetLifecycle (per enterprise-capability/types.ts):
    //   submitted → reviewing → approved → published → deprecated → retired
    // Runtime Lifecycle:
    //   deployed → {draining, deprecated}; draining → suspended; suspended → {deployed, archived};
    //   deprecated → archived; archived → ∅
    //
    // The set of legal targets from "deprecated" differs across the two state
    // machines: Enterprise allows "deprecated → retired", Runtime allows
    // "deprecated → archived". These targets are distinct identifiers,
    // confirming the two adjacency tables are not aliased.
    expect(RUNTIME_LIFECYCLE_TRANSITIONS.deprecated).toEqual(["archived"]);
    expect(RUNTIME_LIFECYCLE_TRANSITIONS.deprecated).not.toContain("retired");
  });

  it("Runtime terminal state is 'archived', not 'retired' (which is enterprise-only)", () => {
    expect(isTerminalLifecycle("archived")).toBe(true);
    // "retired" is not a RuntimeLifecycle at all (TypeScript would reject it at
    // compile time; the test below only confirms the runtime keys do not include it).
    expect(RUNTIME_LIFECYCLES).not.toContain("retired" as RuntimeLifecycle);
  });
});
