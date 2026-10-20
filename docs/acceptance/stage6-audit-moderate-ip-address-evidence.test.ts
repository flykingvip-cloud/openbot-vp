/**
 * Stage 6 narrow moderate audit evidence — GHSA-rpw4-54j3-4h4q (ip-address).
 *
 * Pins one production moderate advisory mitigation via real `pnpm audit --prod`.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Prior yaml / file-type / markdown-it / FXP / hono / node-server / dompurify /
 * mysql2 / qs / music-metadata narrow cells remain covered by their own evidence tests.
 * Honesty: same pin also clears sibling ip-address GHSA-2vr4-cq9g-pvrc
 * (same >=10.5.1 floor); documented side-clear, not a second cell.
 * Follow-on ip-address pin may be higher (GHSA-j6r3 / GHSA-h3mg at >=10.7.1);
 * this cell still asserts only that GHSA-rpw4 stays cleared at mitigated_version 10.5.1+.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "docs/acceptance/stage6-audit-moderate-ip-address-evidence.json");
const TARGET = "GHSA-rpw4-54j3-4h4q";
const SIDE_CLEARS = ["GHSA-2vr4-cq9g-pvrc"] as const;

type Evidence = {
  advisory: string;
  package: string;
  severity: string;
  mitigated_version: string;
  acceptance_impact: string;
};

type AuditJson = {
  metadata?: { vulnerabilities?: Record<string, number> };
  advisories?: Record<string, { github_advisory_id?: string; module_name?: string }>;
};

function runProdAudit(): { exitCode: number; data: AuditJson } {
  try {
    const out = execFileSync("pnpm", ["audit", "--prod", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const start = out.indexOf("{");
    return { exitCode: 0, data: JSON.parse(out.slice(start)) as AuditJson };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer };
    const text = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf8") ?? "");
    const start = text.indexOf("{");
    if (start < 0) {
      throw err;
    }
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      data: JSON.parse(text.slice(start)) as AuditJson,
    };
  }
}

describe("Stage 6 narrow moderate audit (ip-address GHSA-rpw4-54j3-4h4q)", () => {
  it("evidence JSON records the §5.4 field table for this one advisory", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.package).toBe("ip-address");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toBe("10.5.1");
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("root override pins ip-address >=10.5.1 (follow-on j6r3 cell may raise to 10.7.1+)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      pnpm: { overrides: Record<string, string> };
    };
    // Cell introduced 10.5.1; follow-on j6r3 cell may raise to 10.7.1+.
    expect(pkg.pnpm.overrides["ip-address"]).toMatch(/^10\.(5\.\d+|7\.\d+)$/);
  });

  it("local pnpm audit --prod no longer lists GHSA-rpw4; exit stays non-zero", () => {
    const { exitCode, data } = runProdAudit();
    expect(exitCode).toBe(1);
    const ids = Object.values(data.advisories ?? {}).map((a) => a.github_advisory_id);
    expect(ids).not.toContain(TARGET);
    for (const side of SIDE_CLEARS) {
      expect(ids).not.toContain(side);
    }
    const meta = data.metadata?.vulnerabilities ?? {};
    expect(meta.critical ?? 0).toBe(0);
    expect(meta.high ?? 0).toBe(0);
    expect((meta.moderate ?? 0) + (meta.low ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
