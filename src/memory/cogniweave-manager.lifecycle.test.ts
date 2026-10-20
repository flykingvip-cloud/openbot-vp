import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { CogniWeaveMemoryManager, resolveIndexedMemoryLocators } from "./cogniweave-manager.js";
import { closeAllMemorySearchManagers } from "./search-manager.js";

const tempDirs: string[] = [];
const ORIGINAL_STATE_DIR = process.env.OPENBOT_STATE_DIR;

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cw-lifecycle-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(workspace: string): OpenBotConfig {
  return {
    data: { root: path.join(workspace, "data-root"), mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
      },
    },
    agents: {
      list: [{ id: "main", default: true, workspace }],
    },
  };
}

afterEach(async () => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = ORIGINAL_STATE_DIR;
  }
  await closeAllMemorySearchManagers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolveIndexedMemoryLocators", () => {
  it("matches memory keys to indexed workspace paths without inventing locators", () => {
    const indexed = ["MEMORY.md", "memory/note.md", "sessions/main/a.jsonl"];
    expect(resolveIndexedMemoryLocators("MEMORY.md", indexed)).toEqual(["MEMORY.md"]);
    expect(resolveIndexedMemoryLocators("note.md", indexed)).toEqual(["memory/note.md"]);
    expect(resolveIndexedMemoryLocators("missing.md", indexed)).toEqual([]);
  });
});

describe("CogniWeaveMemoryManager.applyTranscriptSourceLifecycle", () => {
  it("archives then restores a path locator and filters search while archived", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      [
        "LifecyclePhraseUniqueAlpha should stay searchable while source is active.",
        "Prefer asynchronous buffering for recovery paths.",
      ].join("\n"),
      "utf8",
    );

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const before = await manager.search("LifecyclePhraseUniqueAlpha", { maxResults: 3 });
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]?.path).toBe("MEMORY.md");

    const archived = await manager.applyTranscriptSourceLifecycle({
      mode: "archive",
      sourceLocator: "MEMORY.md",
      operationId: "mgr-archive-memory",
      reasonCode: "TEST_ARCHIVE",
    });
    expect(archived.ok).toBe(true);
    expect(archived.status).toBe("archived");

    const whileArchived = await manager.search("LifecyclePhraseUniqueAlpha", { maxResults: 3 });
    expect(whileArchived.every((hit) => hit.path !== "MEMORY.md")).toBe(true);

    const restored = await manager.applyTranscriptSourceLifecycle({
      mode: "restore",
      sourceLocator: "MEMORY.md",
      operationId: "mgr-restore-memory",
      reasonCode: "TEST_RESTORE",
    });
    expect(restored.ok).toBe(true);
    expect(restored.status).toBe("active");

    const afterRestore = await manager.search("LifecyclePhraseUniqueAlpha", { maxResults: 3 });
    expect(afterRestore.some((hit) => hit.path === "MEMORY.md")).toBe(true);
  });

  it("forgets by sourceIdentityId and skips empty selectors", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "identity forget marker\n", "utf8");
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const skipped = await manager.applyTranscriptSourceLifecycle({
      mode: "forget",
      operationId: "mgr-forget-empty",
    });
    expect(skipped).toMatchObject({ ok: true, skipped: true });

    const forgotten = await manager.applyTranscriptSourceLifecycle({
      mode: "forget",
      sourceIdentityId: "sid_forget_marker",
      operationId: "mgr-forget-id",
      reasonCode: "TEST_FORGET",
    });
    expect(forgotten.ok).toBe(true);
    expect(forgotten.status).toBe("forgotten");
  });

  it("applyMemoryArtifactLifecycle skips unknown keys and forgets indexed MEMORY.md", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "artifact lifecycle marker\n", "utf8");
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const skipped = await manager.applyMemoryArtifactLifecycle({
      memoryKey: "never-indexed.md",
      operationId: "mgr-artifact-skip",
    });
    expect(skipped).toMatchObject({ ok: true, skipped: true, applied: [] });

    const applied = await manager.applyMemoryArtifactLifecycle({
      memoryKey: "MEMORY.md",
      operationId: "mgr-artifact-forget",
    });
    expect(applied.ok).toBe(true);
    expect(applied.skipped).toBe(false);
    expect(applied.applied).toEqual(["MEMORY.md"]);
  });
});
