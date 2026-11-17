// Read-only classifier for git objects named by deploy/production/releases.jsonl.
//
// Distinguishes a shallow/incomplete local clone from objects that are absent
// from the current object store, and (optionally) from a probed remote.
// This is a report tool. It never writes the ledger, never deletes rows, and
// is not a substitute for `pnpm delivery:ledger:audit`, which must keep
// failing closed on missing-object / incomplete-graph / regression errors.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { objectExists, type GitRunner } from "./forward-guard.ts";
import { parseLedger, type ReleaseRow } from "./ledger.ts";

export const CLASS_PRESENT = "present-in-current-object-store";
export const CLASS_MISSING_LOCAL = "missing-from-current-object-store";
export const CLASS_ABSENT_REMOTE = "absent-from-probed-remote";
export const CLASS_FETCHABLE_REMOTE = "fetchable-by-sha-from-probed-remote";
export const CLASS_PROBE_INCONCLUSIVE = "probe-inconclusive";

export type ObjectClassification =
  | typeof CLASS_PRESENT
  | typeof CLASS_MISSING_LOCAL
  | typeof CLASS_ABSENT_REMOTE
  | typeof CLASS_FETCHABLE_REMOTE
  | typeof CLASS_PROBE_INCONCLUSIVE;

export type ShaRecord = {
  sha: string;
  seqs: number[];
  gatewaySeqs: number[];
  uiSeqs: number[];
  presentInCurrentObjectStore: boolean;
  classification: ObjectClassification;
  probe?: { code: number; message: string };
};

export type CloneGraphFacts = {
  isShallow: boolean;
  headSha: string;
  revListHead: number | null;
  revListAll: number | null;
};

export type ClassifyReport = {
  facts: CloneGraphFacts;
  ledgerPath: string;
  rowCount: number;
  uniqueShaCount: number;
  classificationCounts: Record<string, number>;
  records: ShaRecord[];
  note: string;
};

export function collectLedgerShas(
  rows: ReleaseRow[],
): Map<string, { gatewaySeqs: number[]; uiSeqs: number[] }> {
  const map = new Map<string, { gatewaySeqs: number[]; uiSeqs: number[] }>();
  const add = (sha: string | undefined, seq: number, field: "gatewaySeqs" | "uiSeqs") => {
    if (!sha) {
      return;
    }
    const entry = map.get(sha) ?? { gatewaySeqs: [], uiSeqs: [] };
    entry[field].push(seq);
    map.set(sha, entry);
  };
  for (const row of rows) {
    add(row.gatewaySha, row.seq, "gatewaySeqs");
    add(row.uiSha, row.seq, "uiSeqs");
  }
  return map;
}

export function classifyLocalPresence(sha: string, git: GitRunner): boolean {
  return objectExists(sha, git);
}

/**
 * Interpret `git fetch <remote> <sha>:<dst>` output. GitHub answers
 * "upload-pack: not our ref" / HTTP-side 422 when the object is not in that
 * remote's object graph. A zero exit means the SHA was fetchable by id even if
 * it was not advertised on a branch tip.
 */
export function classifyFetchProbe(code: number, message: string): ObjectClassification {
  if (code === 0) {
    return CLASS_FETCHABLE_REMOTE;
  }
  const lower = message.toLowerCase();
  if (
    lower.includes("not our ref") ||
    lower.includes("not our tip") ||
    lower.includes("unadvertised object") ||
    lower.includes("couldn't find remote ref") ||
    lower.includes("couldn't find remote")
  ) {
    return CLASS_ABSENT_REMOTE;
  }
  return CLASS_PROBE_INCONCLUSIVE;
}

export function readCloneGraphFacts(git: GitRunner): CloneGraphFacts {
  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  const head = git(["rev-parse", "HEAD"]);
  const countHead = git(["rev-list", "--count", "HEAD"]);
  const countAll = git(["rev-list", "--all", "--count"]);
  const parseCount = (result: { code: number; stdout: string }): number | null => {
    if (result.code !== 0) {
      return null;
    }
    const value = Number(result.stdout.trim());
    return Number.isFinite(value) ? value : null;
  };
  return {
    isShallow: shallow.code === 0 && shallow.stdout.trim() === "true",
    headSha: head.code === 0 ? head.stdout.trim() : "",
    revListHead: parseCount(countHead),
    revListAll: parseCount(countAll),
  };
}

export type ProbeFn = (sha: string) => { code: number; message: string };

