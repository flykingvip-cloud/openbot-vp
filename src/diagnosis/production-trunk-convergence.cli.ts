#!/usr/bin/env bun
/**
 * P15 trunk-convergence and identity-evidence runner.
 * Prefers the running container LIVE SHA, distinguishes ledger /
 * RELEASE_RECORD / provenance consistency, and writes a remint plan
 * without publishing tags or opening gates.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refuseLocalProductionLedger } from "./external-production-ledger.ts";
import type { DiagnosisLiveSource } from "./production-approval-freeze.ts";
import {
  provenanceShaForLiveCompare,
  resolvePeeledProvenanceTag,
} from "./production-provenance.ts";
import {
  evaluateDiagnosisTrunkConvergence,
  renderDiagnosisTrunkConvergenceMarkdown,
  type DiagnosisTrunkConvergenceReport,
} from "./production-trunk-convergence.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const SHA_IN_TEXT = /[0-9a-f]{40}/i;
const PRODUCTION_SSH_HOST = process.env.OPENBOT_PRODUCTION_SSH_HOST ?? "root@8.217.93.71";
const PRODUCTION_CONTAINER = process.env.OPENBOT_PRODUCTION_CONTAINER ?? "openbot-gateway-rc";

type CliOptions = {
  liveSha?: string;
  candidateSha?: string;
  pullRequestUrl?: string;
  jsonOut?: string;
  mdOut?: string;
};

function parseLatestCutover(markdown: string | null): {
  sha: string | null;
  observedAt: string | null;
} {
  if (!markdown) {
    return { sha: null, observedAt: null };
  }
  const latest = markdown.match(/## Latest cutover[^]*?(?=\n---|\n## |$)/i)?.[0] ?? "";
  const sourceRow = latest.split("\n").find((line) => /^\|\s*Source revision\s*\|/i.test(line));
  const dateRow = latest.split("\n").find((line) => /^\|\s*Date\s*\|/i.test(line));
  return {
    sha: sourceRow?.match(SHA_IN_TEXT)?.[0]?.toLowerCase() ?? null,
    observedAt: dateRow?.match(/`([^`]+)`/)?.[1] ?? null,
  };
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
      case "--pull-request-url":
        options.pullRequestUrl = value();
        break;
      case "--json-out":
        options.jsonOut = value();
        break;
      case "--md-out":
        options.mdOut = value();
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

function readOpenLedger(): { shas: string[]; notes: string; liveFrom: string | null } {
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
  observedAt: string | null;
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
    return { sha: container.sha, source: "container", observedAt: container.builtAt };
  }
  const requested = injected?.trim().toLowerCase();
  if (requested && /^[0-9a-f]{40}$/.test(requested)) {
    return { sha: requested, source: "injected", observedAt: null };
  }
  const fromEnv = process.env.OPENBOT_DIAGNOSIS_LIVE_SHA?.trim().toLowerCase();
  if (fromEnv && /^[0-9a-f]{40}$/.test(fromEnv)) {
    return { sha: fromEnv, source: "injected", observedAt: null };
  }
  return { sha: null, source: "unknown", observedAt: null };
}

function writeIfRequested(filePath: string | undefined, contents: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

export async function runDiagnosisTrunkConvergence(
  options: CliOptions = {},
): Promise<DiagnosisTrunkConvergenceReport> {
  const candidateSha = options.candidateSha?.trim().toLowerCase() || git(["rev-parse", "HEAD"]);
  const originMainSha = git(["rev-parse", "origin/main"]);
  const live = resolveLive(options.liveSha);
  const releaseRecord = parseLatestCutover(
    fs.readFileSync(path.join(repoRoot, "deploy/production/RELEASE_RECORD.md"), "utf8"),
  );
  const ledger = readOpenLedger();
  const provenanceProbe = live.sha ?? ledger.shas[0] ?? null;
  return evaluateDiagnosisTrunkConvergence({
    candidateSha,
    originMainSha,
    liveSha: live.sha,
    liveSource: live.source,
    liveObservedAt: live.observedAt,
    releaseRecordSha: releaseRecord.sha,
    releaseRecordObservedAt: releaseRecord.observedAt,
    ledgerOpenShas: ledger.shas,
    ledgerObservedAt: ledger.liveFrom,
    provenanceTagSha: resolveProvenanceSha(provenanceProbe),
    provenancePublishedAtCutover: !/no provenance-sha/i.test(ledger.notes),
    pullRequestUrl: options.pullRequestUrl,
    originMainIsAncestorOfCandidate: gitOk([
      "merge-base",
      "--is-ancestor",
      originMainSha,
      candidateSha,
    ]),
    liveIsAncestorOfCandidate: Boolean(
      live.sha && gitOk(["merge-base", "--is-ancestor", live.sha, candidateSha]),
    ),
    originMainContainsLive: Boolean(
      live.sha && gitOk(["merge-base", "--is-ancestor", live.sha, originMainSha]),
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
  });
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDiagnosisTrunkConvergence(options);
  const markdown = renderDiagnosisTrunkConvergenceMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeIfRequested(options.jsonOut, json);
  writeIfRequested(options.mdOut, markdown);
  process.stdout.write(markdown);
  process.stdout.write("\n");
  process.stdout.write(json);
  process.exit(report.readyForIndependentApproval ? 0 : 2);
}
