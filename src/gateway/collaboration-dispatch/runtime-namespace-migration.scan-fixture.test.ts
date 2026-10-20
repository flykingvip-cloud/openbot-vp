/**
 * P0.0a migration against a synthetic tree shaped like the 2026-10-05 read-only
 * production scan (`__fixtures__/scan-report-20261005.summary.json`): 27 operating-state
 * files (25 live groups + 2 backups), all `tenantHint: null`, 125 round files,
 * 1 non-terminal round (grp-shared-tx, PRIMARY_QUEUE), 557 ledger lines, and dual
 * ledgers in `grp-daniel-hhd-gmail-com-upbeyond` and one space group.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import scan from "./__fixtures__/scan-report-20261005.summary.json" with { type: "json" };
import { AUDIT_FILENAME, runRuntimeNamespaceMigration } from "./runtime-namespace-migration.js";

type ScanGroup = (typeof scan.groups)[number];
/** Records duplicated between the two ledger files of a dual-ledger group (assumed). */
const DUAL_OVERLAP = 5;

let tmp: string;
let legacyRoot: string;
let tenantsRoot: string;
const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const live = scan.groups.filter((g) => g.location === "live") as Array<
  ScanGroup & { dirName: string }
>;
const dual = live.filter((g) => g.ledger.files.length === 2);

