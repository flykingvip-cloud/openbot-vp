import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVaultSyncRuntimeReindex } from "../gateway/vault-sync-runtime-hook.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("runVaultSyncRuntimeReindex", () => {
  it("returns zero matches when root is missing and no knowledgeBaseId", async () => {
    const summary = await runVaultSyncRuntimeReindex({
      rootPath: path.join(os.tmpdir(), `missing-vault-root-${Date.now()}`),
      touchedRelativePaths: ["notes.md"],
      log: createSubsystemLogger("vault-sync-runtime-test"),
    });
    expect(summary.matchedBindings).toBe(0);
    expect(summary.rootAccessible).toBe(false);
    expect(summary.ingested).toBe(0);
  });

  it("returns zero matches when knowledgeBaseId has no local-folder binding", async () => {
    const summary = await runVaultSyncRuntimeReindex({
      knowledgeBaseId: `kb-none-${Date.now()}`,
      touchedRelativePaths: ["."],
      log: createSubsystemLogger("vault-sync-runtime-test"),
    });
    expect(summary.matchedBindings).toBe(0);
    expect(summary.knowledgeBaseId).toMatch(/^kb-none-/);
  });
});
