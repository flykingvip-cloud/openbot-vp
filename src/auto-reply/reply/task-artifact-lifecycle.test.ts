import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContextCandidates } from "../../agents/context-compiler/candidates.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { buildActiveContextSystemPrompt } from "./context-budget-assembler.js";
import {
  assertNoActiveDanglingArtifacts,
  buildArtifactLedgerSummary,
  commitSessionContinuity,
  detachActiveDanglingArtifacts,
  detachArtifactsForTask,
  findActiveDanglingArtifacts,
  isActiveArtifactLink,
  isTerminalTaskStatus,
  normalizeTaskStatus,
  resolveActiveBoundTaskId,
  resolveArtifactLinkState,
  type ArtifactLedgerEntry,
  type TaskLedgerEntry,
  buildSessionContinuityPrompt,
} from "./session-continuity.js";
import {
  createTaskContext,
  getTaskContext,
  resolveTaskContextScope,
  updateTaskContext,
} from "./task-context-store.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-artifact-lifecycle-"));
  tempDirs.push(dir);
  return dir;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
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

async function writeArtifactLedger(rootDir: string, items: ArtifactLedgerEntry[]): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "artifact_ledger.json"),
    `${JSON.stringify(
      {
        version: 1,
        updated_at: new Date().toISOString(),
        items,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("Sprint-1 task–artifact lifecycle", () => {
  it("treats missing artifact state as active (legacy backward compatible)", () => {
    expect(resolveArtifactLinkState({})).toBe("active");
    expect(resolveArtifactLinkState({ state: undefined })).toBe("active");
    expect(resolveArtifactLinkState({ state: "active" })).toBe("active");
    expect(resolveArtifactLinkState({ state: "detached" })).toBe("detached");
    expect(resolveArtifactLinkState({ state: "archived" })).toBe("archived");
    expect(isActiveArtifactLink({ state: "detached" })).toBe(false);
    expect(isActiveArtifactLink({ state: "archived" })).toBe(false);
    expect(isActiveArtifactLink({})).toBe(true);
  });

  it("normalizes done/closed as terminal and maps closed → done", () => {
    expect(isTerminalTaskStatus("done")).toBe(true);
    expect(isTerminalTaskStatus("closed")).toBe(true);
    expect(isTerminalTaskStatus("CLOSED")).toBe(true);
    expect(isTerminalTaskStatus("active")).toBe(false);
    expect(isTerminalTaskStatus("paused")).toBe(false);
    expect(normalizeTaskStatus("closed")).toBe("done");
    expect(normalizeTaskStatus("done")).toBe("done");
    expect(normalizeTaskStatus("active")).toBe("active");
  });

  it("detaches artifacts on terminal task status and preserves task_id history", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
    });
    const task = await createTaskContext({
      scope,
      title: "交付方案",
      description: "写方案",
    });
    await writeArtifactLedger(scope.rootDir, [
      {
        id: "artifact_legacy",
        title: "plan.md",
        type: "doc",
        task_id: task.id,
        source_session: "s1",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "legacy row without state",
      },
      {
        id: "artifact_other",
        title: "other.md",
        type: "doc",
        task_id: "task_other",
        source_session: "s1",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "other task",
        state: "active",
      },
    ]);

    const updated = await updateTaskContext({
      scope,
      taskId: task.id,
      patch: { status: "done" },
    });
    expect(updated?.status).toBe("done");

    const ledger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(scope.rootDir, "artifact_ledger.json"),
    );
    const detached = ledger.items.find((item) => item.id === "artifact_legacy");
    const other = ledger.items.find((item) => item.id === "artifact_other");
    expect(detached?.state).toBe("detached");
    expect(detached?.task_id).toBe(task.id);
    expect(detached?.detached_from_task_id).toBe(task.id);
    expect(detached?.detached_at).toBeTruthy();
    expect(detached?.detached_reason).toBe("task_done");
    expect(other?.state).toBe("active");
    expect(other?.task_id).toBe("task_other");
  });

  it("accepts closed as terminal alias and does not reattach on reopen", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-1",
      sessionKey: "agent:bot-1:main",
    });
    const task = await createTaskContext({ scope, title: "关闭再开" });
    await writeArtifactLedger(scope.rootDir, [
      {
        id: "artifact_a",
        title: "a.md",
        type: "doc",
        task_id: task.id,
        source_session: "s1",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "linked",
        state: "active",
      },
    ]);

    await updateTaskContext({
      scope,
      taskId: task.id,
      patch: { status: "closed" as unknown as "done" },
    });
    let ledger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(scope.rootDir, "artifact_ledger.json"),
    );
    expect(ledger.items[0]?.state).toBe("detached");
    expect(ledger.items[0]?.detached_reason).toBe("task_done");
    expect(ledger.items[0]?.detached_from_task_id).toBe(task.id);

    const reopened = await updateTaskContext({
      scope,
      taskId: task.id,
      patch: { status: "active" },
    });
    expect(reopened?.status).toBe("active");
    ledger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(scope.rootDir, "artifact_ledger.json"),
    );
    expect(ledger.items[0]?.state).toBe("detached");
    expect(ledger.items[0]?.task_id).toBe(task.id);
  });

  it("checkpoint upsert does not resurrect detached artifact links", async () => {
    const workspaceDir = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "继续完善交付文档 draft-report.md",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "已更新参考文件 draft-report.md",
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // Pre-seed a detached artifact with the same stable title identity.
    const { createHash } = await import("node:crypto");
    const artifactId = `artifact_${createHash("sha256")
      .update(["agent", "bot-2", "draft-report.md"].join("\n"))
      .digest("hex")
      .slice(0, 16)}`;
    const originalTaskId = "task_original_history";
    await writeArtifactLedger(memoryDir, [
      {
        id: artifactId,
        title: "draft-report.md",
        type: "doc",
        task_id: originalTaskId,
        source_session: "old-session",
        version: 3,
        updated_at: "2020-01-01T00:00:00.000Z",
        summary: "previously detached",
        state: "detached",
        detached_at: "2020-01-01T00:00:00.000Z",
        detached_from_task_id: originalTaskId,
      },
    ]);

    const previousSessionEntry = {
      sessionId: "session-1",
      sessionFile,
      updatedAt: Date.now(),
    } satisfies SessionEntry;

    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      previousSessionEntry,
      reason: "rollover",
    });

    const ledger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(memoryDir, "artifact_ledger.json"),
    );
    const entry = ledger.items.find((item) => item.id === artifactId);
    expect(entry).toBeTruthy();
    expect(entry?.state).toBe("detached");
    expect(entry?.task_id).toBe(originalTaskId);
    expect(entry?.version).toBe(3);
    expect(entry?.source_session).toBe("old-session");
  });

  it("injection paths skip non-active current_task and detached artifacts", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
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
      title: "已完成任务",
      description: "不应再注入",
    });
    await writeArtifactLedger(scope.rootDir, [
      {
        id: "art_detached",
        title: "secret-detached.md",
        type: "doc",
        task_id: task.id,
        source_session: "s1",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "should not inject",
        state: "detached",
      },
      {
        id: "art_active",
        title: "visible.md",
        type: "doc",
        task_id: task.id,
        source_session: "s1",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "active link",
        state: "active",
      },
    ]);
    // Manually set task.artifacts via ledger rewrite (store has no attach API yet).
    const taskLedgerPath = path.join(scope.rootDir, "task_ledger.json");
    const taskLedger = await readJson<{
      version: 1;
      updated_at: string;
      items: Array<Record<string, unknown>>;
    }>(taskLedgerPath);
    taskLedger.items = taskLedger.items.map((item) =>
      item.id === task.id
        ? { ...item, artifacts: ["art_detached", "art_active"], status: "active" }
        : item,
    );
    await fs.writeFile(taskLedgerPath, `${JSON.stringify(taskLedger, null, 2)}\n`, "utf8");

    const continuity = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionEntry: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
      isNewSession: true,
    });
    expect(continuity).toContain("已完成任务");
    expect(continuity).toContain("visible.md");
    expect(continuity).not.toContain("secret-detached.md");

    // Mark task done → current_task injection must stop.
    await updateTaskContext({ scope, taskId: task.id, patch: { status: "done" } });

    const budgetPrompt = await buildActiveContextSystemPrompt({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionEntry: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
      isNewSession: true,
    });
    expect(budgetPrompt ?? "").not.toContain("已完成任务");
    expect(budgetPrompt ?? "").not.toContain("不应再注入");

    const candidates = await loadContextCandidates({
      cfg,
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionEntry: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
    });
    expect(candidates.task).toBe("");
  });

  it("detachArtifactsForTask is idempotent", async () => {
    const rootDir = await makeTempDir();
    await writeArtifactLedger(rootDir, [
      {
        id: "a1",
        title: "x.md",
        type: "doc",
        task_id: "t1",
        source_session: "s",
        version: 1,
        updated_at: new Date().toISOString(),
        summary: "x",
      },
    ]);
    const first = await detachArtifactsForTask({
      rootDir,
      taskId: "t1",
      reason: "task_terminal",
    });
    const second = await detachArtifactsForTask({ rootDir, taskId: "t1" });
    expect(first.detachedCount).toBe(1);
    expect(second.detachedCount).toBe(0);
    const ledger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(rootDir, "artifact_ledger.json"),
    );
    expect(ledger.items[0]?.state).toBe("detached");
    expect(ledger.items[0]?.detached_reason).toBe("task_terminal");
    expect(ledger.items[0]?.detached_from_task_id).toBe("t1");
  });

  it("ArtifactLinkState reserved contract includes archived", () => {
    const states: Array<"active" | "detached" | "archived"> = ["active", "detached", "archived"];
    expect(states).toContain("archived");
    expect(resolveArtifactLinkState({ state: "archived" })).toBe("archived");
    expect(isActiveArtifactLink({ state: "archived" })).toBe(false);
  });
});

describe("Sprint-2 tighten unassigned artifact binding", () => {
  function ghostUnassignedTaskId(scope: string, ownerId: string): string {
    return `task_${createHash("sha256")
      .update([scope, ownerId, "unassigned"].join("\n"))
      .digest("hex")
      .slice(0, 16)}`;
  }

  it("resolveActiveBoundTaskId requires an active ledger row", () => {
    expect(
      resolveActiveBoundTaskId({
        taskContextId: "task_missing",
        taskLedgerItems: [{ id: "task_other", status: "active" }],
      }),
    ).toBeUndefined();
    expect(
      resolveActiveBoundTaskId({
        taskContextId: "task_done",
        taskLedgerItems: [{ id: "task_done", status: "done" }],
      }),
    ).toBeUndefined();
    expect(
      resolveActiveBoundTaskId({
        taskContextId: "  task_live  ",
        taskLedgerItems: [{ id: "task_live", status: "active" }],
      }),
    ).toBe("task_live");
    expect(
      resolveActiveBoundTaskId({
        taskContextId: undefined,
        taskLedgerItems: [{ id: "task_live", status: "active" }],
      }),
    ).toBeUndefined();
  });

  it("commit without assigned task leaves artifact task_id unbound (no ghost unassigned)", async () => {
    const workspaceDir = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "请帮我整理一份竞品分析报告。",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "已生成参考文件 competitor-analysis.md",
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const agentId = "bot-2";
    const ghostId = ghostUnassignedTaskId("agent", agentId);

    const checkpoint = await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId,
      sessionKey: "agent:bot-2:main",
      previousSessionEntry: {
        sessionId: "session-1",
        sessionFile,
        updatedAt: Date.now(),
      },
      reason: "rollover",
    });

    expect(checkpoint?.artifacts).toHaveLength(1);
    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items).toHaveLength(1);
    const entry = artifactLedger.items[0];
    expect(entry?.title).toBe("competitor-analysis.md");
    expect(entry?.task_id).toBeUndefined();
    expect(entry?.task_id).not.toBe(ghostId);
    // No task_ledger row is created for the historical ghost id either.
    await expect(
      fs.access(path.join(workspaceDir, "memory", "task_ledger.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commit with real active taskContextId binds artifact to that ledger task", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    const task = await createTaskContext({
      scope,
      title: "竞品分析",
      description: "整理竞品",
    });
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "继续推进竞品分析，输出 competitor-analysis.md",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "已更新 competitor-analysis.md",
      }),
    ]);
    const ghostId = ghostUnassignedTaskId("agent", "bot-2");

    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      previousSessionEntry: {
        sessionId: "session-1",
        sessionFile,
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
      reason: "rollover",
    });

    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items).toHaveLength(1);
    expect(artifactLedger.items[0]?.task_id).toBe(task.id);
    expect(artifactLedger.items[0]?.task_id).not.toBe(ghostId);
    expect(artifactLedger.items[0]?.title).toBe("competitor-analysis.md");
  });

  it("commit ignores non-active taskContextId and stays unbound", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
    });
    const task = await createTaskContext({ scope, title: "已结束任务" });
    await updateTaskContext({ scope, taskId: task.id, patch: { status: "done" } });
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "assistant",
        text: "遗留文件 leftover-notes.md",
      }),
    ]);
    const ghostId = ghostUnassignedTaskId("agent", "bot-2");

    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      previousSessionEntry: {
        sessionId: "session-1",
        sessionFile,
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
      reason: "rollover",
    });

    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items[0]?.task_id).toBeUndefined();
    expect(artifactLedger.items[0]?.task_id).not.toBe(ghostId);
    expect(artifactLedger.items[0]?.task_id).not.toBe(task.id);
  });
});

describe("Sprint-3 immutable UUID task ids", () => {
  const TASK_UUID_ID = /^task_[0-9a-f]{32}$/;

  function legacyTitleHashTaskId(scope: string, ownerId: string, title: string): string {
    return `task_${createHash("sha256")
      .update([scope, ownerId, title].join("\n"))
      .digest("hex")
      .slice(0, 16)}`;
  }

  async function makeScope(agentId = "bot-sprint3") {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId,
      sessionKey: `agent:${agentId}:main`,
    });
    return { workspaceDir, cfg, scope, agentId };
  }

  it("createTaskContext mints task_<uuid-without-dashes> and does not use title-hash", async () => {
    const { scope } = await makeScope();
    const title = "Sprint3 新建任务";
    const task = await createTaskContext({ scope, title, description: "uuid mint" });

    expect(task.id).toMatch(TASK_UUID_ID);
    expect(task.id).not.toBe(legacyTitleHashTaskId(scope.scope, scope.ownerId, title));
    // Legacy was 16 hex; UUID mint is 32 hex after prefix.
    expect(task.id.length).toBe("task_".length + 32);
    expect(task.title).toBe(title);
  });

  it("create path does not derive id from title (same title → distinct ids)", async () => {
    const { scope } = await makeScope();
    const title = "同名任务不应碰撞身份";
    const a = await createTaskContext({ scope, title });
    const b = await createTaskContext({ scope, title });

    expect(a.id).toMatch(TASK_UUID_ID);
    expect(b.id).toMatch(TASK_UUID_ID);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(legacyTitleHashTaskId(scope.scope, scope.ownerId, title));
    expect(b.id).not.toBe(legacyTitleHashTaskId(scope.scope, scope.ownerId, title));
  });

  it("in-place title update keeps task id (lookup/update still work)", async () => {
    const { scope } = await makeScope();
    const task = await createTaskContext({
      scope,
      title: "原标题",
      description: "before",
    });
    const mintedId = task.id;
    expect(mintedId).toMatch(TASK_UUID_ID);

    const updated = await updateTaskContext({
      scope,
      taskId: mintedId,
      patch: { title: "新标题-不应改 id", description: "after" },
    });
    expect(updated).toBeDefined();
    expect(updated!.id).toBe(mintedId);
    expect(updated!.title).toBe("新标题-不应改 id");
    expect(updated!.description).toBe("after");

    const lookedUp = await getTaskContext(scope, mintedId);
    expect(lookedUp?.id).toBe(mintedId);
    expect(lookedUp?.title).toBe("新标题-不应改 id");
  });

  it("legacy title-hash rows remain valid for lookup/update (no rewrite)", async () => {
    const { scope } = await makeScope();
    const legacyTitle = "历史 title-hash 任务";
    const legacyId = legacyTitleHashTaskId(scope.scope, scope.ownerId, legacyTitle);
    await fs.writeFile(
      path.join(scope.rootDir, "task_ledger.json"),
      `${JSON.stringify(
        {
          version: 1,
          updated_at: new Date().toISOString(),
          items: [
            {
              id: legacyId,
              scope: scope.scope,
              owner_id: scope.ownerId,
              title: legacyTitle,
              description: "legacy",
              status: "active",
              context: { key_points: [] },
              artifacts: [],
              session_ids: [],
              last_session_id: "",
              updated_at: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const found = await getTaskContext(scope, legacyId);
    expect(found?.id).toBe(legacyId);
    expect(found?.title).toBe(legacyTitle);

    const renamed = await updateTaskContext({
      scope,
      taskId: legacyId,
      patch: { title: "改标题但保留旧 id" },
    });
    expect(renamed?.id).toBe(legacyId);
    expect(renamed?.title).toBe("改标题但保留旧 id");

    // Ledger still stores the legacy id (no migration rewrite on update).
    const ledger = await readJson<{ items: Array<{ id: string; title: string }> }>(
      path.join(scope.rootDir, "task_ledger.json"),
    );
    expect(ledger.items).toHaveLength(1);
    expect(ledger.items[0]?.id).toBe(legacyId);
    expect(ledger.items[0]?.title).toBe("改标题但保留旧 id");
  });
});

describe("Sprint-4 dangling CI assert + artifact summary", () => {
  function taskRow(
    overrides: Partial<TaskLedgerEntry> & Pick<TaskLedgerEntry, "id" | "status" | "title">,
  ): Pick<TaskLedgerEntry, "id" | "status" | "title"> {
    return {
      id: overrides.id,
      status: overrides.status,
      title: overrides.title,
    };
  }

  function artifactRow(
    overrides: Partial<ArtifactLedgerEntry> & Pick<ArtifactLedgerEntry, "id">,
  ): Pick<ArtifactLedgerEntry, "id" | "task_id" | "state"> {
    return {
      id: overrides.id,
      task_id: overrides.task_id,
      state: overrides.state,
    };
  }

  it("findActiveDanglingArtifacts flags missing and non-active task targets", () => {
    const tasks = [
      taskRow({ id: "task_live", status: "active", title: "Live" }),
      taskRow({ id: "task_done", status: "done", title: "Done" }),
      taskRow({ id: "task_paused", status: "paused", title: "Paused" }),
    ];
    const artifacts = [
      artifactRow({ id: "art_ok", task_id: "task_live", state: "active" }),
      artifactRow({ id: "art_missing", task_id: "task_ghost", state: "active" }),
      artifactRow({ id: "art_done", task_id: "task_done", state: "active" }),
      artifactRow({ id: "art_paused", task_id: "task_paused" }), // legacy missing state => active
    ];

    const dangling = findActiveDanglingArtifacts({
      artifactLedger: artifacts,
      taskLedger: tasks,
    });
    expect(dangling.map((d) => d.artifactId).toSorted()).toEqual([
      "art_done",
      "art_missing",
      "art_paused",
    ]);
    expect(dangling.find((d) => d.artifactId === "art_missing")?.reason).toBe("missing_task");
    expect(dangling.find((d) => d.artifactId === "art_done")).toMatchObject({
      reason: "non_active_task",
      taskStatus: "done",
    });
    expect(dangling.find((d) => d.artifactId === "art_paused")).toMatchObject({
      reason: "non_active_task",
      taskStatus: "paused",
    });
  });

  it("passes clean ledgers and treats unbound + detached as non-dangling", () => {
    const tasks = [taskRow({ id: "task_live", status: "active", title: "Live" })];
    const artifacts = [
      artifactRow({ id: "art_bound", task_id: "task_live", state: "active" }),
      artifactRow({ id: "art_unbound" }), // Sprint-2 unbound OK
      artifactRow({ id: "art_detached_missing", task_id: "task_gone", state: "detached" }),
      artifactRow({
        id: "art_detached_done",
        task_id: "task_live",
        state: "detached",
      }),
      artifactRow({ id: "art_archived", task_id: "task_gone", state: "archived" }),
    ];

    expect(findActiveDanglingArtifacts({ artifactLedger: artifacts, taskLedger: tasks })).toEqual(
      [],
    );
    expect(() =>
      assertNoActiveDanglingArtifacts({ artifactLedger: artifacts, taskLedger: tasks }),
    ).not.toThrow();
  });

  it("assertNoActiveDanglingArtifacts throws on violations", () => {
    expect(() =>
      assertNoActiveDanglingArtifacts({
        artifactLedger: [artifactRow({ id: "art_x", task_id: "missing", state: "active" })],
        taskLedger: [],
      }),
    ).toThrow(/active dangling artifacts forbidden/);
  });

  it("buildArtifactLedgerSummary prefers title/type/task snippet over placeholders", () => {
    expect(
      buildArtifactLedgerSummary({
        title: "competitor-analysis.md",
        type: "doc",
        taskTitle: "竞品分析",
      }),
    ).toBe("competitor-analysis.md (doc) — 竞品分析");
    expect(
      buildArtifactLedgerSummary({
        title: "deck.pptx",
        type: "ppt",
      }),
    ).toBe("deck.pptx (ppt)");
    // Legacy placeholder strings remain readable opaque text (no rewrite required).
    const legacyPlaceholder = "Referenced during session session-old.";
    expect(typeof legacyPlaceholder).toBe("string");
    expect(legacyPlaceholder).toMatch(/^Referenced during session /);
  });

  it("commitSessionContinuity writes contextual summary instead of session placeholder", async () => {
    const workspaceDir = await makeTempDir();
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-s4",
      sessionKey: "agent:bot-s4:main",
    });
    const task = await createTaskContext({
      scope,
      title: "竞品分析 Sprint4",
      description: "summary rewrite",
    });
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "继续推进竞品分析，输出 competitor-analysis.md",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "已更新 competitor-analysis.md",
      }),
    ]);

    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-s4",
      sessionKey: "agent:bot-s4:main",
      previousSessionEntry: {
        sessionId: "session-s4",
        sessionFile,
        updatedAt: Date.now(),
        taskContextId: task.id,
      },
      reason: "rollover",
    });

    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items).toHaveLength(1);
    const entry = artifactLedger.items[0];
    expect(entry?.title).toBe("competitor-analysis.md");
    expect(entry?.task_id).toBe(task.id);
    expect(entry?.summary).toBe("competitor-analysis.md (doc) — 竞品分析 Sprint4");
    expect(entry?.summary).not.toMatch(/^Referenced during session /);

    // Hygiene assert passes for the freshly written ledger.
    const taskLedger = await readJson<{ items: Array<Pick<TaskLedgerEntry, "id" | "status">> }>(
      path.join(workspaceDir, "memory", "task_ledger.json"),
    );
    expect(() =>
      assertNoActiveDanglingArtifacts({
        artifactLedger: artifactLedger.items,
        taskLedger: taskLedger.items,
      }),
    ).not.toThrow();
  });

  it("commit without task still writes title/type summary (not session placeholder)", async () => {
    const workspaceDir = await makeTempDir();
    const sessionFile = await writeSessionFile(workspaceDir, [
      jsonlMessage({
        id: "m1",
        role: "user",
        text: "请帮我整理一份竞品分析报告。",
      }),
      jsonlMessage({
        id: "m2",
        role: "assistant",
        text: "已生成参考文件 competitor-analysis.md",
      }),
    ]);
    const cfg = { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenBotConfig;

    await commitSessionContinuity({
      cfg,
      workspaceDir,
      agentId: "bot-s4b",
      sessionKey: "agent:bot-s4b:main",
      previousSessionEntry: {
        sessionId: "session-s4b",
        sessionFile,
        updatedAt: Date.now(),
      },
      reason: "rollover",
    });

    const artifactLedger = await readJson<{ items: ArtifactLedgerEntry[] }>(
      path.join(workspaceDir, "memory", "artifact_ledger.json"),
    );
    expect(artifactLedger.items[0]?.task_id).toBeUndefined();
    expect(artifactLedger.items[0]?.summary).toBe("competitor-analysis.md (doc)");
    expect(artifactLedger.items[0]?.summary).not.toMatch(/^Referenced during session /);
  });
});

