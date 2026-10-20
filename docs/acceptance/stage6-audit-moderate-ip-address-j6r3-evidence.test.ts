/**
 * Stage 6 narrow moderate audit evidence — GHSA-j6r3-76f7-8jcv (ip-address).
 *
 * Pins one production moderate advisory mitigation via real `pnpm audit --prod`.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Prior yaml / file-type / markdown-it / FXP / hono / node-server / dompurify /
 * mysql2 / qs / music-metadata / ip-address-rpw4 narrow cells remain covered
 * by their own evidence tests.
 * Honesty: same pin also clears sibling ip-address GHSA-h3mg-xc3c-68pw
 * (same >=10.7.1 floor); documented side-clear, not a second cell.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(
  ROOT,
  "docs/acceptance/stage6-audit-moderate-ip-address-j6r3-evidence.json",
);
const TARGET = "GHSA-j6r3-76f7-8jcv";
const SIDE_CLEAR = "GHSA-h3mg-xc3c-68pw";
const PRIOR_CLEARS = ["GHSA-rpw4-54j3-4h4q", "GHSA-2vr4-cq9g-pvrc"] as const;

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

describe("Stage 6 narrow moderate audit (ip-address GHSA-j6r3-76f7-8jcv)", () => {
  it("evidence JSON records the §5.4 field table for this one advisory", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.package).toBe("ip-address");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toBe("10.7.1");
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("root override pins ip-address >=10.7.1", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      pnpm: { overrides: Record<string, string> };
    };
    expect(pkg.pnpm.overrides["ip-address"]).toMatch(/^10\.7(\.\d+)?$/);
  });

  it("local pnpm audit --prod no longer lists GHSA-j6r3; exit stays non-zero; prior ip-address GHSAs stay clear", () => {
    const { exitCode, data } = runProdAudit();
    expect(exitCode).toBe(1);
    const ids = Object.values(data.advisories ?? {}).map((a) => a.github_advisory_id);
    expect(ids).not.toContain(TARGET);
    expect(ids).not.toContain(SIDE_CLEAR);
    for (const prior of PRIOR_CLEARS) {
      expect(ids).not.toContain(prior);
    }
    const meta = data.metadata?.vulnerabilities ?? {};
    expect(meta.critical ?? 0).toBe(0);
    expect(meta.high ?? 0).toBe(0);
    expect((meta.moderate ?? 0) + (meta.low ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
