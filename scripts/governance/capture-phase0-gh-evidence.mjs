#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * Capture Phase 0 governance gh evidence into offline JSON packs.
 * Runs in CI (GITHUB_TOKEN) or locally; official-review verifies offline
 * when the local authorization layer returns 503.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = "gmood2008/openbot";
const RULESET_ID = "19808307";

function runGh(args) {
  const command = `gh ${args.join(" ")}`;
  try {
    const stdout = execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { command, stdout, exitCode: 0 };
  } catch (err) {
    const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    return {
      command,
      stdout: stdout || stderr,
      exitCode: typeof err.status === "number" ? err.status : 1,
    };
  }
}

function withParsed(entry, parser = (v) => v) {
  let parsed = null;
  if (entry.stdout) {
    try {
      parsed = parser(JSON.parse(entry.stdout));
    } catch {
      parsed = null;
    }
  }
  return {
    ...entry,
    stdoutSha256: createHash("sha256").update(entry.stdout).digest("hex"),
    parsed,
  };
}

function latestSuccessfulRun(workflowFile, branch = "main") {
  const { stdout } = runGh([
    "run",
    "list",
    "--repo",
    REPO,
    "--workflow",
    workflowFile,
    "--branch",
    branch,
    "--limit",
    "5",
    "--json",
    "databaseId,conclusion,headSha,event,createdAt",
  ]);
  const runs = JSON.parse(stdout || "[]");
  return runs.find((r) => r.conclusion === "success") ?? runs[0] ?? null;
}

function buildPack({ reviewSequence, purpose, capturedBy }) {
  const mainEntry = withParsed(
    runGh([
      "api",
      `repos/${REPO}/commits/main`,
      "--jq",
      "{sha,message:.commit.message,date:.commit.committer.date}",
    ]),
  );
  const mainSha = mainEntry.parsed?.sha ?? "";

  const specs = [
    { id: "main-commit", ...mainEntry },
    {
      id: "pr409-view",
      ...withParsed(
        runGh([
          "pr",
          "view",
          "409",
          "--repo",
          REPO,
          "--json",
          "state,mergedAt,mergeCommit,reviewDecision,reviews,statusCheckRollup",
        ]),
      ),
    },
    {
      id: "pr409-checks",
      ...runGh(["pr", "checks", "409", "--repo", REPO]),
    },
    {
      id: "pr401-view",
      ...withParsed(
        runGh([
          "pr",
          "view",
          "401",
          "--repo",
          REPO,
          "--json",
          "state,mergedAt,mergeCommit,reviewDecision,reviews,headRefOid,statusCheckRollup",
        ]),
      ),
    },
    {
      id: "pr401-checks",
      ...runGh(["pr", "checks", "401", "--repo", REPO]),
    },
    {
      id: "pr414-view",
      ...withParsed(
        runGh([
          "pr",
          "view",
          "414",
          "--repo",
          REPO,
          "--json",
          "state,mergedAt,mergeCommit,reviewDecision,reviews,headRefOid",
        ]),
      ),
    },
    {
      id: "pr414-checks",
      ...runGh(["pr", "checks", "414", "--repo", REPO]),
    },
    {
      id: "ruleset-19808307",
      ...withParsed(
        runGh([
          "api",
          `repos/${REPO}/rulesets/${RULESET_ID}`,
          "--jq",
          "{name,enforcement,updated_at,rules}",
        ]),
      ),
    },
    {
      id: "actions-runners",
      ...withParsed(runGh(["api", `repos/${REPO}/actions/runners`])),
    },
  ];

  const ciGateRun = latestSuccessfulRun("ci-gate.yml");
  const freezeRun = latestSuccessfulRun("memory-workspace-freeze.yml");
  if (ciGateRun?.databaseId) {
    specs.push({
      id: "main-ci-gate-latest",
      ...withParsed(
        runGh([
          "run",
          "view",
          String(ciGateRun.databaseId),
          "--repo",
          REPO,
          "--json",
          "conclusion,headSha,event,jobs",
        ]),
      ),
    });
  }
  if (freezeRun?.databaseId) {
    specs.push({
      id: "main-freeze-latest",
      ...withParsed(
        runGh([
          "run",
          "view",
          String(freezeRun.databaseId),
          "--repo",
          REPO,
          "--json",
          "conclusion,headSha,event,jobs",
        ]),
      ),
    });
  }

  return {
    schema: "memory-workspace-phase0-offline-gh-evidence-pack/v1",
    evidenceId: `memory-workspace-phase0-${reviewSequence === 25 ? "20260816-r25" : "20260814"}`,
    reviewSequence,
    mainSha,
    capturedAt: new Date().toISOString(),
    capturedBy,
    captureHost:
      process.env.GITHUB_ACTIONS === "true"
        ? `github-actions:${process.env.GITHUB_RUN_ID ?? "unknown"}`
        : "execution-team-local",
    captureProvenance:
      process.env.GITHUB_ACTIONS === "true" ? "github-actions-ci" : "execution-team-local",
    githubRunUrl: process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    purpose,
    companionEvidence: ["docs/design/evidence/memory-workspace-phase0-runner-stability-r25.json"],
    commands: specs,
    governance: {
      phase0Accepted: false,
      deployAuthorized: false,
      closesWsC: false,
      decision: "PENDING_REVIEW_25",
    },
    verificationNote:
      "503-bypass: official-review runs node docs/design/evidence/memory-workspace-phase0-offline-governance-verify.mjs (no gh).",
  };
}

function parseArgs(argv) {
  const out = {
    reviewSequence: 25,
    output: "docs/design/evidence/memory-workspace-phase0-offline-gh-evidence-pack-r25.json",
    capturedBy: process.env.GITHUB_ACTOR ?? "cursor-memory-wsc",
    purpose: "CI/automation capture for 503-bypass offline governance verification",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--review-sequence") {
      out.reviewSequence = Number(argv[++i]);
    } else if (arg === "--output") {
      out.output = argv[++i];
    } else if (arg === "--captured-by") {
      out.capturedBy = argv[++i];
    } else if (arg === "--purpose") {
      out.purpose = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const pack = buildPack({
  reviewSequence: args.reviewSequence,
  purpose: args.purpose,
  capturedBy: args.capturedBy,
});

const outPath = path.resolve(args.output);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`);
console.log(`Wrote ${outPath} mainSha=${pack.mainSha} commands=${pack.commands.length}`);
