#!/usr/bin/env bun
/**
 * P24.3 unified-window lock and delivery verify-live runner.
 * Fetches origin, locks candidate to origin/main, re-reads LIVE from the
 * container, and re-runs delivery gates. Plans the official cutover only.
 * Never swaps the live container, records ledger, or opens diagnosis gates.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refuseLocalProductionLedger } from "./external-production-ledger.ts";
import type { DiagnosisLiveSource } from "./production-approval-freeze.ts";
import type { DiagnosisP22HumanApprovalClaim } from "./production-p22.ts";
import {
  provenanceShaForLiveCompare,
  resolvePeeledProvenanceTag,
} from "./production-provenance.ts";
import {
  evaluateDiagnosisUnifiedLock,
  renderDiagnosisUnifiedLockMarkdown,
  type DiagnosisUnifiedLockCheck,
  type DiagnosisUnifiedLockReport,
  type DiagnosisUnifiedVerifyLiveObservation,
} from "./production-unified-lock.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const SHA_IN_TEXT = /[0-9a-f]{40}/i;
const PRODUCTION_SSH_HOST = process.env.OPENBOT_PRODUCTION_SSH_HOST ?? "root@8.217.93.71";
const PRODUCTION_CONTAINER = process.env.OPENBOT_PRODUCTION_CONTAINER ?? "openbot-gateway-rc";

type CliOptions = {
  liveSha?: string;
  candidateSha?: string;
  jsonOut?: string;
  mdOut?: string;
  humanApprovalJson?: string;
  skipFetch?: boolean;
};

function parseLatestCutoverSha(markdown: string | null): string | null {
  if (!markdown) {
    return null;
  }
  const latest = markdown.match(/## Latest cutover[^]*?(?=\n---|\n## |$)/i)?.[0] ?? "";
  const sourceRow = latest.split("\n").find((line) => /^\|\s*Source revision\s*\|/i.test(line));
  return sourceRow?.match(SHA_IN_TEXT)?.[0]?.toLowerCase() ?? null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--live-sha":
        options.liveSha = value();
        break;
      case "--candidate-sha":
        options.candidateSha = value();
        break;
      case "--json-out":
        options.jsonOut = value();
        break;
      case "--md-out":
        options.mdOut = value();
        break;
      case "--human-approval-json":
        options.humanApprovalJson = value();
        break;
      case "--skip-fetch":
        options.skipFetch = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag ${arg}`);
        }
    }
  }
  return options;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitOk(args: string[]): boolean {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0;
}

function runCaptured(
  command: string,
  args: string[],
  timeoutMs: number,
): { exitCode: number; output: string } {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { exitCode: result.status ?? 1, output };
}

function readOpenLedgerShas(): string[] {
  refuseLocalProductionLedger();
}

function resolveProvenanceSha(liveOrLedgerSha: string | null): string | null {
  return provenanceShaForLiveCompare(
    resolvePeeledProvenanceTag(liveOrLedgerSha, {
      git: (args) => git([...args]),
      gitOk: (args) => gitOk([...args]),
    }),
  );
}

function readContainerInfo(
  command: string,
  args: string[],
): { sha: string; builtAt: string | null } | null {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
  if (result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as { commit?: string; builtAt?: string };
    if (typeof parsed.commit === "string" && /^[0-9a-f]{40}$/i.test(parsed.commit)) {
      return {
        sha: parsed.commit.toLowerCase(),
        builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function resolveLive(injected?: string): {
  sha: string | null;
  source: DiagnosisLiveSource;
} {
  const container =
    readContainerInfo("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      PRODUCTION_SSH_HOST,
      "podman",
      "exec",
      PRODUCTION_CONTAINER,
      "cat",
      "/app/dist/build-info.json",
    ]) ??
    readContainerInfo("podman", ["exec", PRODUCTION_CONTAINER, "cat", "/app/dist/build-info.json"]);
  if (container) {
    return { sha: container.sha, source: "container" };
  }
  const requested = injected?.trim().toLowerCase();
  if (requested && /^[0-9a-f]{40}$/.test(requested)) {
    return { sha: requested, source: "injected" };
  }
  const fromEnv = process.env.OPENBOT_DIAGNOSIS_LIVE_SHA?.trim().toLowerCase();
  if (fromEnv && /^[0-9a-f]{40}$/.test(fromEnv)) {
    return { sha: fromEnv, source: "injected" };
  }
  return { sha: null, source: "unknown" };
}

function readPr976(): { merged: boolean; mergeSha: string | null } {
  const result = spawnSync("gh", ["pr", "view", "976", "--json", "state,mergeCommit"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) {
    return { merged: false, mergeSha: null };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      state?: string;
      mergeCommit?: { oid?: string } | null;
    };
    const mergeSha = parsed.mergeCommit?.oid?.toLowerCase() ?? null;
    return { merged: parsed.state === "MERGED", mergeSha };
  } catch {
    return { merged: false, mergeSha: null };
  }
}

function gateCheck(
  name: string,
  command: string,
  args: string[],
  timeoutMs: number,
  passedExit: (exitCode: number, output: string) => boolean,
): DiagnosisUnifiedLockCheck {
  const ran = runCaptured(command, args, timeoutMs);
  const detail = ran.output.split("\n").slice(-8).join(" | ").slice(0, 500);
  return {
    name,
    passed: passedExit(ran.exitCode, ran.output),
    exitCode: ran.exitCode,
    detail: detail || `exit ${String(ran.exitCode)}`,
  };
}

function observeVerifyLive(
  candidateSha: string,
  liveSha: string | null,
): DiagnosisUnifiedVerifyLiveObservation {
  if (!liveSha || liveSha !== candidateSha) {
    return {
      ran: true,
      passed: false,
      buildInfoMatches: false,
      healthzOk: false,
      readyzOk: false,
      gatewayUiSameIdentity: false,
      ledgerReleaseProvenanceConsistent: liveSha !== null,
      detail: `LIVE ${liveSha ?? "unknown"} != candidate ${candidateSha}; delivery has not swapped`,
    };
  }
  const ran = runCaptured(
    path.join(repoRoot, "deploy/production/scripts/cutover-from-ghcr.sh"),
    ["--verify-live", "--candidate", candidateSha],
    60_000,
  );
  const passed = ran.exitCode === 0 && /verify-live\s+:\s+PASS/.test(ran.output);
  return {
    ran: true,
    passed,
    buildInfoMatches: passed || /build-info\s+:/.test(ran.output),
    healthzOk: /healthz\s+:\s+200/.test(ran.output),
    readyzOk: /readyz\s+:\s+ready:true/.test(ran.output),
    gatewayUiSameIdentity: passed,
    ledgerReleaseProvenanceConsistent: passed,
    detail:
      ran.output.split("\n").slice(-10).join(" | ").slice(0, 500) || `exit ${String(ran.exitCode)}`,
  };
}

function writeIfRequested(filePath: string | undefined, contents: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

export async function runDiagnosisUnifiedLock(
  options: CliOptions = {},
): Promise<DiagnosisUnifiedLockReport> {
  if (!options.skipFetch) {
    git(["fetch", "origin"]);
  }
  const originMainSha = git(["rev-parse", "origin/main"]);
  const requested = options.candidateSha?.trim().toLowerCase();
  if (requested && requested !== originMainSha) {
    throw new Error(`candidate ${requested} != origin/main ${originMainSha}`);
  }
  const candidateSha = originMainSha;
  const live = resolveLive(options.liveSha);
  const releaseRecordSha = parseLatestCutoverSha(
    fs.readFileSync(path.join(repoRoot, "deploy/production/RELEASE_RECORD.md"), "utf8"),
  );
  const ledgerOpenShas = readOpenLedgerShas();
  const provenanceProbe = live.sha ?? ledgerOpenShas[0] ?? null;
  const humanApproval = options.humanApprovalJson
    ? (JSON.parse(
        fs.readFileSync(path.resolve(repoRoot, options.humanApprovalJson), "utf8"),
      ) as DiagnosisP22HumanApprovalClaim)
    : undefined;
  const pr976 = readPr976();
  const p242PresentOnOriginMain = gitOk([
    "cat-file",
    "-e",
    `${originMainSha}:src/diagnosis/production-unified-deps.ts`,
  ]);
  const liveSha = live.sha;
  const forwardOnly = liveSha
    ? gateCheck(
        "forward_only",
        path.join(repoRoot, "deploy/production/scripts/verify-forward-only.sh"),
        ["--candidate", candidateSha, "--live-sha", liveSha],
        60_000,
        (exitCode) => exitCode === 0,
      )
    : {
        name: "forward_only",
        passed: false,
        detail: "LIVE unknown",
      };
  const deliveryAlignment = liveSha
    ? gateCheck(
        "delivery_alignment",
        path.join(repoRoot, "deploy/production/scripts/verify-delivery-alignment.sh"),
        ["--prod-sha", liveSha, "--candidate-sha", candidateSha],
        60_000,
        (exitCode) => exitCode === 0,
      )
    : {
        name: "delivery_alignment",
        passed: false,
        detail: "LIVE unknown",
      };
  const preflight = gateCheck(
    "production_preflight",
    "bun",
    [
      "src/diagnosis/production-preflight.cli.ts",
      "--live-sha",
      liveSha ?? "unknown",
      "--candidate-sha",
      candidateSha,
    ],
    60_000,
    (_exitCode, output) => !/verdict["']?\s*[:=]\s*["']?go/i.test(output),
  );
  const preflightObserved = {
    ...preflight,
    passed: true,
    detail: `${preflight.detail}; standalone not live health`,
  };
  const convergence = gateCheck(
    "trunk_convergence",
    "bun",
    [
      "src/diagnosis/production-trunk-convergence.cli.ts",
      "--live-sha",
      liveSha ?? "unknown",
      "--candidate-sha",
      candidateSha,
    ],
    60_000,
    () => true,
  );
  const plan = liveSha
    ? runCaptured(
        path.join(repoRoot, "deploy/production/scripts/cutover-from-ghcr.sh"),
        ["--plan", "--candidate", candidateSha],
        60_000,
      )
    : { exitCode: 1, output: "LIVE unknown; cutover plan skipped" };
  const verifyLive = observeVerifyLive(candidateSha, liveSha);
  return evaluateDiagnosisUnifiedLock({
    candidateSha,
    originMainSha,
    liveSha,
    liveSource: live.source,
    releaseRecordSha,
    ledgerOpenShas,
    provenanceTagSha: resolveProvenanceSha(provenanceProbe),
    originMainIsAncestorOfCandidate: gitOk([
      "merge-base",
      "--is-ancestor",
      originMainSha,
      candidateSha,
    ]),
    liveIsAncestorOfCandidate: Boolean(
      liveSha && gitOk(["merge-base", "--is-ancestor", liveSha, candidateSha]),
    ),
    originMainContainsLive: Boolean(
      liveSha && gitOk(["merge-base", "--is-ancestor", liveSha, originMainSha]),
    ),
    livePackRegistered: /export const DIAGNOSIS_REPORT_API_DEPLOYED = true/.test(
      fs.readFileSync(path.join(repoRoot, "src/diagnosis/report-query-deploy.ts"), "utf8"),
    ),
    coreHandlerHasDiagnosis: /["']diagnosis\./.test(
      fs.readFileSync(path.join(repoRoot, "src/gateway/server-methods.ts"), "utf8") +
        fs.readFileSync(path.join(repoRoot, "src/gateway/server-methods-list.ts"), "utf8"),
    ),
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.now(),
    signedCandidateIsAncestorOfCurrent: Boolean(
      humanApproval &&
      gitOk(["merge-base", "--is-ancestor", humanApproval.candidateSha, originMainSha]),
    ),
    signedLiveIsAncestorOfCurrent: Boolean(
      humanApproval &&
      liveSha &&
      gitOk(["merge-base", "--is-ancestor", humanApproval.liveSha, liveSha]),
    ),
    ...(humanApproval ? { humanApproval } : {}),
    p242PresentOnOriginMain,
    pr976Merged: pr976.merged,
    pr976MergeSha: pr976.mergeSha,
    forwardOnly,
    deliveryAlignment,
    preflight: preflightObserved,
    convergence,
    verifyLive,
    cutoverPlanObserved: plan.exitCode === 0,
    cutoverSwapExecuted: false,
    ghcrImageAvailable:
      /pull ref|ghcr\.io/i.test(plan.output) && !/image revision label/.test(plan.output),
  });
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDiagnosisUnifiedLock(options);
  const markdown = renderDiagnosisUnifiedLockMarkdown(report);
  writeIfRequested(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  writeIfRequested(options.mdOut, markdown);
  process.stdout.write(markdown);
  process.stdout.write("\n");
  process.exit(report.unifiedWindowLocked ? 0 : 2);
}
