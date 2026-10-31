// Generate / check the managed current-identity block in RELEASE_RECORD.md
// from deploy/production/releases.jsonl (Path B machine SoT).
//
// Scope distinction (intentional):
// - Passing generate/check proves **ledger ↔ human-doc consistency** only.
// - It does **NOT** prove the running container identity was reconciled
//   (that remains a separate LIVE verify / SSH / check-sot --live-sha path).
//
// Modes:
// - generate (--write): upsert the marked block; leave historical prose untouched.
// - check (default): compare the marked block to the unique open ledger tip; never write.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseLedger, type ReleaseRow } from "./ledger.ts";

export const BEGIN_MARKER = "<!-- BEGIN GENERATED: current-identity -->";
export const END_MARKER = "<!-- END GENERATED: current-identity -->";

export const DEFAULT_LEDGER_PATH = "deploy/production/releases.jsonl";
export const DEFAULT_RELEASE_RECORD_PATH = "deploy/production/RELEASE_RECORD.md";

/** Exit: ledger/doc inconsistent or unusable (fail-closed). */
export const EXIT_DRIFT = 20;
/** Exit: usage / I/O failure. */
export const EXIT_USAGE = 2;

export type OpenTip = {
  seq: number;
  gatewaySha: string;
  uiSha: string;
  artifactDigest: string | null;
  imageTag: string | null;
  artifactId: string | null;
  tag: string | null;
  liveFrom: string;
  liveVerified: boolean | null;
};

export type ResolveOpenTipFailureCode =
  | "parse-error"
  | "zero-open"
  | "multi-open"
  | "missing-fields";

export type ResolveOpenTipResult =
  | { ok: true; tip: OpenTip }
  | {
      ok: false;
      code: ResolveOpenTipFailureCode;
      message: string;
      openSeqs: number[];
    };

export type ParsedGeneratedIdentity = {
  seq: number | null;
  gatewaySha: string | null;
  uiSha: string | null;
  artifactDigest: string | null;
  imageTag: string | null;
  artifactId: string | null;
  tag: string | null;
  liveFrom: string | null;
  liveTo: string | null;
  liveVerified: boolean | null;
};

export type ConsistencyCheckResult =
  | { ok: true; tip: OpenTip; reasons: string[] }
  | { ok: false; tip: OpenTip | null; reasons: string[] };

const FULL_SHA = /^[0-9a-f]{40}$/i;

function tipFromRow(row: ReleaseRow): OpenTip | { error: string } {
  if (typeof row.seq !== "number" || !Number.isFinite(row.seq)) {
    return { error: `open row missing seq` };
  }
  if (typeof row.gatewaySha !== "string" || !FULL_SHA.test(row.gatewaySha)) {
    return { error: `open seq ${row.seq} missing/invalid gatewaySha` };
  }
  if (typeof row.uiSha !== "string" || !FULL_SHA.test(row.uiSha)) {
    return { error: `open seq ${row.seq} missing/invalid uiSha` };
  }
  if (typeof row.liveFrom !== "string" || row.liveFrom.trim() === "") {
    return { error: `open seq ${row.seq} missing liveFrom` };
  }
  const digest = row.artifactDigest ?? row.imageDigest ?? null;
  return {
    seq: row.seq,
    gatewaySha: row.gatewaySha.toLowerCase(),
    uiSha: row.uiSha.toLowerCase(),
    artifactDigest: digest,
    imageTag: row.imageTag ?? null,
    artifactId: row.artifactId ?? null,
    tag: row.tag ?? null,
    liveFrom: row.liveFrom,
    liveVerified: typeof row.liveVerified === "boolean" ? row.liveVerified : null,
  };
}

/** Resolve the unique open LIVE tip from ledger text (fail-closed). */
export function resolveOpenTip(ledgerText: string): ResolveOpenTipResult {
  const { rows, errors } = parseLedger(ledgerText);
  if (errors.length > 0) {
    return {
      ok: false,
      code: "parse-error",
      message: `cannot parse releases.jsonl: ${errors
        .slice(0, 5)
        .map((e) => `line ${e.line}: ${e.message}`)
        .join("; ")}`,
      openSeqs: [],
    };
  }
  const open = rows.filter((row) => row.liveTo === undefined);
  if (open.length === 0) {
    return {
      ok: false,
      code: "zero-open",
      message: "releases.jsonl has zero open intervals (every row has liveTo)",
      openSeqs: [],
    };
  }
  if (open.length > 1) {
    const openSeqs = open.map((row) => row.seq);
    return {
      ok: false,
      code: "multi-open",
      message: `releases.jsonl has ${open.length} open intervals (seq ${openSeqs.join(", ")}); exactly one is required`,
      openSeqs,
    };
  }
  const tipOrErr = tipFromRow(open[0]);
  if ("error" in tipOrErr) {
    return {
      ok: false,
      code: "missing-fields",
      message: tipOrErr.error,
      openSeqs: [open[0].seq],
    };
  }
  return { ok: true, tip: tipOrErr };
}

