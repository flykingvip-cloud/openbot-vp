import { describe, expect, it } from "vitest";
import type { GitRunner } from "./delivery/forward-guard.js";
import { evaluateCommitDeliveryGuard } from "./worktree-audit.js";

const live = "1".repeat(40);

function git(forward: boolean): GitRunner {
  return (args) => ({
    code: args[0] === "merge-base" && forward ? 0 : 1,
    stdout: "",
  });
}

describe("worktree audit delivery guard", () => {
  it("warns without blocking by default", () => {
    const result = evaluateCommitDeliveryGuard({
      liveSha: live,
      candidate: "HEAD",
      git: git(false),
    });

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Merge or rebase production");
  });

  it("blocks the same stale HEAD in strict mode", () => {
    const result = evaluateCommitDeliveryGuard({
      liveSha: live,
      candidate: "HEAD",
      git: git(false),
      strict: true,
    });

    expect(result.status).toBe("block");
    expect(result.exitCode).toBe(1);
  });

  it("does not change normal forward commit behavior", () => {
    expect(
      evaluateCommitDeliveryGuard({ liveSha: live, candidate: "HEAD", git: git(true) }),
    ).toEqual({ status: "allow", exitCode: 0, message: null });
  });

  it("silently skips unknown LIVE unless verbose", () => {
    expect(
      evaluateCommitDeliveryGuard({ liveSha: null, candidate: "HEAD", git: git(false) }),
    ).toEqual({ status: "skipped", exitCode: 0, message: null });
    expect(
      evaluateCommitDeliveryGuard({
        liveSha: null,
        candidate: "HEAD",
        git: git(false),
        verbose: true,
      }).message,
    ).toContain("skipped");
  });
});
