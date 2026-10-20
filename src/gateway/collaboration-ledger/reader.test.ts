import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCollaborationLedgerArchive } from "./reader.js";
import {
  appendCollaborationContextScopeRecord,
  appendCollaborationGovernanceRecord,
  appendCollaborationQualityRecord,
} from "./writer.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("collaboration ledger archive", () => {
  it("reads governance records from canonical ledger path", async () => {
    const stateDir = await makeTempDir("openbot-ledger-state-");
    const workspaceDir = await makeTempDir("openbot-ledger-ws-");
    const collaborationRoot = await makeTempDir("openbot-ledger-root-");
    const previousState = process.env.OPENBOT_STATE_DIR;
    const previousConfig = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, "openbot.json");
    await fs.mkdir(path.dirname(process.env.OPENCLAW_CONFIG_PATH), { recursive: true });
    await fs.writeFile(
      process.env.OPENCLAW_CONFIG_PATH,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: collaborationRoot } },
      }),
      "utf8",
    );

    try {
      const groupId = `grp-ledger-scope-${Date.now()}`;
      await appendCollaborationGovernanceRecord({
        groupId,
        event: "charter_sync",
        lifecycleStatus: "ACTIVE",
        summary: "Charter synced",
        phase: "explore",
      });
      const archive = await readCollaborationLedgerArchive({ groupId, kinds: ["governance"] });
      expect(archive.records).toHaveLength(1);
      expect(archive.records[0]).toMatchObject({
        kind: "governance",
        event: "charter_sync",
        summary: "Charter synced",
      });
      await appendCollaborationContextScopeRecord({
        groupId,
        sessionKey: "space:alpha",
        mode: "focused",
        confidentialityMaxLevel: "internal",
        allowedSources: [{ type: "file", id: "notes.md" }],
        deniedSources: [],
        budgetMaxTokens: 24000,
        budgetMaxFiles: 20,
        evidenceCount: 1,
      });
      const scopeArchive = await readCollaborationLedgerArchive({
        groupId,
        kinds: ["context_scope"],
      });
      expect(scopeArchive.records).toHaveLength(1);
      expect(scopeArchive.records[0]).toMatchObject({
        kind: "context_scope",
        mode: "focused",
        budgetMaxFiles: 20,
      });
      await appendCollaborationQualityRecord({
        groupId,
        event: "handoff",
        outcome: "completed",
        agentId: "bot-a",
        taskId: "task-2",
        handoff: { from: "bot-a", to: "bot-b", reason: "need_specialist" },
        artifacts: ["notes.md"],
      });
      const qualityArchive = await readCollaborationLedgerArchive({
        groupId,
        kinds: ["quality"],
      });
      expect(qualityArchive.records).toHaveLength(1);
      expect(qualityArchive.records[0]).toMatchObject({
        kind: "quality",
        event: "handoff",
        handoff: { from: "bot-a", to: "bot-b", reason: "need_specialist" },
      });
    } finally {
      process.env.OPENBOT_STATE_DIR = previousState;
      process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    }
  });
});
