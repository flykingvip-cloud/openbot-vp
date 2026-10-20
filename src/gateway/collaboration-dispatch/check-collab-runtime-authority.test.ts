// @ts-nocheck — .mjs lint script has no declaration file.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCollabRuntimeAuthorityViolations,
  findCollabRuntimeAuthorityViolations,
  isHardRuleTarget,
  listRuntimeGlobMatches,
} from "../../../scripts/check-collab-runtime-authority.mjs";

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
    const result = await collectCollabRuntimeAuthorityViolations(
      path.resolve(__dirname, "../../.."),
    );
    expect(result.violations).toEqual([]);
    expect(result.hardTargets.some((p: string) => p.endsWith("round-runtime.ts"))).toBe(true);
    expect(result.hardTargets.some((p: string) => p.endsWith("task-runtime.ts"))).toBe(true);
  });
});