function ledgerRecords(group: ScanGroup): string[] {
  const kinds = Object.entries(group.ledger.kinds).flatMap(([kind, n]) => Array(n).fill(kind));
  return kinds.map((kind, i) =>
    JSON.stringify({
      kind,
      groupId: group.groupId,
      seq: i,
      recordedAtMs: 1_780_000_000_000 + i * 1000,
    }),
  );
}

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ns-scan-"));
  legacyRoot = path.join(tmp, "collaboration", "groups");
  tenantsRoot = path.join(tmp, "tenants");
  for (const group of live) {
    const dir = path.join(legacyRoot, group.dirName);
    await write(
      path.join(dir, "operating-state.json"),
      JSON.stringify({ mode: "discussion_driven" }),
    );
    const states = Object.entries(group.rounds.nonTerminalStates).flatMap(([s, n]) =>
      Array(n).fill(s),
    );
    for (let i = 0; i < group.rounds.files; i += 1) {
      const state = states[i] ?? "ROUND_COMPLETE";
      await write(
        path.join(dir, "runtime", "rounds", `round-${i}.json`),
        `${JSON.stringify({ roundId: `round-${i}`, groupId: group.groupId, state }, null, 2)}\n`,
      );
    }
    const records = ledgerRecords(group);
    if (group.ledger.files.length === 2) {
      // Scan `lines` counts both files: canonical gets the first part, the flat file
      // re-serializes DUAL_OVERLAP canonical records (key order reversed) plus the rest.
      const total = group.ledger.lines;
      const canonicalCount = Math.ceil((total + DUAL_OVERLAP) / 2);
      const unique = records.slice(0, total - DUAL_OVERLAP);
      const canonical = unique.slice(0, canonicalCount);
      const overlap = canonical
        .slice(0, DUAL_OVERLAP)
        .map((l) => JSON.stringify(JSON.parse(l), Object.keys(JSON.parse(l)).toReversed()));
      const flat = [...overlap, ...unique.slice(canonicalCount)];
      await write(path.join(dir, "ledger", "collaboration.jsonl"), `${canonical.join("\n")}\n`);
      await write(path.join(dir, "collaboration-ledger.jsonl"), `${flat.join("\n")}\n`);
    } else if (records.length > 0) {
      await write(path.join(dir, "ledger", "collaboration.jsonl"), `${records.join("\n")}\n`);
    }
  }
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("P0.0a migration on the production scan shape", () => {
  test("fixture matches the scan summary", () => {
    expect(scan.groups).toHaveLength(27);
    expect(scan.groups.every((g) => g.tenantHint === null)).toBe(true);
    expect(scan.groups.filter((g) => g.location === "backup")).toHaveLength(2);
    expect(live.reduce((n, g) => n + g.rounds.files, 0)).toBe(125);
    expect(live.reduce((n, g) => n + g.ledger.lines, 0)).toBe(557);
    expect(dual.map((g) => g.groupId).toSorted()).toEqual([
      "grp-daniel-hhd-gmail-com-upbeyond",
      "space-b1e30f37-8edb-4860-9646-c8801fef2b49",
    ]);
  });

  test("dry-run plan: every live group → tenant 001 (owner default), nothing written", async () => {
    const report = await runRuntimeNamespaceMigration({
      sourceGroupsRoot: legacyRoot,
      target: { profile: "managed_enterprise", tenantsRoot },
    });
    expect(report.totals).toMatchObject({
      groups: 25,
      planned: 25,
      quarantined: 0,
      ownerDefaultTenant001: 25,
      nonTerminalRounds: 1,
      ledgerMerges: 2,
      duplicatesDropped: DUAL_OVERLAP * 2,
    });
    const nonTerminal = report.groups.flatMap((g) =>
      g.nonTerminalRounds.map((r) => ({ groupId: g.groupId, state: r.state })),
    );
    expect(nonTerminal).toEqual([{ groupId: "grp-shared-tx", state: "PRIMARY_QUEUE" }]);
    const roundFiles = report.groups.flatMap((g) =>
      g.files.filter((f) => f.fact.startsWith("rounds/")),
    );
    expect(roundFiles).toHaveLength(125);
    await expect(fs.stat(tenantsRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("apply: 100% sha256 match, deduped dual ledgers, 25 audit records", async () => {
    const report = await runRuntimeNamespaceMigration({
      sourceGroupsRoot: legacyRoot,
      target: { profile: "managed_enterprise", tenantsRoot },
      apply: true,
    });
    expect(report.totals).toMatchObject({
      migrated: 25,
      verifyFailures: 0,
      conflicts: 0,
      failed: 0,
    });
    expect(report.totals.verified).toBe(report.totals.files);
    let ledgerLines = 0;
    for (const group of live) {
      const legacy = path.join(legacyRoot, group.dirName);
      const ns = path.join(tenantsRoot, "001", "collaboration", "groups", group.dirName, "runtime");
      for (const name of await fs.readdir(path.join(legacy, "runtime", "rounds")).catch(() => [])) {
        expect(sha(await fs.readFile(path.join(ns, "rounds", name)))).toBe(
          sha(await fs.readFile(path.join(legacy, "runtime", "rounds", name))),
        );
      }
      const target = await fs
        .readFile(path.join(ns, "ledger", "collaboration.jsonl"), "utf8")
        .catch(() => "");
      const lines = target.split("\n").filter(Boolean);
      ledgerLines += lines.length;
      if (group.ledger.files.length === 2) {
        expect(lines).toHaveLength(group.ledger.lines - DUAL_OVERLAP);
        expect(new Set(lines.map((l) => JSON.parse(l).seq)).size).toBe(lines.length);
        expect(lines).toEqual(ledgerRecords(group).slice(0, group.ledger.lines - DUAL_OVERLAP));
      } else if (group.ledger.lines > 0) {
        expect(sha(target)).toBe(
          sha(await fs.readFile(path.join(legacy, "ledger", "collaboration.jsonl"))),
        );
      }
      const audit = (await fs.readFile(path.join(ns, "migration", AUDIT_FILENAME), "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(audit).toEqual([
        expect.objectContaining({
          groupId: group.groupId,
          tenantId: "001",
          reason: "owner-default-tenant-001",
          actor: "migration",
          from: legacy,
          to: ns,
        }),
      ]);
    }
    expect(ledgerLines).toBe(557 - DUAL_OVERLAP * 2);
  });
});
