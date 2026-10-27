import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { listAgentMemoryEntries } from "./memory-list.js";

describe("listAgentMemoryEntries (gateway re-export, DS path1)", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-gw-memory-list-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("lists relative memory keys under agent workspace corpus", async () => {
    const agentId = "main";
    const workspace = path.join(tmpRoot, "ws");
    await fs.mkdir(path.join(workspace, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspace, "memory", "pref.md"), "remember this", "utf-8");

    const cfg = {
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
      agents: { defaults: { workspace } },
    } as OpenBotConfig;

    const result = await listAgentMemoryEntries({ cfg, agentId });
    expect(result.entries.some((entry) => entry.key === "memory/pref.md")).toBe(true);
  });
});
