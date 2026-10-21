#!/usr/bin/env bun
/**
 * P13 read-only admission rehearsal runner.
 * Collects git + ledger + RELEASE_RECORD + optional LIVE, then evaluates the
 * in-process rehearsal pack. Never opens gates, rewrites the ledger, or
 * mints provenance tags.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refuseLocalProductionLedger } from "./external-production-ledger.ts";
import {
  evaluateDiagnosisProductionAdmission,
  renderDiagnosisProductionAdmissionMarkdown,
  type DiagnosisProductionAdmissionReport,
} from "./production-admission.ts";
import {
  provenanceShaForLiveCompare,
  resolvePeeledProvenanceTag,
} from "./production-provenance.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const SHA_IN_TEXT = /[0-9a-f]{40}/i;

type CliOptions = {
  liveSha?: string;
  jsonOut?: string;
  mdOut?: string;
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

function resolveLiveSha(injected?: string): string | null {
  if (injected) {
    return injected.trim().toLowerCase();
  }
  const fromEnv = process.env.OPENBOT_DIAGNOSIS_LIVE_SHA?.trim();
  if (fromEnv) {
    return fromEnv.toLowerCase();
  }
  const buildInfo = spawnSync(
    "podman",
    ["exec", "openbot-gateway-rc", "cat", "/app/dist/build-info.json"],
    { encoding: "utf8", timeout: 8_000 },
  );
  if (buildInfo.status === 0) {
    try {
      const parsed = JSON.parse(buildInfo.stdout) as { commit?: string };
      if (typeof parsed.commit === "string" && /^[0-9a-f]{40}$/i.test(parsed.commit)) {
        return parsed.commit.toLowerCase();
      }
    } catch {
      // fall through to unknown LIVE
    }
  }
  return null;
}

function writeIfRequested(filePath: string | undefined, contents: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

export async function runDiagnosisProductionAdmission(
  options: CliOptions = {},
): Promise<DiagnosisProductionAdmissionReport> {
  const candidateSha = git(["rev-parse", "HEAD"]);
  const originMainSha = git(["rev-parse", "origin/main"]);
  const liveSha = resolveLiveSha(options.liveSha);
  const releaseRecordSha = parseLatestCutoverSha(
    fs.readFileSync(path.join(repoRoot, "deploy/production/RELEASE_RECORD.md"), "utf8"),
  );
  const ledgerOpenShas = readOpenLedgerShas();
  const provenanceProbe = liveSha ?? ledgerOpenShas[0] ?? null;
  return evaluateDiagnosisProductionAdmission({
    candidateSha,
    originMainSha,
    liveSha,
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
  });
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDiagnosisProductionAdmission(options);
  const markdown = renderDiagnosisProductionAdmissionMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeIfRequested(options.jsonOut, json);
  writeIfRequested(options.mdOut, markdown);
  process.stdout.write(markdown);
  process.stdout.write("\n");
  process.stdout.write(json);
  process.exit(report.readyForIndependentApproval ? 0 : 2);
}
