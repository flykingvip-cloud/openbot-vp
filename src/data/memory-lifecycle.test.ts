import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentMemoryDisposal, forgetMemoryEntry } from "./memory-lifecycle.js";

describe("memory-lifecycle (DS path1 forget)", () => {
  const dataRoot = path.join(os.tmpdir(), `openbot-memory-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("forgets a workspace-indexed memory file and ignores DS memory/agent", async () => {
    const workspace = path.join(dataRoot, "workspace-main");
    await fs.mkdir(path.join(workspace, "memory"), { recursive: true });
    const memoryPath = path.join(workspace, "memory", "note.md");
    await fs.writeFile(memoryPath, "# note", "utf-8");
    const expectedDeleted = await fs.realpath(memoryPath);
    const dsOnly = path.join(dataRoot, "agents", "main", "memory", "agent", "note.md");
    await fs.mkdir(path.dirname(dsOnly), { recursive: true });
    await fs.writeFile(dsOnly, "# ds", "utf-8");

    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
      agents: { defaults: { workspace } },
    };

    const result = await forgetMemoryEntry({
      cfg,
      agentId: "main",
      memoryKey: "memory/note.md",
    });
    expect(result.deletedPath).toBe(expectedDeleted);
    await expect(fs.stat(memoryPath)).rejects.toThrow();
    // DS legacy file untouched
    await expect(fs.stat(dsOnly)).resolves.toBeDefined();

    const dsKeyForget = await forgetMemoryEntry({
      cfg,
      agentId: "main",
      memoryKey: "note.md",
    });
    expect(dsKeyForget.deletedPath).toBeNull();
    await expect(fs.stat(dsOnly)).resolves.toBeDefined();
  });

  it("rejects path traversal forget keys", async () => {
    const workspace = path.join(dataRoot, "workspace-trav");
    await fs.mkdir(workspace, { recursive: true });
    const outside = path.join(dataRoot, "secret.md");
    await fs.writeFile(outside, "nope", "utf-8");
    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
      agents: { defaults: { workspace } },
    };
    const result = await forgetMemoryEntry({
      cfg,
      agentId: "main",
      memoryKey: "../secret.md",
    });
    expect(result.deletedPath).toBeNull();
    await expect(fs.stat(outside)).resolves.toBeDefined();
  });

  it("keeps conversations archive when disposal mode is keep_artifacts_conversations", async () => {
    const cfg = { data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 } };
    const agentRoot = path.join(dataRoot, "agents", "bot-a");
    await fs.mkdir(path.join(agentRoot, "memory", "agent"), { recursive: true });
    await fs.mkdir(path.join(agentRoot, "conversations", "archive"), { recursive: true });
    await fs.writeFile(path.join(agentRoot, "memory", "agent", "m.md"), "x", "utf-8");
    await fs.writeFile(path.join(agentRoot, "conversations", "archive", "s.jsonl"), "{}", "utf-8");

    await applyAgentMemoryDisposal({
      cfg,
      agentId: "bot-a",
      mode: "keep_artifacts_conversations",
    });

    await expect(
      fs.stat(path.join(agentRoot, "conversations", "archive", "s.jsonl")),
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(agentRoot, "memory", "agent", "m.md"))).rejects.toThrow();
  });
});
