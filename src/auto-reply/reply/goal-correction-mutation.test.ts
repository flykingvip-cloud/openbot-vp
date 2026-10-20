import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  applyGoalCorrectionMutation,
  buildActivePrimaryObjectivePrompt,
  extractGoalCorrectionMutation,
} from "./goal-correction-mutation.js";
import { createTaskContext, resolveTaskContextScope } from "./task-context-store.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("extractGoalCorrectionMutation", () => {
  it("detects zh correction with explicit goal", () => {
    const mutation = extractGoalCorrectionMutation(
      "你是不是搞错了，应该是要让数字人调用 github.com/gmood2008/tool 这个 MCP",
    );
    expect(mutation).not.toBeNull();
    expect(mutation?.goal).toContain("要让数字人调用");
  });

  it("returns null for neutral chit-chat", () => {
    expect(extractGoalCorrectionMutation("晚上好")).toBeNull();
  });

  it("does not treat unbound task_ledger as the primary objective (EA-I1)", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-goal-correction-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = {} as OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    await createTaskContext({
      scope,
      title: "竞品价格检查",
      description: "生成今日竞品价格检查结果",
    });
    const prompt = await buildActivePrimaryObjectivePrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    expect(prompt).toBeUndefined();
  });

  it("injects only the session-bound workspace task, and not as identity SoT", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-goal-correction-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = {} as OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    const task = await createTaskContext({
      scope,
      title: "网页调研",
      description: "开源智能体平台对比",
    });
    const prompt = await buildActivePrimaryObjectivePrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      sessionEntry: { sessionId: "s1", updatedAt: Date.now(), taskContextId: task.id },
    });
    expect(prompt).toContain("开源智能体平台对比");
    expect(prompt).toContain("not ConversationTask identity");
    expect(prompt).not.toContain("authoritative — overrides earlier plan drift");
  });

  it("does not mint unbound task_ledger rows from a correction (EA-I1)", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-goal-correction-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const result = await applyGoalCorrectionMutation({
      cfg: {} as OpenBotConfig,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      text: "你是不是搞错了，应该是要让数字人调用 github.com/gmood2008/tool 这个 MCP",
      sourceMessageId: "m-correction",
    });
    expect(result).toBeNull();
    await expect(
      fs.access(path.join(workspaceDir, "memory", "task_ledger.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("updates only the session-bound workspace task", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-goal-correction-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = {} as OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    const task = await createTaskContext({
      scope,
      title: "网页调研",
      description: "开源智能体平台对比",
    });
    const result = await applyGoalCorrectionMutation({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      sessionEntry: { sessionId: "s1", updatedAt: Date.now(), taskContextId: task.id },
      text: "你是不是搞错了，应该是要让数字人调用 github.com/gmood2008/tool 这个 MCP",
      sourceMessageId: "m-correction",
    });
    expect(result).toBe("updated");
    const prompt = await buildActivePrimaryObjectivePrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      sessionEntry: { sessionId: "s1", updatedAt: Date.now(), taskContextId: task.id },
    });
    expect(prompt).toContain("要让数字人调用");
  });
});
