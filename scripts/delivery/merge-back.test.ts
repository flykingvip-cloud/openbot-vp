import { describe, expect, it } from "vitest";
import { createMergeBackPlan, resolveMergeBackArgs } from "./merge-back.js";

describe("merge-back plan", () => {
  it("defaults the SoT branch to main, not the frozen recovery branch", () => {
    const args = resolveMergeBackArgs(["--cutover-sha", "a".repeat(40)]);
    expect(args).toEqual({ cutoverSha: "a".repeat(40), sotBranch: "main" });
    expect(
      createMergeBackPlan({ cutoverSha: args.cutoverSha!, sotBranch: args.sotBranch }).commands,
    ).toContain("git fetch origin main");
    expect(resolveMergeBackArgs(["--sot-branch", "release/x"]).sotBranch).toBe("release/x");
  });

  it("produces reviewable commands without executing or force-pushing", () => {
    const plan = createMergeBackPlan({
      cutoverSha: "a".repeat(40),
      sotBranch: "release/baseline-recovery-20260725",
    });

    expect(plan.reviewBranch).toBe("merge-back/aaaaaaaaaaaa");
    expect(plan.commands).toContain("git merge --no-ff aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(plan.commands.join("\n")).not.toContain("--force");
    expect(plan.commands.join("\n")).not.toContain("push origin release/baseline");
  });

  it("rejects branch and SHA injection", () => {
    expect(() =>
      createMergeBackPlan({ cutoverSha: "not-a-sha", sotBranch: "release/main" }),
    ).toThrow("cutover SHA");
    expect(() =>
      createMergeBackPlan({ cutoverSha: "a".repeat(40), sotBranch: "main; rm -rf" }),
    ).toThrow("invalid SoT branch");
  });
});
