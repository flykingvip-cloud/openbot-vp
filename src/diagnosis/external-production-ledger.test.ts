import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OHBE_LEDGER_URL, refuseLocalProductionLedger } from "./external-production-ledger.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("external production ledger", () => {
  it("fails with a bilingual pointer to the OHBE ledger", () => {
    expect(() => refuseLocalProductionLedger()).toThrow(/生产切流账本已不在本仓库/);
    expect(() => refuseLocalProductionLedger()).toThrow(/not in this repo/);
    expect(() => refuseLocalProductionLedger()).toThrow(OHBE_LEDGER_URL);
    expect(() => refuseLocalProductionLedger()).toThrow(/deploy\/production\/LEDGER\.md/);
  });

  it("diagnosis production CLIs no longer read a local ledger file", () => {
    const clis = readdirSync(here).filter((name) => /^production-.*\.cli\.ts$/.test(name));
    const readers = clis.filter((name) =>
      readFileSync(path.join(here, name), "utf8").includes("refuseLocalProductionLedger"),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const name of readers) {
      const source = readFileSync(path.join(here, name), "utf8");
      expect(source, name).not.toContain(
        'readFileSync(path.join(repoRoot, "deploy/production/releases.jsonl")',
      );
    }
    const stillReading = clis.filter((name) =>
      readFileSync(path.join(here, name), "utf8").includes(
        'readFileSync(path.join(repoRoot, "deploy/production/releases.jsonl")',
      ),
    );
    expect(stillReading).toEqual([]);
  });
});
