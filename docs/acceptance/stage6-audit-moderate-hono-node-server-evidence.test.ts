/**
 * Stage 6 narrow moderate audit evidence — @hono/node-server dual pin.
 *
 * Primary cell: GHSA-frvp-7c67-39w9 (needs >=1.19.15).
 * Intentional co-clear: GHSA-92pp-h63x-v22m (needs >=1.19.13) via the same pin.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Remaining Stage 6 moderate surface includes dompurify (many GHSAs) — not this PR.
 * Honesty: override-only transitive pin via @buape/carbon; patch bump 1.19.10→1.19.15.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(
  ROOT,
  "docs/acceptance/stage6-audit-moderate-hono-node-server-evidence.json",
);
const TARGET = "GHSA-frvp-7c67-39w9";
const SIBLING = "GHSA-92pp-h63x-v22m";

type Evidence = {
  advisory: string;
  sibling_advisory_cleared: string;
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

describe("Stage 6 narrow moderate audit (@hono/node-server GHSA-frvp + GHSA-92pp)", () => {
  it("evidence JSON records the §5.4 field table for this pin (primary + sibling)", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.sibling_advisory_cleared).toBe(SIBLING);
    expect(evidence.package).toBe("@hono/node-server");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toBe("1.19.15");
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("package.json pins @hono/node-server >=1.19.15 via pnpm override", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      pnpm: { overrides: Record<string, string> };
    };
    expect(pkg.dependencies?.["@hono/node-server"]).toBeUndefined();
    expect(pkg.pnpm.overrides["@hono/node-server"]).toBe("1.19.15");
  });

  it("local pnpm audit --prod no longer lists GHSA-frvp or GHSA-92pp; exit stays non-zero", () => {
    const { exitCode, data } = runProdAudit();
    expect(exitCode).toBe(1);
    const ids = Object.values(data.advisories ?? {}).map((a) => a.github_advisory_id);
    expect(ids).not.toContain(TARGET);
    expect(ids).not.toContain(SIBLING);
    // Prior hono core cells remain cleared under hono@4.13.7.
    expect(ids).not.toContain("GHSA-hxh3-vqpv-xpqv");
    expect(ids).not.toContain("GHSA-gqvv-2mrq-wpjv");
    expect(ids).not.toContain("GHSA-8j4g-w8fx-2239");
    expect(ids).not.toContain("GHSA-xgm2-5f3f-mvvc");
    const meta = data.metadata?.vulnerabilities ?? {};
    expect(meta.critical ?? 0).toBe(0);
    expect(meta.high ?? 0).toBe(0);
    expect((meta.moderate ?? 0) + (meta.low ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
