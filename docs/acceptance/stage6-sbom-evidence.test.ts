/**
 * Stage 6 formal SBOM evidence — @cyclonedx/cdxgen (OWASP) CycloneDX 1.6.
 *
 * Closes "正式 SBOM 文件" with standard tooling. Does NOT claim Stage 6 product PASS.
 * stage8_eligible stays false.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const COMMITTED = path.join(ROOT, "sbom", "openbot.cdx.json");
const GENERATOR = path.join(ROOT, "scripts", "generate-cyclonedx-sbom.ts");

type Bom = {
  bomFormat: string;
  specVersion: string;
  metadata?: {
    tools?: { components?: Array<{ name?: string; group?: string; version?: string }> };
    component?: { name?: string };
  };
  components?: Array<{ purl?: string; name?: string }>;
};

function normalizePurl(purl: string): string {
  // cdxgen occasionally toggles optional query params (e.g. repository_url) across runs.
  const q = purl.indexOf("?");
  return q >= 0 ? purl.slice(0, q) : purl;
}

function purlSet(bom: Bom): string[] {
  return (bom.components ?? [])
    .map((c) => normalizePurl(c.purl ?? ""))
    .filter(Boolean)
    .toSorted();
}

describe("Stage 6 formal SBOM (@cyclonedx/cdxgen)", () => {
  it("commits CycloneDX 1.6 JSON produced with cdxgen tool metadata", () => {
    expect(fs.existsSync(COMMITTED)).toBe(true);
    const bom = JSON.parse(fs.readFileSync(COMMITTED, "utf8")) as Bom;
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.6");
    expect((bom.components ?? []).length).toBeGreaterThan(100);
    const tools = bom.metadata?.tools?.components ?? [];
    expect(tools.some((t) => t.name === "cdxgen" && (t.group === "@cyclonedx" || !t.group))).toBe(
      true,
    );
    expect(tools.some((t) => (t.version ?? "").startsWith("12.8"))).toBe(true);
  });

  it("regenerates with the same component purl set (cdxgen timestamps may differ)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-sbom-"));
    const out = path.join(dir, "regen.cdx.json");
    try {
      execFileSync(process.execPath, ["--import", "tsx", GENERATOR, "--out", out], {
        cwd: ROOT,
        stdio: "pipe",
        env: process.env,
        timeout: 180_000,
      });
      const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8")) as Bom;
      const regenerated = JSON.parse(fs.readFileSync(out, "utf8")) as Bom;
      expect(regenerated.bomFormat).toBe("CycloneDX");
      expect(regenerated.specVersion).toBe("1.6");
      const tools = regenerated.metadata?.tools?.components ?? [];
      expect(tools.some((t) => t.name === "cdxgen")).toBe(true);
      expect(purlSet(regenerated)).toEqual(purlSet(committed));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 200_000);

  it("package.json exposes pnpm sbom:cyclonedx wrapping the cdxgen generator", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["sbom:cyclonedx"]).toMatch(/generate-cyclonedx-sbom/);
  });
});
