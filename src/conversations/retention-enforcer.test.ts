import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { runConversationRetentionEnforcement } from "./retention-enforcer.js";

describe("runConversationRetentionEnforcement", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-retention-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("deletes archived sessions past deleteAfterDays", async () => {
    const agentId = "main";
    const dataRoot = tmpRoot;
    const archiveDir = path.join(dataRoot, "agents", agentId, "conversations", "archive");
    const indexPath = path.join(dataRoot, "agents", agentId, "conversations", "index.json");
    await fs.mkdir(archiveDir, { recursive: true });
    const sessionId = "sess-old";
    await fs.writeFile(path.join(archiveDir, `${sessionId}.jsonl`), '{"type":"message"}\n');
    const archivedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      indexPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: archivedAt,
          sessions: [
            {
              sessionId,
              archivedAt,
              relativePath: `archive/${sessionId}.jsonl`,
              bytes: 20,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const cfg = {
      data: { root: dataRoot, mode: "local", schemaVersion: 1 },
      gateway: {
        tenantPolicies: {
          default: {
            retention: {
              conversation: { deleteAfterDays: 365 },
            },
          },
        },
      },
    } as OpenBotConfig;

    const dryRun = await runConversationRetentionEnforcement({
      cfg,
      agentId,
      dryRun: true,
    });
    expect(dryRun.deletedSessions).toBe(1);
    expect(await fs.stat(path.join(archiveDir, `${sessionId}.jsonl`))).toBeTruthy();

    const applied = await runConversationRetentionEnforcement({
      cfg,
      agentId,
      dryRun: false,
    });
    expect(applied.deletedSessions).toBe(1);
    await expect(fs.stat(path.join(archiveDir, `${sessionId}.jsonl`))).rejects.toThrow();
  });
});
