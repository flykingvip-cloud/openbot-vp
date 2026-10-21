#!/usr/bin/env bun
/**
 * P24.7 report API enablement runner.
 * candidate must equal freshly fetched origin/main. LIVE comes from the
 * running container (or --live-sha). Exact SHA match only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refuseLocalProductionLedger } from "./external-production-ledger.ts";
import {
  evaluateDiagnosisProductionP24_7,
  renderDiagnosisProductionP24_7Markdown,
  type DiagnosisP24_7HumanEnablementClaim,
  type DiagnosisProductionP24_7Report,
} from "./production-p24.7.ts";
import {
  provenanceShaForLiveCompare,
  resolvePeeledProvenanceTag,
} from "./production-provenance.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const SHA_IN_TEXT = /[0-9a-f]{40}/i;

type CliOptions = {
  liveSha?: string;
  candidateSha?: string;
  jsonOut?: string;
  mdOut?: string;
  humanEnablementJson?: string;
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
      case "--human-enablement-json":
        options.humanEnablementJson = value();
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

function resolveLiveSha(injected?: string): string | null {
  if (injected) {
    return injected.trim().toLowerCase();
  }
  const fromEnv = process.env.OPENBOT_DIAGNOSIS_LIVE_SHA?.trim();
  return fromEnv ? fromEnv.toLowerCase() : null;
}

function writeIfRequested(filePath: string | undefined, contents: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

export async function runDiagnosisProductionP24_7(
  options: CliOptions = {},
): Promise<DiagnosisProductionP24_7Report> {
  const originMainSha = git(["rev-parse", "origin/main"]);
  const candidateSha = options.candidateSha?.trim().toLowerCase() || originMainSha;
  const liveSha = resolveLiveSha(options.liveSha);
  const releaseRecordSha = parseLatestCutoverSha(
    fs.readFileSync(path.join(repoRoot, "deploy/production/RELEASE_RECORD.md"), "utf8"),
  );
  const ledgerOpenShas = readOpenLedgerShas();
  const humanEnablement = options.humanEnablementJson
    ? (JSON.parse(
        fs.readFileSync(path.resolve(repoRoot, options.humanEnablementJson), "utf8"),
      ) as DiagnosisP24_7HumanEnablementClaim)
    : undefined;
  return evaluateDiagnosisProductionP24_7({
    candidateSha,
    originMainSha,
    liveSha,
    liveSource: liveSha ? "container" : "unknown",
    releaseRecordSha,
    ledgerOpenShas,
    provenanceTagSha: provenanceShaForLiveCompare(
      resolvePeeledProvenanceTag(liveSha ?? ledgerOpenShas[0] ?? null, {
        git: (args) => git([...args]),
        gitOk: (args) => gitOk([...args]),
      }),
    ),
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
    ...(humanEnablement ? { humanEnablement } : {}),
  });
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDiagnosisProductionP24_7(options);
  const markdown = renderDiagnosisProductionP24_7Markdown(report);
  writeIfRequested(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  writeIfRequested(options.mdOut, markdown);
  process.stdout.write(markdown);
  process.stdout.write("\n");
  process.exit(report.humanEnablementRecorded ? 0 : 2);
}
