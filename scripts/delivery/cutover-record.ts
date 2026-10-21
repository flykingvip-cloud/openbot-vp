// Atomic production cutover recorder: close the previous open interval, append a
// schemaVersion:2 row, audit the proposed ledger, and refuse the write if audit
// would fail. Replaces hand-appended v1 JSONL lines in cutover-from-ghcr.sh.

import { spawnSync } from "node:child_process";
import { renameSync, writeFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { GitRunner } from "./forward-guard.ts";
import {
  externalLedgerMessage,
  isLocalProductionLedgerPath,
  LOCAL_LEDGER_PATH,
} from "./ledger-location.ts";
import {
  auditLedger,
  closeLiveInterval,
  isSha256Digest,
  parseLedger,
  type ArtifactKind,
  type LedgerFinding,
  type ReleaseRow,
} from "./ledger.ts";

export const DEFAULT_LEDGER_PATH = LOCAL_LEDGER_PATH;

export type CutoverRecordInput = {
  gatewaySha: string;
  uiSha: string;
  buildMode: string;
  artifactKind: ArtifactKind;
  artifactId: string;
  artifactDigest: string;
  tag: string;
  liveFrom: string;
  evidence: string;
  executor: string;
  baseImageTag?: string;
  baseImageDigest?: string;
  notes?: string;
  imageTag?: string;
  regressionAcknowledged?: string;
  /** true when the writer observed the running container (verify-live PASS). */
  liveVerified?: boolean;
  /** Explicit escape: reason this row is recorded without a live observation. */
  unverifiedBackfill?: string;
};

export type CutoverRecordResult = {
  ok: boolean;
  seq?: number;
  closedSeq?: number;
  text?: string;
  errors: string[];
  findings: LedgerFinding[];
};

export function serializeV2Row(row: ReleaseRow): string {
  const out: Record<string, unknown> = {
    schemaVersion: 2,
    seq: row.seq,
    gatewaySha: row.gatewaySha,
    uiSha: row.uiSha,
    buildMode: row.buildMode,
    artifactKind: row.artifactKind,
    artifactId: row.artifactId,
    artifactDigest: row.artifactDigest,
  };
  if (row.artifactKind === "dist-overlay") {
    out.baseImageTag = row.baseImageTag;
    out.baseImageDigest = row.baseImageDigest;
  }
  out.tag = row.tag;
  if (row.imageTag) {
    out.imageTag = row.imageTag;
  }
  out.liveFrom = row.liveFrom;
  if (row.liveTo) {
    out.liveTo = row.liveTo;
  }
  out.evidence = row.evidence;
  out.executor = row.executor;
  if (row.notes) {
    out.notes = row.notes;
  }
  // Include false explicitly so unverified backfills are visible in the ledger.
  if (row.liveVerified !== undefined) {
    out.liveVerified = row.liveVerified;
  }
  if (row.regressionAcknowledged) {
    out.regressionAcknowledged = row.regressionAcknowledged;
  }
  return JSON.stringify(out);
}

function fail(errors: string[], findings: LedgerFinding[] = []): CutoverRecordResult {
  return { ok: false, errors, findings };
}

function validateInput(input: CutoverRecordInput): string[] {
  const missing: string[] = [];
  const required: Array<keyof CutoverRecordInput> = [
    "gatewaySha",
    "uiSha",
    "buildMode",
    "artifactKind",
    "artifactId",
    "artifactDigest",
    "tag",
    "liveFrom",
    "evidence",
    "executor",
  ];
  for (const key of required) {
    if (!input[key]) {
      missing.push(key);
    }
  }
  if (input.artifactKind !== "image" && input.artifactKind !== "dist-overlay") {
    return [...missing, "artifactKind must be image or dist-overlay"];
  }
  if (!isSha256Digest(input.artifactDigest)) {
    missing.push("artifactDigest (sha256:<64-hex>)");
  }
  if (input.artifactKind === "dist-overlay") {
    if (!input.baseImageTag) {
      missing.push("baseImageTag");
    }
    if (!isSha256Digest(input.baseImageDigest)) {
      missing.push("baseImageDigest (sha256:<64-hex>)");
    }
  }
  const errors = missing.map((key) => `missing ${key}`);
  const backfill = input.unverifiedBackfill?.trim() ?? "";
  if (input.liveVerified === true && backfill) {
    errors.push("--live-verified and --unverified-backfill are mutually exclusive");
  } else if (input.liveVerified !== true && !backfill) {
    errors.push(
      "--live-verified (or --unverified-backfill <reason>) is required; operator-only identity writes are refused",
    );
  }
  return errors;
}

function nextSeq(rows: ReleaseRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}

function rewriteClosedRow(originalLine: string, liveTo: string): string {
  const parsed = JSON.parse(originalLine) as ReleaseRow;
  return JSON.stringify(closeLiveInterval(parsed, liveTo));
}

function applyCloseAndAppend(
  originalText: string,
  closeSeq: number | undefined,
  liveTo: string,
  newRow: ReleaseRow,
): string {
  const lines = originalText.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) {
      out.push(line);
      continue;
    }
    const parsed = JSON.parse(trimmed) as { seq?: number; liveTo?: string };
    if (closeSeq !== undefined && parsed.seq === closeSeq && parsed.liveTo === undefined) {
      out.push(rewriteClosedRow(trimmed, liveTo));
    } else {
      out.push(line);
    }
  }
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  out.push(serializeV2Row(newRow));
  return `${out.join("\n")}\n`;
}