describe("Sprint-5 active dangling artifact GC", () => {
  const NOW = "2026-09-27T00:00:00.000Z";

  function fullArtifact(
    overrides: Partial<ArtifactLedgerEntry> & Pick<ArtifactLedgerEntry, "id">,
  ): ArtifactLedgerEntry {
    return {
      id: overrides.id,
      title: overrides.title ?? `${overrides.id}.md`,
      type: overrides.type ?? "doc",
      task_id: overrides.task_id,
      source_session: overrides.source_session ?? "session-s5",
      version: overrides.version ?? 1,
      updated_at: overrides.updated_at ?? "2026-09-01T00:00:00.000Z",
      summary: overrides.summary ?? "fixture",
      state: overrides.state,
      detached_at: overrides.detached_at,
      detached_from_task_id: overrides.detached_from_task_id,
      detached_reason: overrides.detached_reason,
    };
  }

  it("detaches active dangling violators and preserves task_id history", () => {
    const tasks: Pick<TaskLedgerEntry, "id" | "status">[] = [
      { id: "task_live", status: "active" },
      { id: "task_done", status: "done" },
      { id: "task_paused", status: "paused" },
    ];
    const artifacts: ArtifactLedgerEntry[] = [
      fullArtifact({ id: "art_ok", task_id: "task_live", state: "active" }),
      fullArtifact({ id: "art_missing", task_id: "task_ghost", state: "active" }),
      fullArtifact({ id: "art_done", task_id: "task_done", state: "active" }),
      fullArtifact({ id: "art_paused", task_id: "task_paused" }), // legacy missing state => active
    ];

    const result = detachActiveDanglingArtifacts({
      artifactLedger: artifacts,
      taskLedger: tasks,
      now: NOW,
    });

    expect(result.detachedCount).toBe(3);
    expect(result.detached.map((d) => d.artifactId).toSorted()).toEqual([
      "art_done",
      "art_missing",
      "art_paused",
    ]);
    expect(result.detached.find((d) => d.artifactId === "art_missing")).toEqual({
      artifactId: "art_missing",
      taskId: "task_ghost",
      reason: "gc_task_missing",
    });
    expect(result.detached.find((d) => d.artifactId === "art_done")).toEqual({
      artifactId: "art_done",
      taskId: "task_done",
      reason: "gc_task_not_active",
    });
    expect(result.detached.find((d) => d.artifactId === "art_paused")).toEqual({
      artifactId: "art_paused",
      taskId: "task_paused",
      reason: "gc_task_not_active",
    });

    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get("art_ok")).toMatchObject({ state: "active", task_id: "task_live" });
    expect(byId.get("art_ok")?.detached_at).toBeUndefined();

    for (const id of ["art_missing", "art_done", "art_paused"] as const) {
      const row = byId.get(id);
      expect(row?.state).toBe("detached");
      expect(row?.detached_at).toBe(NOW);
      expect(row?.updated_at).toBe(NOW);
      expect(row?.task_id).toBeTruthy();
      expect(row?.detached_from_task_id).toBe(row?.task_id);
    }
    expect(byId.get("art_missing")?.detached_reason).toBe("gc_task_missing");
    expect(byId.get("art_done")?.detached_reason).toBe("gc_task_not_active");
    expect(byId.get("art_paused")?.detached_reason).toBe("gc_task_not_active");

    // Input not mutated.
    expect(artifacts.find((a) => a.id === "art_missing")?.state).toBe("active");
  });

  it("leaves unbound, detached, and archived artifacts alone", () => {
    const tasks: Pick<TaskLedgerEntry, "id" | "status">[] = [{ id: "task_live", status: "active" }];
    const artifacts: ArtifactLedgerEntry[] = [
      fullArtifact({ id: "art_bound", task_id: "task_live", state: "active" }),
      fullArtifact({ id: "art_unbound" }), // Sprint-2 unbound
      fullArtifact({
        id: "art_detached_missing",
        task_id: "task_gone",
        state: "detached",
        detached_at: "2026-08-01T00:00:00.000Z",
        detached_from_task_id: "task_gone",
        detached_reason: "task_done",
      }),
      fullArtifact({
        id: "art_archived",
        task_id: "task_gone",
        state: "archived",
      }),
    ];

    const result = detachActiveDanglingArtifacts({
      artifactLedger: artifacts,
      taskLedger: tasks,
      now: NOW,
    });

    expect(result.detachedCount).toBe(0);
    expect(result.detached).toEqual([]);
    expect(result.items).toHaveLength(4);
    expect(result.items.find((a) => a.id === "art_unbound")?.state).toBeUndefined();
    expect(result.items.find((a) => a.id === "art_unbound")?.task_id).toBeUndefined();
    expect(result.items.find((a) => a.id === "art_detached_missing")).toMatchObject({
      state: "detached",
      detached_reason: "task_done",
      detached_at: "2026-08-01T00:00:00.000Z",
    });
    expect(result.items.find((a) => a.id === "art_archived")?.state).toBe("archived");
    expect(result.items.find((a) => a.id === "art_bound")?.state).toBe("active");
  });

  it("second pass is idempotent (no re-detach)", () => {
    const tasks: Pick<TaskLedgerEntry, "id" | "status">[] = [{ id: "task_done", status: "done" }];
    const artifacts: ArtifactLedgerEntry[] = [
      fullArtifact({ id: "art_done", task_id: "task_done", state: "active" }),
      fullArtifact({ id: "art_missing", task_id: "task_ghost", state: "active" }),
      fullArtifact({ id: "art_unbound" }),
    ];

    const first = detachActiveDanglingArtifacts({
      artifactLedger: artifacts,
      taskLedger: tasks,
      now: NOW,
    });
    expect(first.detachedCount).toBe(2);

    const second = detachActiveDanglingArtifacts({
      artifactLedger: first.items,
      taskLedger: tasks,
      now: "2026-09-28T00:00:00.000Z",
    });
    expect(second.detachedCount).toBe(0);
    expect(second.detached).toEqual([]);
    expect(
      findActiveDanglingArtifacts({
        artifactLedger: second.items,
        taskLedger: tasks,
      }),
    ).toEqual([]);

    const done = second.items.find((a) => a.id === "art_done");
    expect(done?.detached_at).toBe(NOW); // unchanged from first pass
    expect(done?.detached_reason).toBe("gc_task_not_active");
    expect(second.items.find((a) => a.id === "art_unbound")?.state).toBeUndefined();
  });
});
