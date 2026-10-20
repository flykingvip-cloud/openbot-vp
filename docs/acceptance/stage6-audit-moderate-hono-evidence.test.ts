/**
 * Stage 6 narrow moderate audit evidence — GHSA-xgm2-5f3f-mvvc (hono).
 *
 * Pins one production moderate advisory mitigation via real `pnpm audit --prod`.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Same pin also clears GHSA-hvrm-45r6-mjfj and GHSA-w62v-xxxg-mg59 as side effects
 * (not claimed as separate cells). Sibling GHSA-8j4g-w8fx-2239 is covered by
 * stage6-audit-moderate-hono-8j4g / gqvv / hxh3 evidence tests (pin >=4.13.7 also keeps this GHSA cleared).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "docs/acceptance/stage6-audit-moderate-hono-evidence.json");
const TARGET = "GHSA-xgm2-5f3f-mvvc";

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

describe("Stage 6 narrow moderate audit (hono GHSA-xgm2-5f3f-mvvc)", () => {
  it("evidence JSON records the §5.4 field table for this one advisory", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.package).toBe("hono");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toMatch(/^4\.(12\.(27|34)|13\.(5|7))$/);
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("package.json pins hono >=4.12.27 via dependency range and override", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      pnpm: { overrides: Record<string, string> };
    };
    expect(pkg.dependencies.hono).toMatch(/4\.(12\.(27|34)|13\.(5|7))/);
    expect(["4.12.27", "4.12.34", "4.13.5", "4.13.7"]).toContain(pkg.pnpm.overrides.hono);
  });

  it("local pnpm audit --prod no longer lists GHSA-xgm2-5f3f-mvvc; exit stays non-zero", () => {
    const { exitCode, data } = runProdAudit();
    expect(exitCode).toBe(1);
    const ids = Object.values(data.advisories ?? {}).map((a) => a.github_advisory_id);
    expect(ids).not.toContain(TARGET);
    // Side-effect clears under the same pin (not separate cells).
    expect(ids).not.toContain("GHSA-hvrm-45r6-mjfj");
    expect(ids).not.toContain("GHSA-w62v-xxxg-mg59");
    const meta = data.metadata?.vulnerabilities ?? {};
    expect(meta.critical ?? 0).toBe(0);
    expect(meta.high ?? 0).toBe(0);
    expect((meta.moderate ?? 0) + (meta.low ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