export function buildClassifyReport(options: {
  rows: ReleaseRow[];
  git: GitRunner;
  ledgerPath: string;
  probe?: ProbeFn;
}): ClassifyReport {
  const facts = readCloneGraphFacts(options.git);
  const collected = collectLedgerShas(options.rows);
  const records: ShaRecord[] = [];
  const counts: Record<string, number> = {};
  for (const [sha, refs] of collected) {
    const present = classifyLocalPresence(sha, options.git);
    let classification: ObjectClassification = present ? CLASS_PRESENT : CLASS_MISSING_LOCAL;
    let probe: ShaRecord["probe"];
    if (!present && options.probe) {
      probe = options.probe(sha);
      classification = classifyFetchProbe(probe.code, probe.message);
    }
    counts[classification] = (counts[classification] ?? 0) + 1;
    records.push({
      sha,
      seqs: [...new Set([...refs.gatewaySeqs, ...refs.uiSeqs])].toSorted((a, b) => a - b),
      gatewaySeqs: refs.gatewaySeqs,
      uiSeqs: refs.uiSeqs,
      presentInCurrentObjectStore: present,
      classification,
      probe,
    });
  }
  records.sort((a, b) => a.sha.localeCompare(b.sha));
  return {
    facts,
    ledgerPath: options.ledgerPath,
    rowCount: options.rows.length,
    uniqueShaCount: records.length,
    classificationCounts: counts,
    records,
    note:
      "Report only. Do not treat missing-from-current-object-store as proven absence " +
      "from a remote unless a probe was run, and do not treat a shallow clone as " +
      "proven absence. delivery:ledger:audit remains the fail-closed guard.",
  };
}

export function parseCliArgs(argv: string[]): {
  ledgerPath: string;
  outputPath?: string;
  probeOrigin: boolean;
  remote: string;
} {
  let ledgerPath = "deploy/production/releases.jsonl";
  let outputPath: string | undefined;
  let probeOrigin = false;
  let remote = "origin";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ledger") {
      ledgerPath = argv[++i] ?? ledgerPath;
    } else if (arg === "--output") {
      outputPath = argv[++i];
    } else if (arg === "--probe-origin") {
      probeOrigin = true;
    } else if (arg === "--remote") {
      remote = argv[++i] ?? remote;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "usage: classify-ledger-objects [--ledger path] [--output jsonl] [--probe-origin] [--remote name]",
      );
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { ledgerPath, outputPath, probeOrigin, remote };
}

function realGit(): GitRunner {
  return (args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function originProbe(remote: string): ProbeFn {
  return (sha) => {
    // Fetch into a throwaway ref namespace, then delete the ref. Objects that
    // land in the local store are not pushed and the ledger is not touched.
    const dest = `refs/ledger-object-probe/${sha}`;
    const fetched = spawnSync("git", ["fetch", "--no-tags", remote, `${sha}:${dest}`], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    spawnSync("git", ["update-ref", "-d", dest], { encoding: "utf8" });
    return {
      code: fetched.status ?? 1,
      message: `${fetched.stderr ?? ""}${fetched.stdout ?? ""}`.trim(),
    };
  };
}

function main(argv = process.argv.slice(2)): number {
  let opts: ReturnType<typeof parseCliArgs>;
  try {
    opts = parseCliArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(opts.ledgerPath, "utf8");
  } catch (error) {
    console.error(`cannot read ledger at ${opts.ledgerPath}: ${(error as Error).message}`);
    return 2;
  }
  const { rows, errors } = parseLedger(text);
  for (const parseError of errors) {
    console.error(`${opts.ledgerPath}:${parseError.line}: ${parseError.message}`);
  }
  if (errors.length > 0) {
    return 2;
  }
  const report = buildClassifyReport({
    rows,
    git: realGit(),
    ledgerPath: opts.ledgerPath,
    probe: opts.probeOrigin ? originProbe(opts.remote) : undefined,
  });
  console.log(
    `ledger: ${report.rowCount} releases, ${report.uniqueShaCount} unique SHAs, ` +
      `shallow=${report.facts.isShallow}, head=${report.facts.headSha.slice(0, 12)}`,
  );
  const counts = Object.entries(report.classificationCounts)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
  console.log(`classification: ${counts || "(none)"}`);
  console.log(report.note);
  if (opts.outputPath) {
    const body = report.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    writeFileSync(opts.outputPath, body);
    console.log(`wrote ${opts.outputPath}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
