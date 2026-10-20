// CLI: produce a retirement plan for branches against the elected baseline.
//
// Plan-only, on purpose. This tool never deletes anything: it emits the retirement ledger plus
// the exact commands to run. On 2026-07-27 a containment check that looked correct was wrong
// (`git log --all` silently includes `refs/stash`, so stashes matched each other) and acting on
// it would have destroyed 20 unique snapshots. The judgement is the dangerous part, so it gets
// reviewed before anything is destroyed.
//
// Usage:
//   pnpm delivery:retire:plan [--baseline origin/main] [--out plan.md]

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { GitRunner } from "./forward-guard.ts";
import {
  buildRetirePlan,
  renderRetirementLedger,
  type RefCandidate,
  type RetireContext,
} from "./retire.ts";

const gitRunner: GitRunner = (args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function lines(command: string, args: string[]): string[] {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function collectWorktreeHeld(): Set<string> {
  const held = new Set<string>();
  for (const line of lines("git", ["worktree", "list", "--porcelain"])) {
    if (line.startsWith("branch ")) {
      held.add(line.slice("branch refs/heads/".length));
    }
  }
  return held;
}

function collectPrReferenced(): Set<string> {
  const raw = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "headRefName,baseRefName",
      "--jq",
      ".[]|.headRefName,.baseRefName",
    ],
    { encoding: "utf8" },
  );
  if ((raw.status ?? 1) !== 0) {
    console.warn("warning: could not list open PRs; PR guard is inactive for this plan");
    return new Set();
  }
  return new Set(
    (raw.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function collectCandidates(): RefCandidate[] {
  const candidates: RefCandidate[] = [];
  for (const name of lines("git", ["branch", "--format=%(refname:short)"])) {
    candidates.push({ name, kind: "local-branch", rev: name });
  }
  for (const short of lines("git", ["branch", "-r", "--format=%(refname:short)"])) {
    if (short.endsWith("/HEAD")) {
      continue;
    }
    const name = short.startsWith("origin/") ? short.slice("origin/".length) : short;
    candidates.push({ name, kind: "remote-branch", rev: short });
  }
  return candidates;
}

function main(): number {
  const baseline = argValue("--baseline", "origin/main");
  const out = argValue("--out", "");
  const isoDate = new Date().toISOString();

  if (gitRunner(["rev-parse", "--verify", baseline]).code !== 0) {
    console.error(`baseline ${baseline} does not resolve`);
    return 2;
  }

  const context: RetireContext = {
    baseline,
    worktreeHeld: collectWorktreeHeld(),
    prReferenced: collectPrReferenced(),
    // The trunk and the branch production still ships from are never retirement candidates.
    protectedNames: new Set(["main", "release/baseline-recovery-20260725"]),
  };

  const plan = buildRetirePlan(collectCandidates(), context, gitRunner, isoDate);
  const rendered = renderRetirementLedger(plan, isoDate);

  if (out !== "") {
    writeFileSync(out, rendered, "utf8");
    console.log(`wrote ${out}`);
  } else {
    console.log(rendered);
  }

  console.log("Nothing was deleted. To act on this plan:");
  console.log(
    "  archive first:  git tag -a <archive tag> <ref> -m '<reason>' && git push origin <archive tag>",
  );
  console.log("  local branch:   git branch -D <name>   (or git update-ref -d refs/heads/<name>)");
  console.log("  remote branch:  git push origin :refs/heads/<name>");
  return 0;
}

process.exit(main());