function cell(value: string | null | undefined, empty = "_(none)_"): string {
  if (value === null || value === undefined || value === "") {
    return empty;
  }
  return `\`${value}\``;
}

/** Render the managed markdown body (between markers, exclusive of markers). */
export function renderCurrentIdentityBody(tip: OpenTip): string {
  const imageLabel = tip.imageTag ?? tip.artifactId;
  const liveVerified =
    tip.liveVerified === null ? "_(unset)_" : tip.liveVerified ? "`true`" : "`false`";
  const machine =
    `<!-- identity: seq=${tip.seq}` +
    ` gatewaySha=${tip.gatewaySha}` +
    ` uiSha=${tip.uiSha}` +
    ` digest=${tip.artifactDigest ?? ""}` +
    ` imageTag=${imageLabel ?? ""}` +
    ` tag=${tip.tag ?? ""}` +
    ` liveFrom=${tip.liveFrom}` +
    ` liveTo=` +
    ` liveVerified=${tip.liveVerified === null ? "" : String(tip.liveVerified)}` +
    ` -->`;

  return [
    "### Current LIVE identity (generated from `releases.jsonl`)",
    "",
    "> **Scope:** This block asserts **ledger ↔ human-doc consistency** only.",
    "> It does **not** prove the running container identity was reconciled",
    "> (that is a separate LIVE verify / SSH / `delivery:check-sot` path).",
    "",
    machine,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| seq | ${tip.seq} |`,
    `| gatewaySha | ${cell(tip.gatewaySha)} |`,
    `| uiSha | ${cell(tip.uiSha)} |`,
    `| artifactDigest | ${cell(tip.artifactDigest)} |`,
    `| imageTag / artifactId | ${cell(imageLabel)} |`,
    `| tag | ${cell(tip.tag)} |`,
    `| liveFrom | ${cell(tip.liveFrom)} |`,
    `| liveTo | _(open)_ |`,
    `| liveVerified | ${liveVerified} |`,
    "",
  ].join("\n");
}

export function renderCurrentIdentityBlock(tip: OpenTip): string {
  return `${BEGIN_MARKER}\n${renderCurrentIdentityBody(tip)}${END_MARKER}\n`;
}

/** Extract raw text between markers (exclusive), or null if markers absent/malformed. */
export function extractGeneratedBlock(markdown: string): string | null {
  const begin = markdown.indexOf(BEGIN_MARKER);
  const end = markdown.indexOf(END_MARKER);
  if (begin < 0 || end < 0 || end < begin) {
    return null;
  }
  return markdown.slice(begin + BEGIN_MARKER.length, end).replace(/^\n/, "");
}

/**
 * Upsert the generated block. If markers are missing, insert after the Delivery
 * pipeline SoT preamble (before the first historical `## Latest cutover` / first
 * `## ` section after the intro), falling back to file start.
 * Historical narrative outside the markers is never rewritten.
 */
export function upsertGeneratedBlock(markdown: string, tip: OpenTip): string {
  const block = renderCurrentIdentityBlock(tip);
  const begin = markdown.indexOf(BEGIN_MARKER);
  const end = markdown.indexOf(END_MARKER);
  if (begin >= 0 && end > begin) {
    const afterEnd = end + END_MARKER.length;
    // Keep a single trailing newline after the end marker.
    const rest = markdown.slice(afterEnd).replace(/^\n*/, "\n");
    return `${markdown.slice(0, begin)}${block}${rest}`;
  }

  // Insert after the Port-18789 ownership bullet when present; else before any
  // L3 identity bullet; else before "## Latest cutover"; else next H2.
  const port = markdown.search(/^- \*\*Port 18789 is owned by the container[^*]*\*\*.*$/m);
  if (port >= 0) {
    const lineEnd = markdown.indexOf("\n", port);
    const at = lineEnd >= 0 ? lineEnd + 1 : port;
    return `${markdown.slice(0, at)}${block}\n${markdown.slice(at)}`;
  }
  const l3 = markdown.search(/^- \*\*(?:Historical )?L3 identity/m);
  if (l3 >= 0) {
    return `${markdown.slice(0, l3)}${block}\n${markdown.slice(l3)}`;
  }
  const latest = markdown.search(/^## Latest cutover/m);
  if (latest >= 0) {
    return `${markdown.slice(0, latest)}${block}\n${markdown.slice(latest)}`;
  }
  const secondH2 = markdown.search(/\n## /);
  if (secondH2 >= 0) {
    const at = secondH2 + 1;
    return `${markdown.slice(0, at)}${block}\n${markdown.slice(at)}`;
  }
  return `${block}\n${markdown}`;
}

function tableValue(block: string, field: string): string | null {
  const re = new RegExp(
    `^\\|\\s*${field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`,
    "im",
  );
  const match = block.match(re);
  if (!match) {
    return null;
  }
  const raw = match[1].trim();
  if (raw === "" || raw === "_(none)_" || raw === "_(open)_" || raw === "_(unset)_") {
    return raw.startsWith("_") ? raw : null;
  }
  const tick = raw.match(/^`([^`]*)`$/);
  return tick ? tick[1] : raw;
}

function machineValue(block: string, key: string): string | null {
  const line = block.split("\n").find((l) => l.includes("<!-- identity:"));
  if (!line) {
    return null;
  }
  const re = new RegExp(`(?:^|\\s)${key}=(\\S*)`);
  const m = line.match(re);
  return m ? m[1] : null;
}

export function parseGeneratedIdentity(block: string): ParsedGeneratedIdentity {
  const seqRaw = machineValue(block, "seq") ?? tableValue(block, "seq");
  const seq = seqRaw && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;
  const gatewaySha =
    (machineValue(block, "gatewaySha") ?? tableValue(block, "gatewaySha") ?? "").toLowerCase() ||
    null;
  const uiSha =
    (machineValue(block, "uiSha") ?? tableValue(block, "uiSha") ?? "").toLowerCase() || null;
  const digest =
    (machineValue(block, "digest") || tableValue(block, "artifactDigest") || "").toLowerCase() ||
    null;
  const imageTag =
    machineValue(block, "imageTag") || tableValue(block, "imageTag / artifactId") || null;
  const tag = machineValue(block, "tag") || tableValue(block, "tag") || null;
  const liveFrom = machineValue(block, "liveFrom") || tableValue(block, "liveFrom") || null;
  const liveToMachine = machineValue(block, "liveTo");
  const liveToTable = tableValue(block, "liveTo");
  const liveTo =
    liveToMachine !== null && liveToMachine !== ""
      ? liveToMachine
      : liveToTable === "_(open)_"
        ? ""
        : liveToTable;
  const lvRaw = machineValue(block, "liveVerified") ?? tableValue(block, "liveVerified");
  let liveVerified: boolean | null = null;
  if (lvRaw === "true") {
    liveVerified = true;
  } else if (lvRaw === "false") {
    liveVerified = false;
  }

  return {
    seq,
    gatewaySha: gatewaySha && FULL_SHA.test(gatewaySha) ? gatewaySha : gatewaySha,
    uiSha: uiSha && FULL_SHA.test(uiSha) ? uiSha : uiSha,
    artifactDigest: digest || null,
    imageTag: imageTag || null,
    artifactId: imageTag || null,
    tag: tag || null,
    liveFrom: liveFrom || null,
    liveTo: liveTo === "" ? "" : liveTo,
    liveVerified,
  };
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Check-only: ledger open tip vs generated block. Never modifies files. */
export function checkReleaseRecordConsistency(
  ledgerText: string,
  releaseRecordMd: string,
): ConsistencyCheckResult {
  const resolved = resolveOpenTip(ledgerText);
  if (!resolved.ok) {
    return { ok: false, tip: null, reasons: [`${resolved.code}: ${resolved.message}`] };
  }
  const tip = resolved.tip;
  const block = extractGeneratedBlock(releaseRecordMd);
  if (block === null) {
    return {
      ok: false,
      tip,
      reasons: [
        "missing GENERATED current-identity markers in RELEASE_RECORD.md (run generate --write)",
      ],
    };
  }
  const parsed = parseGeneratedIdentity(block);
  const reasons: string[] = [];
  if (parsed.seq !== tip.seq) {
    reasons.push(`seq drift: record=${parsed.seq ?? "∅"} ledger=${tip.seq}`);
  }
  if (norm(parsed.gatewaySha) !== tip.gatewaySha) {
    reasons.push(`gatewaySha drift: record=${parsed.gatewaySha ?? "∅"} ledger=${tip.gatewaySha}`);
  }
  if (norm(parsed.uiSha) !== tip.uiSha) {
    reasons.push(`uiSha drift: record=${parsed.uiSha ?? "∅"} ledger=${tip.uiSha}`);
  }
  const tipDigest = norm(tip.artifactDigest);
  if (tipDigest && norm(parsed.artifactDigest) !== tipDigest) {
    reasons.push(
      `artifactDigest drift: record=${parsed.artifactDigest ?? "∅"} ledger=${tip.artifactDigest}`,
    );
  }
  const tipImage = tip.imageTag ?? tip.artifactId;
  if (tipImage && norm(parsed.imageTag) !== norm(tipImage)) {
    reasons.push(`imageTag drift: record=${parsed.imageTag ?? "∅"} ledger=${tipImage}`);
  }
  if (tip.tag && norm(parsed.tag) !== norm(tip.tag)) {
    reasons.push(`tag drift: record=${parsed.tag ?? "∅"} ledger=${tip.tag}`);
  }
  if (norm(parsed.liveFrom) !== norm(tip.liveFrom)) {
    reasons.push(`liveFrom drift: record=${parsed.liveFrom ?? "∅"} ledger=${tip.liveFrom}`);
  }
  // Open tip must be recorded as open in the managed block.
  if (parsed.liveTo !== null && parsed.liveTo !== "" && parsed.liveTo !== "_(open)_") {
    reasons.push(`managed block liveTo must be open for the unique open tip; got ${parsed.liveTo}`);
  }
  if (reasons.length > 0) {
    return { ok: false, tip, reasons };
  }
  return {
    ok: true,
    tip,
    reasons: [
      `ledger↔doc consistent for open seq ${tip.seq} (not a LIVE container reconciliation)`,
    ],
  };
}

export type CliOptions = {
  mode: "check" | "generate";
  write: boolean;
  ledgerPath: string;
  releaseRecordPath: string;
};

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "check",
    write: false,
    ledgerPath: DEFAULT_LEDGER_PATH,
    releaseRecordPath: DEFAULT_RELEASE_RECORD_PATH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      return next;
    };
    switch (arg) {
      case "check":
        options.mode = "check";
        break;
      case "generate":
        options.mode = "generate";
        break;
      case "--write":
        options.write = true;
        break;
      case "--ledger":
        options.ledgerPath = value();
        break;
      case "--release-record":
        options.releaseRecordPath = value();
        break;
      case "--help":
      case "-h":
        throw new Error(
          "usage: release-record check|generate [--write] [--ledger path] [--release-record path]",
        );
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.mode === "generate" && !options.write) {
    // generate without --write still prints the block to stdout but does not modify.
    // Explicit --write is required to touch RELEASE_RECORD.md.
  }
  if (options.mode === "check" && options.write) {
    throw new Error("check mode must not use --write (refusing to modify files)");
  }
  return options;
}

export function runReleaseRecordCli(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_USAGE;
  }

  let ledgerText: string;
  try {
    ledgerText = readFileSync(options.ledgerPath, "utf8");
  } catch (error) {
    console.error(`cannot read ledger ${options.ledgerPath}: ${(error as Error).message}`);
    return EXIT_DRIFT;
  }

  if (options.mode === "check") {
    let recordText: string;
    try {
      recordText = readFileSync(options.releaseRecordPath, "utf8");
    } catch (error) {
      console.error(
        `cannot read RELEASE_RECORD ${options.releaseRecordPath}: ${(error as Error).message}`,
      );
      return EXIT_DRIFT;
    }
    const result = checkReleaseRecordConsistency(ledgerText, recordText);
    if (result.ok) {
      console.log(result.reasons.join("\n"));
      return 0;
    }
    for (const reason of result.reasons) {
      console.error(`ERROR: ${reason}`);
    }
    return EXIT_DRIFT;
  }

  // generate
  const resolved = resolveOpenTip(ledgerText);
  if (!resolved.ok) {
    console.error(`ERROR: ${resolved.code}: ${resolved.message}`);
    return EXIT_DRIFT;
  }
  const block = renderCurrentIdentityBlock(resolved.tip);
  if (!options.write) {
    process.stdout.write(block);
    console.error("(dry-run: pass --write to upsert RELEASE_RECORD.md)");
    return 0;
  }
  let recordText: string;
  try {
    recordText = readFileSync(options.releaseRecordPath, "utf8");
  } catch (error) {
    console.error(
      `cannot read RELEASE_RECORD ${options.releaseRecordPath}: ${(error as Error).message}`,
    );
    return EXIT_DRIFT;
  }
  const next = upsertGeneratedBlock(recordText, resolved.tip);
  if (next === recordText) {
    console.log(
      `RELEASE_RECORD already matched open seq ${resolved.tip.seq} (idempotent no-op write skipped content change)`,
    );
    // Still rewrite to normalize whitespace? Prefer true idempotent: only write if changed.
    return 0;
  }
  writeFileSync(options.releaseRecordPath, next, "utf8");
  console.log(
    `wrote generated current-identity block for seq ${resolved.tip.seq} → ${options.releaseRecordPath}`,
  );
  // Verify immediately
  const verify = checkReleaseRecordConsistency(ledgerText, next);
  if (!verify.ok) {
    for (const reason of verify.reasons) {
      console.error(`ERROR after write: ${reason}`);
    }
    return EXIT_DRIFT;
  }
  return 0;
}

async function main(): Promise<void> {
  process.exitCode = runReleaseRecordCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
