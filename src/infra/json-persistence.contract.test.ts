import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Mode B F4 — `openbot.data.json-persistence-helpers`.
 * Canonical write API: `writeJsonAtomic` in `json-files.ts`.
 * `saveJsonFile` in `json-file.ts` is a deprecated atomic-sync alias only.
 */
const INFRA_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(INFRA_DIR, "..");

const SENSITIVE_WRITE_SITES = [
  "agents/auth-profiles/store.ts",
  "agents/auth-profiles/paths.ts",
  "agents/cli-credentials.ts",
  "providers/github-copilot-token.ts",
  "infra/pairing-files.ts",
  "gateway/billing/seats-store.ts",
] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("F4 contract: writeJsonAtomic is the store write API", () => {
  it("marks json-file.ts deprecated and aliases writes to writeJsonAtomicSync", () => {
    const src = fs.readFileSync(path.join(INFRA_DIR, "json-file.ts"), "utf8");
    expect(src).toMatch(/@deprecated/);
    expect(src).toMatch(/writeJsonAtomicSync/);
    expect(src).toMatch(/New stores must call `writeJsonAtomic`/);
    expect(src).not.toMatch(/fs\.writeFileSync/);
  });

  it("forbids production stores from importing saveJsonFile", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      if (path.basename(file) === "json-file.ts") {
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      if (/import\s*\{[^}]*saveJsonFile/.test(src)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps credentials / seats / pairing on writeJsonAtomic or writeJsonAtomicSync", () => {
    for (const rel of SENSITIVE_WRITE_SITES) {
      const src = fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(src, rel).toMatch(/writeJsonAtomic(Sync)?/);
      expect(src, rel).not.toMatch(/saveJsonFile\s*\(/);
    }
  });

  it("documents writeJsonAtomic as the required API for new stores", () => {
    const src = fs.readFileSync(path.join(INFRA_DIR, "json-files.ts"), "utf8");
    expect(src).toMatch(/export async function writeJsonAtomic/);
    expect(src).toMatch(/New stores must use the async `writeJsonAtomic`/);
  });
});
