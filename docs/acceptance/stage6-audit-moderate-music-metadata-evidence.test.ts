/**
 * Stage 6 narrow moderate audit evidence — GHSA-53v6-4h7p-p4gj (music-metadata).
 *
 * Pins one production moderate advisory mitigation via real `pnpm audit --prod`.
 * Does NOT claim Stage 6 PASS (audit still exits 1 on remaining moderate/low).
 * stage8_eligible stays false. Does not rewrite §5.4 matrix propositions.
 * Prior yaml / file-type / markdown-it / FXP / hono / node-server / dompurify /
 * mysql2 / qs narrow cells remain covered by their own evidence tests.
 * Honesty: same pin also clears sibling music-metadata GHSAs
 * (jjpr / 5gfj / f94x / 8j4c); those are documented side-clears, not second cells.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EVIDENCE = path.join(
  ROOT,
  "docs/acceptance/stage6-audit-moderate-music-metadata-evidence.json",
);
const TARGET = "GHSA-53v6-4h7p-p4gj";
const SIDE_CLEARS = [
  "GHSA-jjpr-9cvf-cq55",
  "GHSA-5gfj-9q3v-qfp3",
  "GHSA-f94x-6692-553q",
  "GHSA-8j4c-6x6g-rq3j",
] as const;

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

describe("Stage 6 narrow moderate audit (music-metadata GHSA-53v6-4h7p-p4gj)", () => {
  it("evidence JSON records the §5.4 field table for this one advisory", () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8")) as Evidence;
    expect(evidence.advisory).toBe(TARGET);
    expect(evidence.package).toBe("music-metadata");
    expect(evidence.severity).toBe("moderate");
    expect(evidence.mitigated_version).toBe("11.16.0");
    expect(evidence.acceptance_impact).toMatch(/not PASS|仍因|stays false|exit/i);
  });

  it("matrix dep + root override pin music-metadata >=11.16.0", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      pnpm: { overrides: Record<string, string> };
    };
    const ext = JSON.parse(
      fs.readFileSync(path.join(ROOT, "extensions/matrix/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(pkg.pnpm.overrides["music-metadata"]).toMatch(/^11\.16(\.\d+)?$/);
    expect(ext.dependencies["music-metadata"]).toMatch(/^\^?11\.16(\.\d+)?$/);
  });

  it("local pnpm audit --prod no longer lists GHSA-53v6-4h7p-p4gj; exit stays non-zero", () => {
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
