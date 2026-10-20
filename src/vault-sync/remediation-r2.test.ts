import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveVaultKeySet } from "./crypto/keys.js";
import {
  baselineEntryChanged,
  loadInventoryBaseline,
  saveInventoryBaseline,
  upsertBaselineEntry,
} from "./journal/inventory-baseline.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("inventory baseline", () => {
  it("skips unchanged entries by mtime and size", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-baseline-"));
    tmpDirs.push(root);
    const storeDir = path.join(root, "state");
    const baseline = loadInventoryBaseline(storeDir, "vault-1", "dev-1");
    upsertBaselineEntry(baseline, {
      relativePath: "note.md",
      sizeBytes: 12,
      mtimeMs: 1000,
    });
    saveInventoryBaseline(baseline, storeDir);
    const reloaded = loadInventoryBaseline(storeDir, "vault-1", "dev-1");
    expect(baselineEntryChanged(reloaded, "note.md", 12, 1000)).toBe(false);
    expect(baselineEntryChanged(reloaded, "note.md", 13, 1000)).toBe(true);
  });
});

describe("epoch key derivation", () => {
  it("derives different content keys per encryption epoch", () => {
    const baseKey = Buffer.alloc(32, 7);
    const v1 = deriveVaultKeySet(baseKey, 1);
    const v2 = deriveVaultKeySet(baseKey, 2);
    expect(v1.contentKey.equals(v2.contentKey)).toBe(false);
  });
});
