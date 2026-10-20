/**
 * Stage 6 narrow moderate audit evidence — GHSA-55q2-fjhq-7xh7 (dompurify).
 *
 * Pins one production moderate advisory mitigation via real `pnpm audit --prod`.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Same pin also clears low GHSA-c2j3-45gr-mqc4 as a side effect (lower
 * threshold; not a separate cell). Prior dompurify GHSA-v9jr / GHSA-hpcv /
 * GHSA-rp9w / GHSA-cmwh remain covered by dedicated evidence tests (pin
 * >=3.4.13 also keeps those GHSAs cleared). Remaining higher-threshold
 * dompurify lows (GHSA-6688 / GHSA-p98j needing >=3.4.16) — not this PR.
 * Honesty: 3.4.11→3.4.13 is a patch bump within the 3.4 minor on the ui
 * workspace direct dependency.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(
  ROOT,
  "docs/acceptance/stage6-audit-moderate-dompurify-55q2-evidence.json",
);
const TARGET = "GHSA-55q2-fjhq-7xh7";
const SIDE_EFFECTS = ["GHSA-c2j3-45gr-mqc4"] as const;

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

describe("Stage 6 narrow moderate audit (dompurify GHSA-55q2-fjhq-7xh7)", () => {
  it("evidence JSON records the §5.4 field table for this one advisory", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.package).toBe("dompurify");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toBe("3.4.13");
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("ui package + root override pin dompurify to 3.4.13", () => {
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      pnpm: { overrides: Record<string, string> };
    };
    const ui = JSON.parse(fs.readFileSync(path.join(ROOT, "ui/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(ui.dependencies.dompurify).toMatch(/\^?3\.4\.13|>=3\.4\.13/);
    expect(root.pnpm.overrides.dompurify).toBe("3.4.13");
  });

  it("local pnpm audit --prod no longer lists GHSA-55q2 (or lower-threshold side effect); exit stays non-zero", () => {
    const { exitCode, data } = runProdAudit();
    expect(exitCode).toBe(1);
    const ids = Object.values(data.advisories ?? {}).map((a) => a.github_advisory_id);
    expect(ids).not.toContain(TARGET);
    for (const side of SIDE_EFFECTS) {
      expect(ids).not.toContain(side);
    }
    // Prior dompurify cells remain cleared under this higher pin.
    expect(ids).not.toContain("GHSA-v9jr-rg53-9pgp");
    expect(ids).not.toContain("GHSA-hpcv-96wg-7vj8");
    expect(ids).not.toContain("GHSA-r47g-fvhr-h676");
    expect(ids).not.toContain("GHSA-rp9w-3fw7-7cwq");
    expect(ids).not.toContain("GHSA-76mc-f452-cxcm");
    expect(ids).not.toContain("GHSA-cmwh-pvxp-8882");
    expect(ids).not.toContain("GHSA-vxr8-fq34-vvx9");
    expect(ids).not.toContain("GHSA-gvmj-g25r-r7wr");
    // Higher-threshold dompurify lows remain (not claimed here).
    expect(ids).toContain("GHSA-6688-9rhm-gjv2");
    // Prior Stage 6 cells remain cleared.
    expect(ids).not.toContain("GHSA-frvp-7c67-39w9");
    expect(ids).not.toContain("GHSA-hxh3-vqpv-xpqv");
    const meta = data.metadata?.vulnerabilities ?? {};
    expect(meta.critical ?? 0).toBe(0);
    expect(meta.high ?? 0).toBe(0);
    expect((meta.moderate ?? 0) + (meta.low ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
