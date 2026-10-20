#!/usr/bin/env bun
/**
 * P21 isolated pre-production dependency and SLO runner.
 * candidate must equal freshly fetched origin/main. LIVE comes from the
 * running container (or --live-sha). Never opens gates, rewrites the
 * ledger, or mints provenance tags.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGNOSIS_P21_TENANT,
  evaluateDiagnosisProductionP21,
  renderDiagnosisP21DependenciesMarkdown,
  renderDiagnosisP21SloMarkdown,
  renderDiagnosisProductionP21Markdown,
  type DiagnosisProductionP21Report,
} from "./production-p21.ts";
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
  depsJsonOut?: string;
  depsMdOut?: string;
  sloJsonOut?: string;
  sloMdOut?: string;
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
      case "--deps-json-out":
        options.depsJsonOut = value();
        break;
      case "--deps-md-out":
        options.depsMdOut = value();
        break;
      case "--slo-json-out":
        options.sloJsonOut = value();
        break;
      case "--slo-md-out":
        options.sloMdOut = value();
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
  const text = fs.readFileSync(path.join(repoRoot, "deploy/production/releases.jsonl"), "utf8");
  const open: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const row = JSON.parse(trimmed) as { gatewaySha?: string; liveTo?: string };
    if (typeof row.gatewaySha === "string" && row.liveTo === undefined) {
      open.push(row.gatewaySha);
    }
  }
  return open;
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

export async function runDiagnosisProductionP21(
  options: CliOptions = {},
): Promise<DiagnosisProductionP21Report> {
  const originMainSha = git(["rev-parse", "origin/main"]);
  const candidateSha = options.candidateSha?.trim().toLowerCase() || originMainSha;
  const liveSha = resolveLiveSha(options.liveSha);
  const releaseRecordSha = parseLatestCutoverSha(
    fs.readFileSync(path.join(repoRoot, "deploy/production/RELEASE_RECORD.md"), "utf8"),
  );
  const ledgerOpenShas = readOpenLedgerShas();
  const provenanceProbe = liveSha ?? ledgerOpenShas[0] ?? null;
  return evaluateDiagnosisProductionP21({
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
  const report = await runDiagnosisProductionP21(options);
  const markdown = renderDiagnosisProductionP21Markdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const depsJson = `${JSON.stringify(
    {
      increment: report.increment,
      schemaVersion: report.schemaVersion,
      kind: "isolated_preprod_dependency_snapshot",
      productionWrite: false,
      verified: report.dependenciesVerified,
      recordedAt: report.recordedAt,
      dependencies: report.dependencies,
    },
    null,
    2,
  )}\n`;
  const sloJson = `${JSON.stringify(
    {
      increment: report.increment,
      schemaVersion: report.schemaVersion,
      kind: "isolated_preprod_slo_snapshot",
      mustNotTreatAsLiveTraffic: true,
      recordedAt: report.recordedAt,
      window: {
        from: report.sloObservations[0]?.windowFrom ?? null,
        to: report.recordedAt,
      },
      source: {
        id: "isolated_preprod_rehearsal",
        authority: "in_process_injected_backends",
        not: "live diagnosis query path",
      },
      sampling: {
        scope: report.sloObservations[0]?.sampleScope ?? "none",
      },
      tenant: {
        trustedSource: "server_membership_only",
        observedTenantId: DIAGNOSIS_P21_TENANT,
      },
      observations: Object.fromEntries(
        report.sloObservations.map((row) => [
          row.metric,
          {
            source: row.source,
            windowFrom: row.windowFrom,
            windowTo: row.windowTo,
            sampleScope: row.sampleScope,
            tenantScope: row.tenantScope,
            observed: row.observed,
          },
        ]),
      ),
      slo: report.slo,
      sloHealthy: report.slo.completeness === "complete",
      renderedHealth: report.observabilityHealth,
      readyForIndependentApproval: report.readyForIndependentApproval,
    },
    null,
    2,
  )}\n`;
  writeIfRequested(options.jsonOut, json);
  writeIfRequested(options.mdOut, markdown);
  writeIfRequested(options.depsJsonOut, depsJson);
  writeIfRequested(options.depsMdOut, renderDiagnosisP21DependenciesMarkdown(report.dependencies));
  writeIfRequested(options.sloJsonOut, sloJson);
  writeIfRequested(options.sloMdOut, renderDiagnosisP21SloMarkdown(report));
  process.stdout.write(markdown);
  process.stdout.write("\n");
  process.exit(report.readyForIndependentApproval ? 0 : 2);
}
