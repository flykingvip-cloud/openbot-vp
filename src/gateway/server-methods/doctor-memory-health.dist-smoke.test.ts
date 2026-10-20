import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveProbeModuleSha } from "../../memory/health-probe-build-info.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const buildInfoPath = path.join(repoRoot, "dist/build-info.json");

function findDistRootChunk(prefix: string, requiredSnippets: readonly string[]): string | null {
  const distDir = path.join(repoRoot, "dist");
  if (!fs.existsSync(distDir)) {
    return null;
  }
  const match = fs
    .readdirSync(distDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .find((name) => {
      const text = fs.readFileSync(path.join(distDir, name), "utf8");
      return requiredSnippets.every((snippet) => text.includes(snippet));
    });
  return match ? path.join(distDir, match) : null;
}

function assertChunkDoesNotReadProbeSource(bundled: string): void {
  expect(bundled).not.toMatch(/readFileSync\([^)]*health-probe\.ts/);
  expect(bundled).not.toMatch(/new URL\([^)]*health-probe\.ts/);
}

describe("doctor.memory.health dist smoke", () => {
  it("build-info injects probeModuleSha and dist chunks do not read .ts", () => {
    if (!fs.existsSync(buildInfoPath)) {
      expect.fail("dist/build-info.json missing; run write-build-info after tsdown-build");
    }
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8")) as {
      probeModuleSha?: string;
    };
    expect(buildInfo.probeModuleSha).toMatch(/^[0-9a-f]{16}$/);

    const rpcChunk = findDistRootChunk("doctor-memory-health-", [
      "memory-health-report/v2",
      "build-info.json",
    ]);
    if (!rpcChunk) {
      expect.fail(
        "doctor-memory-health chunk with v2 report and build-info.json missing after tsdown-build",
      );
    }
    const bundled = fs.readFileSync(rpcChunk, "utf8");
    assertChunkDoesNotReadProbeSource(bundled);
    expect(bundled).toContain("build-info.json");
    expect(bundled).toContain("memory-health-report/v2");

    const cliChunk = findDistRootChunk("memory-health-cli-", ["memory-health-report/v2"]);
    if (!cliChunk) {
      expect.fail(
        "memory-health-cli chunk with memory-health-report/v2 missing after tsdown-build",
      );
    }
    assertChunkDoesNotReadProbeSource(fs.readFileSync(cliChunk, "utf8"));

    const shaFromDistContext = resolveProbeModuleSha({
      moduleUrl: pathToFileURL(rpcChunk).href,
    });
    expect(shaFromDistContext).toBe(buildInfo.probeModuleSha);
    expect(shaFromDistContext).not.toBe("unknown");
  });
});
