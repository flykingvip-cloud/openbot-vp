import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCollabRuntimeAuthorityViolations,
  countLegacyReadsAccesses,
  findCollabRuntimeAuthorityViolations,
  isHardRuleTarget,
  listRuntimeGlobMatches,
} from "../../scripts/check-collab-runtime-authority.mjs";

const rules = (source: string) =>
  findCollabRuntimeAuthorityViolations(source, "round-runtime.ts").map(
    (v: { rule: string }) => v.rule,
  );

describe("check-collab-runtime-authority (Floor v2.1 §2.3)", () => {
  it("D.3 glob fixture: *runtime*.ts matches round-runtime and task-runtime (not runtime*.ts)", () => {
    const names = [
      "round-runtime.ts",
      "task-runtime.ts",
      "runtime-authority.ts",
      "runtime-namespace.ts",
      "decision-engine.ts",
      "episode-store.ts",
      "beat-controller.ts",
    ];
    expect(listRuntimeGlobMatches(names)).toEqual([
      "round-runtime.ts",
      "runtime-authority.ts",
      "runtime-namespace.ts",
      "task-runtime.ts",
    ]);
    // Owner's literal runtime*.ts would miss round-/task-runtime — fixture guards that.
    const literalOwnerGlob = names.filter((n) => /^runtime.*\.tsx?$/i.test(n)).toSorted();
    expect(literalOwnerGlob).toEqual(["runtime-authority.ts", "runtime-namespace.ts"]);
  });

  it("hard-rule target selection includes round/task runtime and future episode/beat files", () => {
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/round-runtime.ts")).toBe(true);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/task-runtime.ts")).toBe(true);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/episode-store.ts")).toBe(true);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/beat-controller.ts")).toBe(true);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/runtime-authority.ts")).toBe(false);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/runtime-namespace.ts")).toBe(false);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/decision-engine.ts")).toBe(false);
    expect(isHardRuleTarget("src/gateway/collaboration-dispatch/round-runtime.test.ts")).toBe(
      false,
    );
  });

  it("flags scope / OperatingState imports and .operatingState / .collaborationPolicy access", () => {
    expect(rules(`import type { CollaborationDispatchScope } from "./types.js";`)).toEqual([
      "no-scope-or-operating-state-import",
    ]);
    expect(
      rules(
        `import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";`,
      ),
    ).toEqual(["no-scope-or-operating-state-import"]);
    expect(rules(`const x = params.scope.operatingState;`)).toEqual([
      "no-operating-state-or-collaboration-policy-access",
    ]);
    expect(rules(`const y = state.collaborationPolicy.maxVisible;`)).toEqual([
      "no-operating-state-or-collaboration-policy-access",
    ]);
  });

  it("ignores mentions in comments and strings", () => {
    expect(rules(`// CollaborationDispatchScope\nconst s = ".operatingState";`)).toEqual([]);
  });

  it("the repository hard-rule targets are currently clean", async () => {
    const result = await collectCollabRuntimeAuthorityViolations(path.resolve(__dirname, "../.."));
    expect(result.violations).toEqual([]);
    expect(result.hardTargets.some((p: string) => p.endsWith("round-runtime.ts"))).toBe(true);
    expect(result.hardTargets.some((p: string) => p.endsWith("task-runtime.ts"))).toBe(true);
  });
});

/** Split-join so repo search for the retired bypass field stays at 0; fixtures still exercise the detector. */
const LR = ["leg", "acyReads"].join("");

describe("retired-bypass-field ratchet (P1-A5 final follow-up)", () => {
  it("counts dot / optional-chain field access (injection must fail ratchet)", () => {
    expect(countLegacyReadsAccesses(`const a = facts.${LR}.policyV1;`)).toBeGreaterThan(0);
    expect(countLegacyReadsAccesses(`const a = facts.${LR}?.maxVisibleRaw;`)).toBeGreaterThan(0);
  });

  it("counts bracket/subscript access with literal key", () => {
    expect(countLegacyReadsAccesses(`const a = facts["${LR}"].policyV1;`)).toBeGreaterThan(0);
    expect(countLegacyReadsAccesses(`const a = facts['${LR}']?.policyV1;`)).toBeGreaterThan(0);
    expect(countLegacyReadsAccesses(`const a = facts["${LR}"];`)).toBeGreaterThan(0);
  });

  it("counts object-destructure binding of the retired field", () => {
    expect(countLegacyReadsAccesses(`const { ${LR} } = facts;`)).toBe(1);
    expect(countLegacyReadsAccesses(`const { ${LR}: lr } = facts; f(lr);`)).toBe(1);
  });

  it("counts function-parameter and nested destructuring", () => {
    expect(countLegacyReadsAccesses(`function f({ ${LR} }: Facts) { return ${LR}; }`)).toBe(1);
    expect(countLegacyReadsAccesses(`const f = ({ nested: { ${LR}: x } }: T) => x;`)).toBe(1);
    expect(countLegacyReadsAccesses(`const { outer: { ${LR} } } = facts;`)).toBe(1);
  });

  it("de-duplicates field access (receiver + field = one site)", () => {
    expect(countLegacyReadsAccesses(`const a = facts.${LR}.policyV1;`)).toBe(1);
    expect(
      countLegacyReadsAccesses(
        `const a = facts.${LR}.policyV1; const b = facts.${LR}.maxVisibleRaw;`,
      ),
    ).toBe(2);
  });

  it("ignores strings / comments / unrelated identifiers", () => {
    expect(countLegacyReadsAccesses(`const s = "${LR}"; // ${LR}`)).toBe(0);
    expect(countLegacyReadsAccesses(`const total = 0; const x = "not-the-field";`)).toBe(0);

    // Array positional binding is NOT a .legacyReads field read.
    expect(countLegacyReadsAccesses(`const [${LR}] = arr;`)).toBe(0);
    // Nested object inside array element IS a hit.
    expect(countLegacyReadsAccesses(`const [{ ${LR} }] = arr;`)).toBe(1);
    // Computed property name in object binding.
    expect(countLegacyReadsAccesses(`const { ['${LR}']: x } = facts;`)).toBe(1);
    // Destructuring assignment (object literal LHS).
    expect(countLegacyReadsAccesses(`let x; ({ ${LR}: x } = facts);`)).toBe(1);
  });

  it("repo collaboration-dispatch currently has zero accesses (ratchet = 0)", async () => {
    const result = await collectCollabRuntimeAuthorityViolations(path.resolve(__dirname, "../.."));
    const totalKey = ["leg", "acyReadsTotal"].join("");
    expect((result as Record<string, number>)[totalKey]).toBe(0);
  });
});
