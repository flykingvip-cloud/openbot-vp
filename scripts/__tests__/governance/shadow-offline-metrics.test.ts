import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateShadowRecords,
  classifyShadowRecord,
  main as aggregateMain,
  parseShadowJsonl,
  resolveEntry,
  type ShadowLogRecord,
} from "../../governance/aggregate-shadow-jsonl.js";
import { buildShadowDailyReport, main as dailyMain } from "../../governance/shadow-daily-report.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../governance/fixtures");
const fixtureFile = join(fixtures, "governance-shadow-decisions.jsonl");
const emptyFile = join(fixtures, "empty.jsonl");

function loadFixture(): { records: ShadowLogRecord[]; malformed: number } {
  return parseShadowJsonl(readFileSync(fixtureFile, "utf8"));
}

describe("governance shadow offline metrics", () => {
  it("classifies D4 as excluded even when the effects differ", () => {
    const record: ShadowLogRecord = {
      effect: "deny",
      source: "model-entitlement",
      reason: "cli-backend-model",
      shadow: { existing: { effect: "allow" }, divergence: "D4" },
    };
    expect(classifyShadowRecord(record)).toBe("excluded-d4");
  });

  it("keeps D4 out of divergence on the fixture aggregate", () => {
    const { records, malformed } = loadFixture();
    const report = aggregateShadowRecords(records, malformed);
    expect(report).toMatchObject({
      total: 9,
      malformed: 0,
      skipped: 2,
      match: 2,
      divergence: 4,
      excludedD4: 1,
      unclassified: 0,
      byClass: { D0: 2, D1: 1, D2: 1, D3: 1, D4: 1, D5: 2, D6: 1 },
    });
    expect(report.divergence).toBe(
      (report.byClass.D1 ?? 0) +
        (report.byClass.D2 ?? 0) +
        (report.byClass.D3 ?? 0) +
        (report.byClass.D6 ?? 0),
    );
    expect(report.byEntry.E16).toEqual({ total: 1, skipped: 0, match: 0, divergence: 0 });
    expect(report.bySource["model-entitlement"]).toEqual({
      total: 2,
      skipped: 0,
      match: 0,
      divergence: 1,
    });
    expect(report.byTenant).toEqual({
      "(none)": { total: 1, skipped: 1, match: 0, divergence: 0 },
      t1: { total: 4, skipped: 1, match: 1, divergence: 2 },
      t2: { total: 4, skipped: 0, match: 1, divergence: 2 },
    });
    expect(report.topReasons[0]).toEqual({ reason: "within-policy", count: 2 });
    expect(report.byReason["cli-backend-model"]).toEqual({
      total: 1,
      skipped: 0,
      match: 0,
      divergence: 0,
    });
  });

  it("emits stable §8.5 daily rows for the fixture", () => {
    const { records, malformed } = loadFixture();
    const report = buildShadowDailyReport(records, { kind: "all" }, malformed);
    const expected = JSON.parse(readFileSync(join(fixtures, "expected-daily-report.json"), "utf8"));
    expect(report).toEqual(expected);
    const d4 = report.rows.find((row) => row.entry === "E16");
    expect(d4?.divergence).toBe(0);
    expect(d4?.byClass.D4).toBe(1);
    expect(d4?.total).toBe(1);
  });

  it("drops lines outside the UTC window", () => {
    const { records } = loadFixture();
    const extra: ShadowLogRecord = {
      effect: "deny",
      source: "node",
      reason: "other-day",
      tenantId: "t9",
      entry: "E9",
      shadow: { existing: { effect: "allow" }, divergence: "D1" },
      ts: "2026-09-26T23:00:00.000Z",
    };
    const report = buildShadowDailyReport([...records, extra], {
      kind: "day",
      day: "2026-09-27",
    });
    expect(report.window).toBe("2026-09-27");
    expect(report.rows.reduce((sum, row) => sum + row.divergence, 0)).toBe(4);
  });

  it("treats an empty file as a zero report", () => {
    const { records, malformed } = parseShadowJsonl(readFileSync(emptyFile, "utf8"));
    expect(malformed).toBe(0);
    expect(aggregateShadowRecords(records, malformed)).toMatchObject({
      total: 0,
      skipped: 0,
      match: 0,
      divergence: 0,
      excludedD4: 0,
    });
    expect(buildShadowDailyReport(records, { kind: "all" }, malformed)).toEqual({
      window: "empty",
      malformed: 0,
      rows: [],
    });
  });

  it("counts malformed lines and does not treat them as divergence", () => {
    const { records, malformed } = parseShadowJsonl('{"effect":"deny"}\nnot-json\n\n');
    expect(records).toHaveLength(1);
    expect(malformed).toBe(1);
    expect(aggregateShadowRecords(records, malformed).divergence).toBe(0);
    expect(aggregateShadowRecords(records, malformed).unclassified).toBe(1);
  });

  it("counts a skipped D6 envelope as divergence, not skipped", () => {
    const d6: ShadowLogRecord = {
      effect: "skipped",
      source: "model-entitlement",
      entry: "E2",
      reason: "shadow-threw",
      shadow: { existing: { effect: "allow" }, divergence: "D6" },
      ts: "2026-09-29T01:00:00.000Z",
    };
    const skipped: ShadowLogRecord = {
      effect: "skipped",
      source: "model-entitlement",
      entry: "E2",
      reason: "enterprise-scope-without-allowlist",
      ts: "2026-09-29T02:00:00.000Z",
    };
    expect(classifyShadowRecord(d6)).toBe("divergence");
    expect(aggregateShadowRecords([d6, skipped])).toMatchObject({
      total: 2,
      skipped: 1,
      divergence: 1,
      byClass: { D6: 1 },
    });
    const [row] = buildShadowDailyReport([d6, skipped], { kind: "day", day: "2026-09-29" }).rows;
    expect(row).toMatchObject({
      entry: "E2",
      total: 2,
      skipped: 1,
      divergence: 1,
      byClass: { D6: 1 },
    });
  });

  it("maps an unstamped capability line to E8 and leaves model entitlement unspecified", () => {
    expect(resolveEntry({ source: "capability" })).toBe("E8");
    expect(resolveEntry({ source: "node" })).toBe("E9");
    expect(resolveEntry({ source: "model-entitlement" })).toBe("(unspecified)");
    expect(resolveEntry({ source: "capability", entry: "E11" })).toBe("E11");
  });

  it("gives stamped E11 / E12 capability lines their own rows; unstamped ones still fall back to E8", () => {
    const base = { effect: "skipped", ts: "2026-09-27T01:00:00.000Z" } as const;
    const records: ShadowLogRecord[] = [
      { ...base, source: "capability", entry: "E8", reason: "tenant-capability-not-enforced" },
      { ...base, source: "capability", entry: "E11", reason: "handler-error" },
      { ...base, source: "capability", entry: "E12", reason: "handler-error" },
      { ...base, source: "capability", reason: "legacy-line-without-entry" },
      { ...base, source: "model-entitlement", entry: "E2", reason: "no-enterprise-scope" },
    ];
    const rows = buildShadowDailyReport(records, { kind: "all" }).rows.map((row) => ({
      entry: row.entry,
      source: row.source,
      total: row.total,
    }));
    expect(rows).toEqual([
      { entry: "E11", source: "capability", total: 1 },
      { entry: "E12", source: "capability", total: 1 },
      { entry: "E2", source: "model-entitlement", total: 1 },
      { entry: "E8", source: "capability", total: 2 },
    ]);
  });

  it("prints stable JSON for the fixture file", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      dailyMain([
        "node",
        "shadow-daily-report",
        "--file",
        fixtureFile,
        "--window",
        "2026-09-27",
        "--json",
      ]),
    ).toBe(0);
    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      file: string;
      window: string;
      rows: Array<{ entry: string; divergence: number; byClass: Record<string, number> }>;
    };
    expect(printed.file).toBe(fixtureFile);
    expect(printed.window).toBe("2026-09-27");
    expect(printed.rows.map((row) => [row.entry, row.divergence, row.byClass.D4 ?? 0])).toEqual([
      ["E1", 1, 0],
      ["E16", 0, 1],
      ["E2", 1, 0],
      ["E8", 0, 0],
      ["E9", 2, 0],
    ]);
    log.mockRestore();

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(aggregateMain(["node", "aggregate", "--file", join(fixtures, "missing.jsonl")])).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toContain("OPENBOT_GOVERNANCE_SHADOW_LOG");
    expect(dailyMain(["node", "daily", "--window", "09-27"])).toBe(2);
    err.mockRestore();
  });

  it("does not import gateway governance or assign mode defaults", () => {
    const aggregate = readFileSync(
      join(here, "../../governance/aggregate-shadow-jsonl.ts"),
      "utf8",
    );
    const daily = readFileSync(join(here, "../../governance/shadow-daily-report.ts"), "utf8");
    for (const source of [aggregate, daily]) {
      expect(source).not.toMatch(/from ["'][^"']*gateway\/governance/);
      expect(source).not.toMatch(/OPENBOT_GOVERNANCE_[A-Z0-9_]*MODE\s*=/);
      expect(source).not.toMatch(/OPENBOT_GOVERNANCE_SHADOW_LOG\s*=/);
    }
  });
});
