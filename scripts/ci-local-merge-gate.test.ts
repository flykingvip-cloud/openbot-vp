import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_SRC = join(import.meta.dirname, "ci-local-merge-gate.sh");

type Harness = {
  root: string;
  repo: string;
  bare: string;
  bin: string;
  script: string;
  cleanup: () => void;
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Real git topology + stubbed pnpm/node so we exercise the shell gate's
 * resolve/ancestry/result paths without running the heavy absolute checks.
 *
 * Timeline:
 * 1. origin/main at main-1
 * 2. work clone at main-1, branch feature from it
 * 3. origin/main advances to main-2 (not an ancestor of feature until merged)
 */
function buildHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "ci-local-merge-gate-"));
  const bare = join(root, "origin.git");
  const seed = join(root, "seed");
  const repo = join(root, "work");
  const bin = join(root, "bin");
  mkdirSync(bin);

  execFileSync("git", ["init", "--bare", bare], { encoding: "utf8" });
  execFileSync("git", ["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"], {
    encoding: "utf8",
  });

  mkdirSync(seed);
  git(seed, "init", "--quiet");
  git(seed, "config", "user.email", "gate-test@example.com");
  git(seed, "config", "user.name", "gate-test");
  git(seed, "checkout", "-b", "main");
  writeFileSync(join(seed, "README"), "main-1\n");
  git(seed, "add", "README");
  git(seed, "commit", "--quiet", "-m", "main-1");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-u", "origin", "main");

  execFileSync("git", ["clone", "--quiet", "-b", "main", bare, repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "gate-test@example.com");
  git(repo, "config", "user.name", "gate-test");
  git(repo, "checkout", "-b", "feature");
  writeFileSync(join(repo, "feat.txt"), "feature\n");
  git(repo, "add", "feat.txt");
  git(repo, "commit", "--quiet", "-m", "feature");

  writeFileSync(join(seed, "README"), "main-2\n");
  git(seed, "add", "README");
  git(seed, "commit", "--quiet", "-m", "main-2");
  git(seed, "push", "origin", "main");

  mkdirSync(join(repo, "scripts"), { recursive: true });
  const script = join(repo, "scripts", "ci-local-merge-gate.sh");
  copyFileSync(SCRIPT_SRC, script);
  chmodSync(script, 0o755);
  // Keep the worktree clean so result=passed is reachable in the happy path.
  git(repo, "add", "scripts/ci-local-merge-gate.sh");
  git(repo, "commit", "--quiet", "-m", "add gate script under test");

  for (const name of ["pnpm", "node"] as const) {
    const path = join(bin, name);
    writeFileSync(path, '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "${AUDIT_LOG:?}"\nexit 0\n');
    chmodSync(path, 0o755);
  }

  const gitWrapper = join(bin, "git");
  writeFileSync(
    gitWrapper,
    `#!/bin/sh
REAL_GIT="\${GATE_REAL_GIT:-/usr/bin/git}"
if [ "\${GATE_GIT_FETCH_FAIL:-0}" = "1" ] && [ "$1" = "fetch" ]; then
  printf '%s\\n' "git $*" >> "\${AUDIT_LOG:?}"
  exit 1
fi
exec "$REAL_GIT" "$@"
`,
  );
  chmodSync(gitWrapper, 0o755);

  return {
    root,
    repo,
    bare,
    bin,
    script,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const harnesses: Harness[] = [];
afterEach(() => {
  while (harnesses.length) {
    harnesses.pop()?.cleanup();
  }
});

function runGate(
  h: Harness,
  args: string[],
  envExtra: Record<string, string> = {},
): { status: number | null; out: string; log: string } {
  const auditLog = join(h.root, `audit-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
  writeFileSync(auditLog, "");
  const whichGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const env = {
    ...process.env,
    PATH: `${h.bin}:${process.env.PATH ?? ""}`,
    AUDIT_LOG: auditLog,
    GATE_REAL_GIT: whichGit,
    OPENBOT_TEST_PROFILE: "low",
    ...envExtra,
  };
  const r = spawnSync("bash", [h.script, ...args], {
    cwd: h.repo,
    env,
    encoding: "utf8",
  });
  return {
    status: r.status,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    log: execFileSync("cat", [auditLog], { encoding: "utf8" }),
  };
}

describe("ci-local-merge-gate.sh", () => {
  it("blocks when git fetch origin main fails (exit 3, no later tools)", () => {
    const h = buildHarness();
    harnesses.push(h);
    const r = runGate(h, [], { GATE_GIT_FETCH_FAIL: "1" });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/result=blocked/);
    expect(r.log).not.toMatch(/(^|\/)(pnpm|node) /);
  });

  it("blocks when freshly fetched origin/main is not an ancestor even if --base is an old main tip", () => {
    const h = buildHarness();
    harnesses.push(h);
    const parent = git(h.repo, "rev-parse", "HEAD^");
    const r = runGate(h, ["--base", parent, "--candidate", "HEAD"]);
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/result=blocked/);
    expect(r.out).toMatch(/origin\/main/);
    expect(r.log).not.toMatch(/(^|\/)(pnpm|node) /);
  });

  it("reports result=partial (not passed) when --skip-absolute and lists skipped checks", () => {
    const h = buildHarness();
    harnesses.push(h);
    git(h.repo, "fetch", "origin", "main");
    git(h.repo, "merge", "--quiet", "origin/main", "-m", "sync main");
    const r = runGate(h, ["--skip-absolute", "--base", "origin/main", "--candidate", "HEAD"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/result=partial/);
    expect(r.out).toMatch(/pnpm check:host-env-policy:swift/);
    expect(r.out).toMatch(/pnpm format:check/);
    expect(r.out).not.toMatch(/result=passed/);
    expect(r.out).not.toMatch(/substitute passed/);
  });

  it("reports result=passed only when absolute gates run and checkout matches candidate on fresh main", () => {
    const h = buildHarness();
    harnesses.push(h);
    git(h.repo, "fetch", "origin", "main");
    git(h.repo, "merge", "--quiet", "origin/main", "-m", "sync main");
    const r = runGate(h, ["--base", "origin/main", "--candidate", "HEAD"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/result=passed/);
    expect(r.out).not.toMatch(/result=partial/);
    expect(r.log).toMatch(/pnpm /);
  });
});
