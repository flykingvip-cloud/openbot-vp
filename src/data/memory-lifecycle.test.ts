import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentMemoryDisposal, forgetMemoryEntry } from "./memory-lifecycle.js";

describe("memory-lifecycle", () => {
  const dataRoot = path.join(os.tmpdir(), `openbot-memory-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("forgets a memory file under agent memory/agent", async () => {
    const cfg = { data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 } };
    const memoryPath = path.join(dataRoot, "agents", "main", "memory", "agent", "note.md");
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(memoryPath, "# note", "utf-8");

    const result = await forgetMemoryEntry({
      cfg,
      agentId: "main",
      memoryKey: "note.md",
    });
    expect(result.deletedPath).toBe(memoryPath);
    await expect(fs.stat(memoryPath)).rejects.toThrow();
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
