import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { buildActiveContextSystemPrompt } from "./context-budget-assembler.js";
import {
  bindSessionToTaskContext,
  createTaskContext,
  resolveTaskContextScope,
} from "./task-context-store.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-context-budget-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "memory"), { recursive: true });
  return dir;
}

describe("buildActiveContextSystemPrompt", () => {
  it("falls back to legacy continuity when context budget is disabled", async () => {
    const workspaceDir = await makeWorkspace();
    const cfg = {} as OpenBotConfig;
    const prompt = await buildActiveContextSystemPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      isNewSession: true,
    });
    expect(prompt).toBe("");
  });

  it("injects bound task summary when context budget is enabled", async () => {
    const workspaceDir = await makeWorkspace();
    const cfg = {
      agents: {
        defaults: {
          contextBudget: {
            maxTokens: 4000,
            priority: ["current_task", "session_summary"],
          },
        },
      },
    } as OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    const task = await createTaskContext({
      scope,
      title: "华为项目跟进",
      description: "客户 A 合同审批",
    });
    await bindSessionToTaskContext({
      scope,
      taskId: task.id,
      sessionKey: "agent:main:main",
      sessionId: "sess-1",
    });
    const prompt = await buildActiveContextSystemPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionEntry: { sessionId: "sess-1", updatedAt: Date.now(), taskContextId: task.id },
      isNewSession: true,
    });
    expect(prompt).toContain("华为项目跟进");
    expect(prompt).toContain("Active context");
  });

  it("does not inject unbound task_ledger rows as current_task (EA-I1)", async () => {
    const workspaceDir = await makeWorkspace();
    const cfg = {
      agents: {
        defaults: {
          contextBudget: {
            maxTokens: 4000,
            priority: ["current_task", "session_summary"],
          },
        },
      },
    } as OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    await createTaskContext({
      scope,
      title: "竞品价格检查",
      description: "生成今日竞品价格检查结果",
    });
    const prompt = await buildActiveContextSystemPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      isNewSession: true,
    });
    expect(prompt ?? "").not.toContain("竞品价格检查");
    expect(prompt ?? "").not.toContain("authoritative — overrides earlier plan drift");
  });

  it("does not inject recent transcript into the system prompt", async () => {
    const workspaceDir = await makeWorkspace();
    const cfg = {
      agents: {
        defaults: {
          contextBudget: {
            maxTokens: 4000,
            priority: ["recent_messages", "user_profile", "current_task"],
          },
        },
      },
    } as OpenBotConfig;
    const prompt = await buildActiveContextSystemPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      isNewSession: true,
    });
    expect(prompt ?? "").not.toMatch(/user said|最近消息|recent messages/i);
  });
});
