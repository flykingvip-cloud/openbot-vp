// @vitest-environment node
/**
 * Property-based tests for scope visibility and install constraints.
 *
 * - Property 7: Scope-based visibility
 * - Property 8: Install constraint validation
 *
 * Validates: Requirements 8.1, 8.9, 8.2, 8.3, 8.12, 6.4
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import type {
  AssetLifecycle,
  EnterpriseHealthStatus,
} from "../../../capability/enterprise-capability/types.ts";
import { canInstallCapability, validateInstallTarget } from "../install-rules.ts";
import type { InstallTarget } from "../install-rules.ts";
import { isCapabilityVisibleToEmployee } from "../visibility-rules.ts";

// --- Arbitraries ---

const lifecycleArb: fc.Arbitrary<AssetLifecycle> = fc.constantFrom(
  "submitted",
  "reviewing",
  "approved",
  "published",
  "deprecated",
  "retired",
);

const healthArb: fc.Arbitrary<EnterpriseHealthStatus> = fc.constantFrom(
  "效果稳定",
  "偶尔结果不理想",
  "建议重新整理",
  "已不适合继续推广",
);

const nonEmptyStringArb = fc.string({ minLength: 1 });
const groupIdsArb = fc.array(fc.string({ minLength: 1 }));
const roleIdsArb = fc.array(fc.string({ minLength: 1 }));

// --- Property 7: Scope-based visibility ---

describe("Property 7: Scope-based visibility", () => {
  it('scope "enterprise" → visible to ALL employees', () => {
    /**
     * **Validates: Requirements 8.1**
     */
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        groupIdsArb,
        roleIdsArb,
        (employeeId, departmentId, groupIds, roleIds) => {
          const scope = { kind: "enterprise" as const };
          const employee = { employeeId, departmentId, groupIds, roleIds };
          expect(isCapabilityVisibleToEmployee(scope, employee)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('scope "department" with id X → visible only when employee.departmentId === X', () => {
    /**
     * **Validates: Requirements 8.1, 8.9**
     */
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        groupIdsArb,
        roleIdsArb,
        (scopeId, employeeId, departmentId, groupIds, roleIds) => {
          const scope = { kind: "department" as const, id: scopeId, name: "dept" };
          const employee = { employeeId, departmentId, groupIds, roleIds };
          const result = isCapabilityVisibleToEmployee(scope, employee);
          expect(result).toBe(departmentId === scopeId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('scope "group" with id X → visible only when X ∈ employee.groupIds', () => {
    /**
     * **Validates: Requirements 8.1, 8.9**
     */
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        groupIdsArb,
        roleIdsArb,
        (scopeId, employeeId, departmentId, groupIds, roleIds) => {
          const scope = { kind: "group" as const, id: scopeId, name: "grp" };
          const employee = { employeeId, departmentId, groupIds, roleIds };
          const result = isCapabilityVisibleToEmployee(scope, employee);
          expect(result).toBe(groupIds.includes(scopeId));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('scope "role" with id X → visible only when X ∈ employee.roleIds', () => {
    /**
     * **Validates: Requirements 8.1, 8.9**
     */
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        groupIdsArb,
        roleIdsArb,
        (scopeId, employeeId, departmentId, groupIds, roleIds) => {
          const scope = { kind: "role" as const, id: scopeId, name: "role" };
          const employee = { employeeId, departmentId, groupIds, roleIds };
          const result = isCapabilityVisibleToEmployee(scope, employee);
          expect(result).toBe(roleIds.includes(scopeId));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 8: Install constraint validation ---

describe("Property 8: Install constraint validation", () => {
  it("(a) lifecycle !== 'published' → canInstallCapability returns { ok: false }", () => {
    /**
     * **Validates: Requirements 8.2, 8.3**
     */
    const nonPublishedLifecycleArb: fc.Arbitrary<Exclude<AssetLifecycle, "published">> =
      fc.constantFrom("submitted", "reviewing", "approved", "deprecated", "retired");

    fc.assert(
      fc.property(nonPublishedLifecycleArb, healthArb, (lifecycle, healthStatus) => {
        const result = canInstallCapability({ lifecycle, healthStatus });
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('(b) healthStatus === "已不适合继续推广" → canInstallCapability returns { ok: false }', () => {
    /**
     * **Validates: Requirements 8.12**
     */
    fc.assert(
      fc.property(lifecycleArb, (lifecycle) => {
        const result = canInstallCapability({
          lifecycle,
          healthStatus: "已不适合继续推广",
        });
        // If lifecycle is not published, it fails on lifecycle check first.
        // If lifecycle IS published, it fails on health check.
        // Either way, ok must be false.
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('(c) lifecycle === "published" AND healthStatus !== "已不适合继续推广" → canInstallCapability returns { ok: true }', () => {
    /**
     * **Validates: Requirements 8.2, 8.3**
     */
    const nonBlockedHealthArb: fc.Arbitrary<Exclude<EnterpriseHealthStatus, "已不适合继续推广">> =
      fc.constantFrom("效果稳定", "偶尔结果不理想", "建议重新整理");

    fc.assert(
      fc.property(nonBlockedHealthArb, (healthStatus) => {
        const result = canInstallCapability({ lifecycle: "published", healthStatus });
        expect(result.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('(d) target kind !== "robot" → validateInstallTarget returns { ok: false }', () => {
    /**
     * **Validates: Requirements 6.4**
     */
    const nonRobotKindArb: fc.Arbitrary<Exclude<InstallTarget["kind"], "robot">> = fc.constantFrom(
      "employee",
      "department",
      "group",
    );

    fc.assert(
      fc.property(nonRobotKindArb, (kind) => {
        const result = validateInstallTarget({ kind });
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('(e) target kind === "robot" with non-empty robotId → validateInstallTarget returns { ok: true }', () => {
    /**
     * **Validates: Requirements 6.4**
     */
    fc.assert(
      fc.property(nonEmptyStringArb, (robotId) => {
        // Ensure robotId is not just whitespace
        fc.pre(robotId.trim().length > 0);
        const result = validateInstallTarget({ kind: "robot", robotId });
        expect(result.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('(f) target kind === "robot" with empty robotId → validateInstallTarget returns { ok: false }', () => {
    /**
     * **Validates: Requirements 6.4**
     */
    const emptyRobotIdArb = fc.constantFrom("", "   ", "\t", "\n", "  \t\n  ");

    fc.assert(
      fc.property(emptyRobotIdArb, (robotId) => {
        const result = validateInstallTarget({ kind: "robot", robotId });
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
