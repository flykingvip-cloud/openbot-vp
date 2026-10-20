import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { listAgentMemoryEntries } from "./memory-list.js";

describe("listAgentMemoryEntries", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-memory-list-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("lists relative memory keys under agent data space", async () => {
    const agentId = "main";
    const notePath = path.join(tmpRoot, "agents", agentId, "memory", "agent", "notes", "pref.md");
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, "remember this", "utf-8");

    const cfg = {
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig;

    const result = await listAgentMemoryEntries({ cfg, agentId });
    expect(result.entries.some((entry) => entry.key.endsWith("pref.md"))).toBe(true);
  });
});