/** Pure: close the previous open row, append a v2 row, audit. Does not write. */
export function prepareCutoverRecord(
  text: string,
  input: CutoverRecordInput,
  git: GitRunner,
): CutoverRecordResult {
  const inputErrors = validateInput(input);
  if (inputErrors.length > 0) {
    return fail(inputErrors);
  }

  const { rows, errors } = parseLedger(text);
  if (errors.length > 0) {
    return fail(errors.map((error) => `line ${error.line}: ${error.message}`));
  }

  const open = rows.filter((row) => row.liveTo === undefined);
  if (open.length > 1) {
    return fail([
      `${open.length} rows omit liveTo (seq ${open.map((row) => row.seq).join(", ")}); repair the ledger before recording a cutover`,
    ]);
  }

  const closed = open[0];
  const seq = nextSeq(rows);
  const liveVerified = input.liveVerified === true;
  let notes = input.notes;
  if (!liveVerified) {
    const reason = (input.unverifiedBackfill ?? "").trim();
    const backfillNote = `unverified-backfill: ${reason}`;
    notes = notes?.trim() ? `${notes.trim()}; ${backfillNote}` : backfillNote;
  }
  const newRow: ReleaseRow = {
    schemaVersion: 2,
    seq,
    gatewaySha: input.gatewaySha,
    uiSha: input.uiSha,
    buildMode: input.buildMode,
    artifactKind: input.artifactKind,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    tag: input.tag,
    liveFrom: input.liveFrom,
    evidence: input.evidence,
    executor: input.executor,
    imageTag: input.imageTag ?? (input.artifactKind === "image" ? input.artifactId : undefined),
    baseImageTag: input.baseImageTag,
    baseImageDigest: input.baseImageDigest,
    notes,
    liveVerified,
    regressionAcknowledged: input.regressionAcknowledged,
  };

  const proposedRows = rows.map((row) =>
    closed && row.seq === closed.seq ? closeLiveInterval(row, input.liveFrom) : row,
  );
  proposedRows.push(newRow);

  const audit = auditLedger(proposedRows, git);
  const errorFindings = audit.findings.filter((finding) => finding.severity === "error");
  if (errorFindings.length > 0) {
    return fail(
      errorFindings.map((finding) => `seq ${finding.seq} [${finding.code}] ${finding.message}`),
      audit.findings,
    );
  }

  const nextText = applyCloseAndAppend(text, closed?.seq, input.liveFrom, newRow);
  return {
    ok: true,
    seq,
    closedSeq: closed?.seq,
    text: nextText,
    errors: [],
    findings: audit.findings,
  };
}

export function writeCutoverRecord(
  ledgerPath: string,
  input: CutoverRecordInput,
  git: GitRunner,
): CutoverRecordResult {
  // The openbot-vp default path was the duplicated production ledger. Appending here
  // would recreate a second SoT. Callers that still need the writer pass an explicit
  // non-production path (tests, or a checkout of the OHBE ledger).
  if (isLocalProductionLedgerPath(ledgerPath)) {
    return fail([externalLedgerMessage()]);
  }
  let text: string;
  try {
    text = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    return fail([`cannot read ledger at ${ledgerPath}: ${(error as Error).message}`]);
  }
  const prepared = prepareCutoverRecord(text, input, git);
  if (!prepared.ok || prepared.text === undefined) {
    return prepared;
  }
  const tmpPath = `${ledgerPath}.tmp`;
  writeFileSync(tmpPath, prepared.text, "utf8");
  renameSync(tmpPath, ledgerPath);
  return prepared;
}

export function createGitRunner(cwd = process.cwd()): GitRunner {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

type ParsedArgs = CutoverRecordInput & { ledgerPath: string };

function takeValue(args: string[], index: number, flag: string): { value: string; index: number } {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, index: index + 1 };
}

