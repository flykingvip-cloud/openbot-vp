import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { isIndexedWorkspaceMemoryKey, listAgentMemoryEntries } from "./memory-list.js";

describe("listAgentMemoryEntries (DS path1)", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-memory-list-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("lists workspace MEMORY.md and memory/**/*.md only (not DS memory/agent)", async () => {
    const agentId = "main";
    const workspace = path.join(tmpRoot, "workspace-main");
    await fs.mkdir(path.join(workspace, "memory", "notes"), { recursive: true });
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "root memory", "utf-8");
    await fs.writeFile(
      path.join(workspace, "memory", "notes", "pref.md"),
      "remember this",
      "utf-8",
    );
    // Legacy DS-only file must NOT appear after path1 converge
    const dsOnly = path.join(tmpRoot, "agents", agentId, "memory", "agent", "legacy.md");
    await fs.mkdir(path.dirname(dsOnly), { recursive: true });
    await fs.writeFile(dsOnly, "legacy ds only", "utf-8");

    const cfg = {
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
      agents: { defaults: { workspace } },
    } as OpenBotConfig;

    const result = await listAgentMemoryEntries({ cfg, agentId });
    const keys = result.entries.map((e) => e.key);
    expect(keys).toContain("MEMORY.md");
    expect(keys).toContain("memory/notes/pref.md");
    expect(keys.some((k) => k.includes("legacy.md"))).toBe(false);
  });

  it("isIndexedWorkspaceMemoryKey rejects traversal and non-corpus paths", () => {
    expect(isIndexedWorkspaceMemoryKey("MEMORY.md")).toBe(true);
    expect(isIndexedWorkspaceMemoryKey("memory/a.md")).toBe(true);
    expect(isIndexedWorkspaceMemoryKey("../MEMORY.md")).toBe(false);
    expect(isIndexedWorkspaceMemoryKey("memory/agent/x.md")).toBe(true); // workspace-relative memory/**
    expect(isIndexedWorkspaceMemoryKey("notes/x.md")).toBe(false);
    expect(isIndexedWorkspaceMemoryKey("memory/secret.txt")).toBe(false);
  });
});
