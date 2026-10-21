import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  RESTORE_OPEN_TASKS_FENCE_END,
  RESTORE_OPEN_TASKS_FENCE_START,
} from "./restore-task-isolation.js";
import {
  buildSessionContinuityPrompt,
  commitSessionContinuity,
  type ArtifactLedgerEntry,
} from "./session-continuity.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-session-continuity-"));
  tempDirs.push(dir);
  return dir;
}

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
  const file = path.join(sessionsDir, "session-1.jsonl");
  await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

describe("session continuity", () => {
  it("commits active tasks and artifacts for an agent session before rollover", async () => {
    const workspaceDir = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "请帮我写一篇公众号文章：欧洲史上最大种子轮，Ineffable 和 AlphaGo 之父 David Silver。",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "我会先检索背景资料，然后生成文章草稿。",
      }),
      jsonlMessage({
        id: "m3",
        role: "assistant",
        text: "已生成参考文件 Ineffable-article-draft.md",
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const previousSessionEntry = {
      sessionId: "session-1",
      sessionFile,
      updatedAt: Date.now(),
    } satisfies SessionEntry;

    const checkpoint = await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      previousSessionEntry,
      reason: "rollover",
    });

    expect(checkpoint?.scope).toBe("agent");
    expect(checkpoint?.owner_id).toBe("bot-2");
    expect(checkpoint?.open_tasks).toHaveLength(1);
    expect(checkpoint?.open_tasks[0]).toContain("欧洲史上最大种子轮");
    expect(checkpoint?.artifacts).toHaveLength(1);

    await expect(
      fs.access(path.join(workspaceDir, "memory", "task_ledger.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items[0]).toMatchObject({
      title: "Ineffable-article-draft.md",
      type: "doc",
      source_session: "session-1",
    });
    // Sprint-2: no synthetic unassigned task_id when session has no bound task.
    expect(artifactLedger.items[0]?.task_id).toBeUndefined();

    const prompt = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      sessionEntry: { sessionId: "session-2", updatedAt: Date.now() },
      isNewSession: true,
    });
    expect(prompt).not.toContain("Active tasks from Task Ledger");
    expect(prompt).not.toContain("authoritative — overrides earlier plan drift");
    expect(prompt).toContain("Latest checkpoint summary");
  });

  it("uses collaboration shared memory for group-scoped sessions", async () => {
    const workspaceDir = await makeTempDir();
    const collaborationRoot = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "g1",
        role: "user",
        text: "upbeyond 小组需要继续分析银川数贸平台可行性报告，并生成 SWOT 模块。",
      }),
    ]);
    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    } satisfies OpenBotConfig;
    const previousSessionEntry = {
      sessionId: "group-session-1",
      sessionFile,
      updatedAt: Date.now(),
      chatType: "group",
      groupId: "upbeyond",
      space: "upbeyond",
    } satisfies SessionEntry;

    const checkpoint = await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main:space:upbeyond",
      previousSessionEntry,
      reason: "rollover",
    });

    expect(checkpoint?.scope).toBe("group");
    expect(checkpoint?.owner_id).toBe("upbeyond");

    const groupMemoryRoot = path.join(collaborationRoot, "groups", "upbeyond", "memory");
    await expect(fs.access(path.join(groupMemoryRoot, "task_ledger.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(checkpoint?.open_tasks[0]).toContain("银川数贸平台可行性报告");

    const prompt = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main:space:upbeyond",
      sessionEntry: {
        sessionId: "group-session-2",
        updatedAt: Date.now(),
        chatType: "group",
        groupId: "upbeyond",
        space: "upbeyond",
      },
      isNewSession: true,
    });
    expect(prompt).toContain("银川数贸平台可行性报告");
    expect(prompt).toContain("Latest checkpoint summary");
  });

  it("injects continuity on every group-scoped turn, not only new sessions", async () => {
    const workspaceDir = await makeTempDir();
    const collaborationRoot = await makeTempDir();
    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    } satisfies OpenBotConfig;
    const groupId = "upbeyond";
    const memoryDir = path.join(collaborationRoot, "groups", groupId, "memory");
    await fs.mkdir(path.join(memoryDir, "checkpoints"), { recursive: true });
    await fs.writeFile(
      path.join(memoryDir, "task_ledger.json"),
      JSON.stringify({
        version: 1,
        updated_at: new Date().toISOString(),
        items: [
          {
            id: "task_live",
            scope: "group",
            owner_id: groupId,
            title: "进行中的群任务",
            description: "",
            status: "active",
            context: { key_points: ["需要继续推进"] },
            artifacts: [],
            last_session_id: "group-session-1",
            updated_at: new Date().toISOString(),
          },
        ],
      }),
      "utf8",
    );

    const prompt = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main:space:upbeyond",
      sessionEntry: {
        sessionId: "group-session-2",
        updatedAt: Date.now(),
        chatType: "group",
        groupId,
        space: groupId,
        taskContextId: "task_live",
      },
      isNewSession: false,
    });
    expect(prompt).toContain("进行中的群任务");
    expect(prompt).toContain("Bound workspace task context");
  });

  it("injects the bound task and checkpoint summary, not open_tasks or unbound rows", async () => {
    const workspaceDir = await makeTempDir();
    const memoryDir = path.join(workspaceDir, "memory");
    const now = new Date().toISOString();
    await fs.mkdir(path.join(memoryDir, "checkpoints"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "old-deliverable.md"), "bytes", "utf8");
    await fs.writeFile(
      path.join(memoryDir, "task_ledger.json"),
      JSON.stringify({
        version: 1,
        updated_at: now,
        items: [
          {
            id: "task_live",
            scope: "agent",
            owner_id: "main",
            title: "当前主线",
            description: "只这一条是当前任务",
            status: "active",
            context: { key_points: ["继续当前主线"] },
            artifacts: ["art_live"],
            last_session_id: "session-1",
            updated_at: now,
          },
          {
            id: "task_old",
            scope: "agent",
            owner_id: "main",
            title: "缺关系旧任务",
            description: "文件还在，但不能并进主线",
            status: "active",
            context: { key_points: ["旧任务停在这里"] },
            artifacts: ["art_old"],
            last_session_id: "session-0",
            updated_at: now,
          },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(memoryDir, "artifact_ledger.json"),
      JSON.stringify({
        version: 1,
        updated_at: now,
        items: [
          {
            id: "art_live",
            title: "current.md",
            type: "doc",
            task_id: "task_live",
            source_session: "session-1",
            version: 1,
            updated_at: now,
            summary: "current",
            state: "active",
          },
          {
            id: "art_old",
            title: "old-deliverable.md",
            type: "doc",
            task_id: "task_old",
            source_session: "session-0",
            version: 1,
            updated_at: now,
            summary: "old",
            state: "active",
          },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(memoryDir, "checkpoints", "latest.json"),
      JSON.stringify({
        id: "checkpoint-1",
        scope: "agent",
        owner_id: "main",
        session_id: "session-1",
        source_session_file: "session-1.jsonl",
        created_at: now,
        summary: "当前摘要保持独立",
        decisions: [],
        preferences: [],
        open_tasks: ["缺关系旧任务", "请生成 ghost-bleed.md"],
        completed_tasks: [],
        artifacts: ["art_old"],
        evidence_refs: [],
      }),
      "utf8",
    );
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const ledgerBefore = await fs.readFile(path.join(memoryDir, "task_ledger.json"), "utf8");

    const prompt = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionEntry: {
        sessionId: "session-2",
        updatedAt: Date.now(),
        taskContextId: "task_live",
      },
      isNewSession: true,
    });

    expect(prompt).toContain("当前主线");
    expect(prompt).toContain("当前摘要保持独立");
    expect(prompt).toContain("current.md");
    expect(prompt).not.toContain("Open tasks:");
    expect(prompt).not.toContain("缺关系旧任务");
    expect(prompt).not.toContain("ghost-bleed.md");
    expect(prompt).not.toContain("old-deliverable.md");
    expect(await fs.readFile(path.join(memoryDir, "task_ledger.json"), "utf8")).toBe(ledgerBefore);
  });

  it("does not bind a filename quoted by an isolated restore receipt to the current task", async () => {
    const workspaceDir = await makeTempDir();
    const fenced = [
      "Checkpoint restored.",
      "Summary: 当前摘要",
      RESTORE_OPEN_TASKS_FENCE_START,
      "Open tasks: 请生成 ghost-bleed.md",
      RESTORE_OPEN_TASKS_FENCE_END,
    ].join("\n");
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({ id: "m1", role: "user", text: "请帮我继续当前主线的会议纪要。" }),
      JSON.stringify({
        type: "message",
        id: "m-restore",
        message: {
          role: "assistant",
          content: [{ type: "text", text: fenced }],
          openclawRestoreTaskIsolation: {
            mainline: false,
            disposition: "pending_review",
            openTasks: ["请生成 ghost-bleed.md"],
          },
        },
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const checkpoint = await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      previousSessionEntry: {
        sessionId: "session-1",
        sessionFile,
        updatedAt: Date.now(),
        taskContextId: "task_live",
      },
      reason: "rollover",
    });
    expect(checkpoint?.open_tasks.join("\n") ?? "").not.toContain("ghost-bleed");
    expect(checkpoint?.open_tasks[0] ?? "").toContain("当前主线");
    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    ).catch(() => ({ items: [] as ArtifactLedgerEntry[] }));
    expect(artifactLedger.items.some((item) => item.title === "ghost-bleed.md")).toBe(false);
  });

  it("would bind a restore filename if the receipt were left on the task main line", async () => {
    const workspaceDir = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({ id: "m1", role: "user", text: "请帮我继续当前主线的会议纪要。" }),
      jsonlMessage({
        id: "m-restore",
        role: "assistant",
        text: "Checkpoint restored.\nOpen tasks: 请生成 ghost-bleed.md",
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      previousSessionEntry: {
        sessionId: "session-1",
        sessionFile,
        updatedAt: Date.now(),
      },
      reason: "rollover",
    });
    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items.some((item) => item.title === "ghost-bleed.md")).toBe(true);
  });
});
