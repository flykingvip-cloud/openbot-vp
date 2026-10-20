import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isCliBackendRecord,
  main,
  parseShadowLog,
  summarizeShadowDecisions,
  type ShadowRecord,
} from "../../governance/shadow-decisions-report.js";

const records: ShadowRecord[] = [
  { effect: "skipped", mode: "legacy", source: "model-entitlement", reason: "no-enterprise-scope" },
  {
    effect: "deny",
    mode: "shadow",
    source: "model-entitlement",
    reason: "entitlement-empty",
    tenantId: "t1",
    matchedRules: ["outside-allowlist:openai/gpt-5"],
    shadow: { divergence: "D1" },
  },
  {
    effect: "allow",
    mode: "shadow",
    source: "model-entitlement",
    reason: "within-allowlist",
    tenantId: "t1",
    matchedRules: [],
    shadow: { divergence: "D0" },
  },
  {
    effect: "deny",
    mode: "shadow",
    source: "model-entitlement",
    reason: "cli-backend-model",
    tenantId: "t2",
    matchedRules: ["cli-backend-model", "cli-backend-model:claude-cli/opus"],
    shadow: { divergence: "D4" },
  },
  {
    // CLI fallback filtered, catalog primary kept: an ordinary allow, CLI only tagged.
    effect: "allow",
    mode: "shadow",
    source: "model-entitlement",
    reason: "fallback-outside-allowlist",
    tenantId: "t2",
    matchedRules: ["cli-backend-model", "cli-backend-model:codex-cli/gpt-5"],
    shadow: { divergence: "D0" },
  },
  {
    effect: "skipped",
    mode: "shadow",
    source: "model-entitlement",
    reason: "enterprise-scope-without-allowlist",
  },
];

describe("governance shadow decisions report", () => {
  it("detects CLI-backend records", () => {
    expect(isCliBackendRecord(records[3])).toBe(true);
    expect(isCliBackendRecord(records[1])).toBe(false);
  });

  it("counts totals, skipped, would-deny, and breaks out CLI backends", () => {
    const report = summarizeShadowDecisions(records);
    expect(report).toMatchObject({
      total: 6,
      skipped: 2,
      legacy: 1,
      wouldDeny: 1,
      allow: 2,
      evaluated: 3,
      cliBackend: { total: 2, deny: 1, allow: 1 },
      byClass: { D0: 2, D1: 1 },
      bySource: { "model-entitlement": 6 },
      byTenant: { t1: 2, t2: 2, "(none)": 2 },
    });
    expect(report.matchRate).toBeCloseTo(2 / 3);
    expect(report.divergenceRate).toBeCloseTo(1 / 3);
  });

  it("rates are null with nothing evaluated", () => {
    const report = summarizeShadowDecisions([records[0]]);
    expect(report.matchRate).toBeNull();
    expect(report.divergenceRate).toBeNull();
  });

  it("parses JSONL and counts malformed lines", () => {
    const { records: parsed, malformed } = parseShadowLog(
      `${JSON.stringify(records[1])}\nnot-json\n\n${JSON.stringify(records[0])}\n`,
    );
    expect(parsed).toHaveLength(2);
    expect(malformed).toBe(1);
  });

  it("main prints a JSON report for --file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-report-"));
    try {
      const file = join(dir, "governance-shadow-decisions.jsonl");
      writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n"));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(main(["node", "script", "--file", file, "--json"])).toBe(0);
      const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(printed.wouldDeny).toBe(1);
      expect(printed.cliBackend.total).toBe(2);
      log.mockRestore();
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(main(["node", "script", "--file", join(dir, "missing.jsonl")])).toBe(1);
      err.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