export function parseCutoverArgs(args: string[]): ParsedArgs {
  const parsed: Partial<CutoverRecordInput> & { ledgerPath: string } = {
    ledgerPath: DEFAULT_LEDGER_PATH,
    uiSha: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    switch (arg) {
      case "--gateway-sha": {
        const next = takeValue(args, index, arg);
        parsed.gatewaySha = next.value;
        index = next.index;
        break;
      }
      case "--ui-sha": {
        const next = takeValue(args, index, arg);
        parsed.uiSha = next.value;
        index = next.index;
        break;
      }
      case "--build-mode": {
        const next = takeValue(args, index, arg);
        parsed.buildMode = next.value;
        index = next.index;
        break;
      }
      case "--artifact-kind": {
        const next = takeValue(args, index, arg);
        parsed.artifactKind = next.value as ArtifactKind;
        index = next.index;
        break;
      }
      case "--artifact-id": {
        const next = takeValue(args, index, arg);
        parsed.artifactId = next.value;
        index = next.index;
        break;
      }
      case "--artifact-digest": {
        const next = takeValue(args, index, arg);
        parsed.artifactDigest = next.value;
        index = next.index;
        break;
      }
      case "--tag": {
        const next = takeValue(args, index, arg);
        parsed.tag = next.value;
        index = next.index;
        break;
      }
      case "--live-from": {
        const next = takeValue(args, index, arg);
        parsed.liveFrom = next.value;
        index = next.index;
        break;
      }
      case "--evidence": {
        const next = takeValue(args, index, arg);
        parsed.evidence = next.value;
        index = next.index;
        break;
      }
      case "--executor": {
        const next = takeValue(args, index, arg);
        parsed.executor = next.value;
        index = next.index;
        break;
      }
      case "--base-image-tag": {
        const next = takeValue(args, index, arg);
        parsed.baseImageTag = next.value;
        index = next.index;
        break;
      }
      case "--base-image-digest": {
        const next = takeValue(args, index, arg);
        parsed.baseImageDigest = next.value;
        index = next.index;
        break;
      }
      case "--notes": {
        const next = takeValue(args, index, arg);
        parsed.notes = next.value;
        index = next.index;
        break;
      }
      case "--ledger": {
        const next = takeValue(args, index, arg);
        parsed.ledgerPath = next.value;
        index = next.index;
        break;
      }
      case "--image-tag": {
        const next = takeValue(args, index, arg);
        parsed.imageTag = next.value;
        index = next.index;
        break;
      }
      case "--intentional-revert": {
        const next = takeValue(args, index, arg);
        parsed.regressionAcknowledged = next.value;
        index = next.index;
        break;
      }
      case "--live-verified": {
        parsed.liveVerified = true;
        break;
      }
      case "--unverified-backfill": {
        const next = takeValue(args, index, arg);
        parsed.unverifiedBackfill = next.value;
        index = next.index;
        break;
      }
      case "--":
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!parsed.uiSha && parsed.gatewaySha) {
    parsed.uiSha = parsed.gatewaySha;
  }
  if (!parsed.liveFrom) {
    parsed.liveFrom = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (parsed.liveVerified === true && parsed.unverifiedBackfill) {
    throw new Error("--live-verified and --unverified-backfill are mutually exclusive");
  }
  return parsed as ParsedArgs;
}

const HELP = `pnpm delivery:cutover:record — atomically close the previous LIVE row and append a v2 row.

The production ledger is OHBE, not deploy/production/releases.jsonl in this repo:
  https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl
This command refuses that default path. Pass --ledger only for a non-production file
(for example a checkout of the OHBE ledger).

Usage:
  pnpm delivery:cutover:record -- --ledger <path-outside-openbot-vp> \\
    --gateway-sha <sha> --build-mode full-dist \\
    --artifact-kind image --artifact-id <tag> --artifact-digest sha256:<64-hex> \\
    --tag provenance/sha-<12> --evidence <text> --executor <id> \\
    --live-verified

Identity gate (M0b):
  --live-verified                 writer observed the running container (verify-live PASS)
  --unverified-backfill <reason>  explicit escape to record an unverified row (liveVerified=false)
  Exactly one of the two is required. Both together is an error.

Refuses the write if the proposed ledger would fail pnpm delivery:ledger:audit.
`;

function printAudit(result: CutoverRecordResult): void {
  const errorFindings = result.findings.filter((finding) => finding.severity === "error");
  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  if (result.ok) {
    console.log(
      `ledger: recorded seq ${result.seq}${result.closedSeq !== undefined ? `, closed seq ${result.closedSeq}` : ""}`,
    );
  }
  console.log(`ledger: ${errorFindings.length} errors, ${warnings.length} warnings`);
  for (const finding of errorFindings) {
    console.error(`  ERROR seq ${finding.seq} [${finding.code}] ${finding.message}`);
  }
  for (const error of result.errors) {
    if (!errorFindings.some((finding) => error.includes(finding.message))) {
      console.error(`  ERROR ${error}`);
    }
  }
  for (const finding of warnings) {
    console.log(`  warn  seq ${finding.seq} [${finding.code}] ${finding.message}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    process.exitCode = 0;
    return;
  }
  let parsed: ParsedArgs;
  try {
    parsed = parseCutoverArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "help") {
      process.stdout.write(HELP);
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`${message}\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  const { ledgerPath, ...input } = parsed;
  const result = writeCutoverRecord(ledgerPath, input as CutoverRecordInput, createGitRunner());
  printAudit(result);
  process.exitCode = result.ok ? 0 : 30;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
