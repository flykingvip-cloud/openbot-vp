import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decideDelivery,
  detectRegressedPaths,
  isForwardOnly,
  type GitRunner,
} from "./forward-guard.js";

type Fixture = {
  root: string;
  base: string;
  live: string;
  forward: string;
  diverged: string;
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function commitAll(root: string, message: string): string {
  git(root, "add", ".");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-forward-guard-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Delivery Guard Test");
  git(root, "config", "user.email", "delivery-guard@example.invalid");
  write(root, "README.md", "base\n");
  const base = commitAll(root, "base");

  git(root, "checkout", "-qb", "live");
  write(root, "src/gateway/user-modeling/tenant-membership.ts", "export const live = true;\n");
  const live = commitAll(root, "e860bba1b0 equivalent live");
  write(root, "src/forward.ts", "export const forward = true;\n");
  const forward = commitAll(root, "forward candidate");

  git(root, "checkout", "-qb", "candidate", base);
  write(root, "src/older-user-modeling.ts", "export const older = true;\n");
  const diverged = commitAll(root, "0b47c51bfe equivalent candidate");

  return { root, base, live, forward, diverged };
}

function runner(cwd: string): GitRunner {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return {
      code: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

describe("delivery forward guard", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture(): Fixture {
    const created = createFixture();
    roots.push(created.root);
    return created;
  }

  it("allows a candidate that contains LIVE", () => {
    const f = fixture();
    const gitRunner = runner(f.root);

    expect(isForwardOnly(f.live, f.forward, gitRunner)).toBe(true);
    expect(
      decideDelivery({
        live: f.live,
        candidate: f.forward,
        protectedGlobs: ["src/**"],
        git: gitRunner,
      }).verdict,
    ).toBe("allow");
  });

  it("blocks a candidate behind LIVE", () => {
    const f = fixture();
    const decision = decideDelivery({
      live: f.live,
      candidate: f.base,
      protectedGlobs: ["src/**"],
      git: runner(f.root),
    });

    expect(decision.verdict).toBe("block");
    expect(decision.forwardOnly).toBe(false);
  });

  it("blocks a candidate that diverges from LIVE", () => {
    const f = fixture();

    expect(
      decideDelivery({
        live: f.live,
        candidate: f.diverged,
        protectedGlobs: ["src/**"],
        git: runner(f.root),
      }).verdict,
    ).toBe("block");
  });

  it("detects deleted protected files", () => {
    const f = fixture();

    expect(
      detectRegressedPaths(f.live, f.diverged, {
        protectedGlobs: ["src/**"],
        git: runner(f.root),
      }).deleted,
    ).toContain("src/gateway/user-modeling/tenant-membership.ts");
  });

  it("fails closed when LIVE is unknown", () => {
    const decision = decideDelivery({
      live: null,
      candidate: "candidate",
      protectedGlobs: ["src/**"],
      git: () => ({ code: 1, stdout: "" }),
    });

    expect(decision.verdict).toBe("block");
    expect(decision.liveKnown).toBe(false);
  });

  it("allows unknown LIVE only through the explicit override", () => {
    expect(
      decideDelivery({
        live: null,
        candidate: "candidate",
        protectedGlobs: ["src/**"],
        git: () => ({ code: 1, stdout: "" }),
        allowUnknownLive: true,
      }).verdict,
    ).toBe("allow");
  });

  it("allows and records an intentional revert", () => {
    const f = fixture();
    const decision = decideDelivery({
      live: f.live,
      candidate: f.diverged,
      protectedGlobs: ["src/**"],
      git: runner(f.root),
      intentionalRevert: "restore last known good release",
    });

    expect(decision.verdict).toBe("allow");
    expect(decision.intentionalRevert).toEqual({
      approved: true,
      reason: "restore last known good release",
    });
  });

  it("blocks the e860bba1b0 vs 0b47c51bfe equivalent fixture", () => {
    const f = fixture();
    const decision = decideDelivery({
      live: f.live,
      candidate: f.diverged,
      protectedGlobs: ["src/**"],
      git: runner(f.root),
    });

    expect(decision.verdict).toBe("block");
    expect(decision.regressions.deleted).toContain(
      "src/gateway/user-modeling/tenant-membership.ts",
    );
  });
});
