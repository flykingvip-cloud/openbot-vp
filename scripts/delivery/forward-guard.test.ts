import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decideDelivery,
  detectRegressedPaths,
  isForwardOnly,
  classifyAncestry,
  objectExists,
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

describe("classifyAncestry", () => {
  it("returns missing-object when a tip is absent", () => {
    const git = ((args: string[]) => {
      if (args[0] === "cat-file" && args[1] === "-t") {
        return {
          code: args[2] === "missing" ? 128 : 0,
          stdout: args[2] === "missing" ? "" : "commit\n",
        };
      }
      return { code: 1, stdout: "" };
    }) as import("./forward-guard.js").GitRunner;
    expect(objectExists("present", git)).toBe(true);
    expect(classifyAncestry("missing", "present", git).kind).toBe("missing-object");
  });
});

describe("classifyAncestry real git fixtures", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function runGit(cwd: string, args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  }

  function gitRunner(cwd: string): GitRunner {
    return (args) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    };
  }

  it("real git: shallow non-ancestor stays incomplete-graph (even with merge-base)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-classify-shallow-"));
    dirs.push(root);
    runGit(root, ["init", "-b", "main"]);
    runGit(root, ["config", "user.email", "test@example.com"]);
    runGit(root, ["config", "user.name", "test"]);
    // Local clones need an identified HEAD branch for fetch.
    runGit(root, ["config", "receive.denyCurrentBranch", "ignore"]);
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    runGit(root, ["add", "a.txt"]);
    runGit(root, ["commit", "-m", "root"]);

    runGit(root, ["checkout", "-b", "side"]);
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");
    runGit(root, ["add", "b.txt"]);
    runGit(root, ["commit", "-m", "side"]);
    const sideSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    runGit(root, ["checkout", "main"]);
    fs.writeFileSync(path.join(root, "c.txt"), "c\n");
    runGit(root, ["add", "c.txt"]);
    runGit(root, ["commit", "-m", "mainline"]);
    const mainSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const shallow = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-classify-shallow-clone-"));
    dirs.push(shallow);
    execFileSync("git", ["clone", "--depth=1", root, shallow], { stdio: "ignore" });
    execFileSync("git", ["fetch", "--depth=1", "origin", sideSha], {
      cwd: shallow,
      stdio: "ignore",
    });

    const git = gitRunner(shallow);
    const shallowFlag = git(["rev-parse", "--is-shallow-repository"]);
    expect(shallowFlag.stdout.trim()).toBe("true");
    // Even if merge-base resolves, shallow must not adjudicate regression.
    const mb = git(["merge-base", sideSha, mainSha]);
    void mb;
    const verdict = classifyAncestry(sideSha, mainSha, git);
    expect(verdict.kind).toBe("incomplete-graph");
  });

  it("real git: full non-ancestor is regression", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-classify-full-"));
    dirs.push(root);
    runGit(root, ["init", "-b", "main"]);
    runGit(root, ["config", "user.email", "test@example.com"]);
    runGit(root, ["config", "user.name", "test"]);
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    runGit(root, ["add", "a.txt"]);
    runGit(root, ["commit", "-m", "root"]);

    runGit(root, ["checkout", "-b", "side"]);
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");
    runGit(root, ["add", "b.txt"]);
    runGit(root, ["commit", "-m", "side"]);
    const sideSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    runGit(root, ["checkout", "main"]);
    fs.writeFileSync(path.join(root, "c.txt"), "c\n");
    runGit(root, ["add", "c.txt"]);
    runGit(root, ["commit", "-m", "mainline"]);
    const mainSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const git = gitRunner(root);
    expect(classifyAncestry(sideSha, mainSha, git).kind).toBe("regression");
  });

  it("real git: missing tip is missing-object", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-classify-missing-"));
    dirs.push(root);
    runGit(root, ["init", "-b", "main"]);
    runGit(root, ["config", "user.email", "test@example.com"]);
    runGit(root, ["config", "user.name", "test"]);
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    runGit(root, ["add", "a.txt"]);
    runGit(root, ["commit", "-m", "root"]);
    const tip = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const git = gitRunner(root);
    const missing = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    expect(classifyAncestry(missing, tip, git).kind).toBe("missing-object");
  });
});
