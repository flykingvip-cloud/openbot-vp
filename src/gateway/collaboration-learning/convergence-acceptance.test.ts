import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readPromotedCapabilitiesForBot } from "../../auto-reply/reply/collaboration-learning-store.js";
import { commitSessionContinuity } from "../../auto-reply/reply/session-continuity.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  type OpenBotConfig,
} from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  isIntroductionFollowUpMessage,
  resolveBotsAlreadyIntroducedInThread,
} from "../collaboration-dispatch/group-inbound-history.js";
import type { CollaborationBotTarget } from "../collaboration-dispatch/types.js";
import {
  materializeGroupCollaborationWorkspace,
  resolveGroupCollaborationPaths,
} from "./collaboration-paths.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = path.join(repoRoot, "src");
const cleanupDirs: string[] = [];

function jsonlMessage(params: { id: string; role: "user" | "assistant"; text: string }) {
  return JSON.stringify({
    type: "message",
    id: params.id,
    message: {
      role: params.role,
      content: [{ type: "text", text: params.text }],
    },
  });
}

async function writeSessionFile(workspaceDir: string, lines: string[]) {
  const sessionsDir = path.join(workspaceDir, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, "group-session-1.jsonl");
  await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

async function walkSourceTsFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      await walkSourceTsFiles(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function withIsolatedCollaborationConfig<T>(
  workspaceDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-convergence-ac-state-"));
  cleanupDirs.push(stateDir);
  const previousState = process.env.OPENBOT_STATE_DIR;
  const previousConfig = process.env.OPENCLAW_CONFIG_PATH;
  const previousOpenbotConfig = process.env.OPENBOT_CONFIG_PATH;
  const isolatedConfigPath = path.join(stateDir, "openbot.json");
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
  process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
  await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
  await fs.writeFile(
    isolatedConfigPath,
    JSON.stringify({
      agents: { defaults: { workspace: workspaceDir } },
      collaboration: { defaults: { workspace: path.join(workspaceDir, "collaboration-shared") } },
    }),
    "utf8",
  );
  clearConfigCache();
  clearRuntimeConfigSnapshot();
  try {
    return await run();
  } finally {
    clearConfigCache();
    clearRuntimeConfigSnapshot();
    if (previousState === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousState;
    }
    if (previousConfig === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    }
    if (previousOpenbotConfig === undefined) {
      delete process.env.OPENBOT_CONFIG_PATH;
    } else {
      process.env.OPENBOT_CONFIG_PATH = previousOpenbotConfig;
    }
  }
}

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("Collaboration convergence acceptance (design §9)", () => {
  describe("AC-1 introduction follow-up", () => {
    const bots: CollaborationBotTarget[] = [
      { agentId: "bot-a", name: "Bot A", sessionKey: "a", updatedAt: 1 },
      { agentId: "bot-b", name: "Bot B", sessionKey: "b", updatedAt: 1 },
    ];

    it("skips bots who already introduced on follow-up prompts", () => {
      expect(isIntroductionFollowUpMessage("其他人也介绍一下自己")).toBe(true);
      const already = resolveBotsAlreadyIntroducedInThread({
        userMessage: "其他人也介绍一下自己",
        bots,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "各位介绍一下自己" }],
            timestamp: 1,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "大家好，我是 Bot A，负责市场分析。" }],
            timestamp: 2,
            senderLabel: "Bot A",
          },
          {
            role: "user",
            content: [{ type: "text", text: "其他人也介绍一下自己" }],
            timestamp: 3,
          },
        ],
      });
      expect([...already]).toEqual(["bot-a"]);
    });
  });

  describe("AC-2 shared group workspace", () => {
    it("materializes one canonical workspace path for every bot in the group", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-convergence-ac-ws-"));
      cleanupDirs.push(workspaceDir);
      const cfg = {
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: path.join(workspaceDir, "collaboration-shared") } },
      } satisfies OpenBotConfig;
      const groupId = "grp-shared-workspace";

      const botOnePath = await materializeGroupCollaborationWorkspace(groupId, cfg);
      const botTwoPath = await materializeGroupCollaborationWorkspace(groupId, cfg);
      const paths = resolveGroupCollaborationPaths(groupId, cfg);

      expect(botOnePath).toBe(botTwoPath);
      expect(botOnePath).toBe(paths.workspacePath);
      await expect(fs.stat(paths.memoryDir)).resolves.toBeDefined();
    });
  });

  describe("AC-3 single task_ledger", () => {
    it("writes continuity checkpoints only under the resolver collaboration root", async () => {
      const workspaceDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openbot-convergence-ac-ledger-"),
      );
      cleanupDirs.push(workspaceDir);
      const collaborationRoot = path.join(workspaceDir, "collaboration-shared");
      const cfg = {
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: collaborationRoot } },
      } satisfies OpenBotConfig;
      const groupId = "upbeyond";
      const sessionFile = await writeSessionFile(workspaceDir, [
        jsonlMessage({
          id: "g1",
          role: "user",
          text: "upbeyond 小组需要继续分析银川数贸平台可行性报告，并生成 SWOT 模块。",
        }),
      ]);

      const checkpoint = await commitSessionContinuity({
        cfg,
        workspaceDir,
        agentId: "bot-2",
        sessionKey: `agent:bot-2:main:space:${groupId}`,
        previousSessionEntry: {
          sessionId: "group-session-1",
          sessionFile,
          updatedAt: Date.now(),
          chatType: "group",
          groupId,
          space: groupId,
        } satisfies SessionEntry,
        reason: "rollover",
      });

      expect(checkpoint?.scope).toBe("group");

      const canonicalLedger = path.join(
        collaborationRoot,
        "groups",
        groupId,
        "memory",
        "task_ledger.json",
      );
      const legacyLedger = path.join(
        workspaceDir,
        ".openbot",
        "collaboration",
        "groups",
        encodeURIComponent(groupId),
        "memory",
        "task_ledger.json",
      );

      await expect(fs.access(canonicalLedger)).resolves.toBeUndefined();
      await expect(fs.access(legacyLedger)).rejects.toThrow();
    });
  });

  describe("AC-4 backflow and promoted capabilities", () => {
    it("reads promoted learning assets from the gateway collaboration store root", async () => {
      const workspaceDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "openbot-convergence-ac-promote-"),
      );
      cleanupDirs.push(workspaceDir);
      const collaborationRoot = path.join(workspaceDir, "collaboration-shared");
      const groupId = "group-promoted";
      const storeDir = path.join(collaborationRoot, "groups", encodeURIComponent(groupId));

      await withIsolatedCollaborationConfig(workspaceDir, async () => {
        await fs.mkdir(storeDir, { recursive: true });
        await fs.writeFile(
          path.join(storeDir, "learning-assets.json"),
          JSON.stringify({
            assets: [
              {
                assetId: "asset-1",
                botId: "bot-reviewer",
                sourceGroupId: groupId,
                sourceCapsuleId: "capsule-1",
                status: "active",
                abstractedContent: { capabilities: ["risk-scan"] },
              },
            ],
          }),
          "utf8",
        );

        const promoted = await readPromotedCapabilitiesForBot({
          workspaceDir,
          groupId,
          botId: "bot-reviewer",
        });
        expect(promoted).toEqual(["risk-scan"]);
      });
    });
  });

  describe("AC-5 guardrails", () => {
    it("does not reintroduce legacy readParticipations helper exports", async () => {
      const files = await walkSourceTsFiles(srcRoot);
      const offenders: string[] = [];
      for (const file of files) {
        const content = await fs.readFile(file, "utf8");
        if (/export function readParticipations\b/.test(content)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
      expect(offenders).toEqual([]);
    });

    it("does not export resolveCollaborationStoreRoot", async () => {
      const files = await walkSourceTsFiles(srcRoot);
      const offenders: string[] = [];
      for (const file of files) {
        const content = await fs.readFile(file, "utf8");
        if (/\bresolveCollaborationStoreRoot\b/.test(content)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
