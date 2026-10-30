import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESTORE_OPEN_TASKS_FENCE_START } from "../../auto-reply/reply/restore-task-isolation.js";
import {
  buildSessionContinuityPrompt,
  commitSessionContinuity,
  commitSessionContinuityForCurrentSession,
} from "../../auto-reply/reply/session-continuity.js";
import { resolveGroupPublicTranscriptPath } from "../collaboration-learning/collaboration-paths.js";

const state = vi.hoisted(() => ({
  transcriptPath: "",
  sessionFile: "",
  sessionId: "",
  memoryDir: "",
  tenantWorkspaceDir: "",
  denyAuthorizedCwd: false,
  decoyWorkspaceDir: "",
  groupId: "",
  taskContextId: "",
}));

const listSpacesMock = vi.hoisted(() =>
  vi.fn(async () => ({
    spaces: [] as Array<{
      id: string;
      groupId: string;
      ownerUserId: string | null;
      members: { humans: Array<{ userId: string; name: string; status?: string }> };
    }>,
  })),
);

vi.mock("../collaboration-learning.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../collaboration-learning.js")>();
  return {
    ...original,
    listGatewayCollaborationSpaces: (...args: unknown[]) => listSpacesMock(...args),
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: () => ({
      cfg: {},
      storePath: path.join(path.dirname(state.transcriptPath), "sessions.json"),
      entry: {
        sessionId: state.sessionId,
        sessionFile: state.sessionFile || state.transcriptPath,
        ...(state.groupId ? { groupId: state.groupId, space: state.groupId } : {}),
        ...(state.taskContextId ? { taskContextId: state.taskContextId } : {}),
      },
      canonicalKey: "main",
    }),
  };
});

vi.mock("../../agents/agent-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../agents/agent-scope.js")>();
  return {
    ...original,
    resolveAgentWorkspaceDir: () => path.dirname(state.memoryDir),
    resolveSessionAgentId: () => (state.tenantWorkspaceDir ? "bot-skill" : "main"),
  };
});

vi.mock("../workspace/handler-bridge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../workspace/handler-bridge.js")>();
  return {
    ...original,
    resolveWorkspaceDirAfterAuthorization: (
      params: Parameters<typeof original.resolveWorkspaceDirAfterAuthorization>[0],
    ) => {
      if (state.decoyWorkspaceDir) {
        return state.decoyWorkspaceDir;
      }
      if (state.denyAuthorizedCwd) {
        return null;
      }
      return original.resolveWorkspaceDirAfterAuthorization(params);
    },
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    resolveAgentWorkspaceDirForClient: async (client: unknown, agentId: string, cfg?: unknown) => {
      if (state.tenantWorkspaceDir) {
        return state.tenantWorkspaceDir;
      }
      return original.resolveAgentWorkspaceDirForClient(client as never, agentId, cfg as never);
    },
  };
});

vi.mock("../workspace-resolver/strict-locator.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../workspace-resolver/strict-locator.js")>();
  return {
    ...original,
    resolveWorkspaceLocator: (params: Parameters<typeof original.resolveWorkspaceLocator>[0]) => {
      const locator =
        state.tenantWorkspaceDir || (state.memoryDir ? path.dirname(state.memoryDir) : "");
      if (locator) {
        return {
          ok: true as const,
          handle: {
            resourceId: "restore-fixture",
            agentAssetId: "restore-fixture",
            bindingId: "restore-fixture",
            locator,
            tenantId: "restore-fixture",
          },
          locator: {
            resourceId: "restore-fixture",
            agentAssetId: "restore-fixture",
            bindingId: "restore-fixture",
            locator,
            tenantId: "restore-fixture",
          },
        };
      }
      return original.resolveWorkspaceLocator(params);
    },
  };
});

const { chatCheckpointHandlers } = await import("./chat-checkpoints.js");
const { chatHandlers, sanitizeChatHistoryMessagesForTest } = await import("./chat.js");

async function writeTranscriptHeader(transcriptPath: string, sessionId: string) {
  await fs.writeFile(
    transcriptPath,
    `${JSON.stringify({
      type: "session",
      version: 1,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    })}\n`,
    "utf8",
  );
}

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-chat-restore-"));
  const sessionId = "sess-main";
  const transcriptPath = path.join(dir, `${sessionId}.jsonl`);
  const memoryDir = path.join(dir, "memory");
  const checkpointDir = path.join(memoryDir, "checkpoints");
  await fs.mkdir(checkpointDir, { recursive: true });
  await writeTranscriptHeader(transcriptPath, sessionId);
  await fs.writeFile(
    path.join(checkpointDir, "latest.json"),
    JSON.stringify({
      id: "checkpoint-1",
      scope: "agent",
      owner_id: "main",
      session_id: sessionId,
      source_session_file: transcriptPath,
      created_at: new Date().toISOString(),
      summary: "恢复到上一个稳定工作上下文",
      decisions: [],
      preferences: [],
      open_tasks: ["task_a"],
      completed_tasks: ["task_done"],
      artifacts: ["artifact_x"],
      evidence_refs: [],
    }),
    "utf8",
  );
  state.transcriptPath = transcriptPath;
  state.sessionId = sessionId;
  state.memoryDir = memoryDir;
  return { dir };
}

afterEach(async () => {
  if (state.transcriptPath) {
    await fs.rm(path.dirname(state.transcriptPath), { recursive: true, force: true });
  }
  state.transcriptPath = "";
  state.sessionFile = "";
  state.sessionId = "";
  state.memoryDir = "";
  state.tenantWorkspaceDir = "";
  state.denyAuthorizedCwd = false;
  state.decoyWorkspaceDir = "";
  state.groupId = "";
  state.taskContextId = "";
  listSpacesMock.mockReset();
  listSpacesMock.mockResolvedValue({ spaces: [] });
});

describe("chat.restore", () => {
  it("restores the latest continuity checkpoint into chat", async () => {
    await createFixture();
    const respond = vi.fn();
    const context = {
      broadcastChat: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        checkpointId: "checkpoint-1",
        summary: "恢复到上一个稳定工作上下文",
      }),
    );
    expect(context.broadcastChat).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({
        state: "final",
        sessionKey: "main",
      }),
    );
  });

  it("restores bot-skill from the tenant workspace when host skill cwd is denied", async () => {
    await createFixture();
    state.denyAuthorizedCwd = true;
    state.tenantWorkspaceDir = path.dirname(state.memoryDir);
    const respond = vi.fn();
    const context = {
      broadcastChat: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "agent:bot-skill:main" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: {
        platformUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        connect: { device: { id: "webchat" } },
      } as never,
      isWebchatConnect: () => true,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        checkpointId: "checkpoint-1",
      }),
    );
    expect(respond).not.toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("authorized workspace cwd required for restore"),
      }),
    );
  });

  it("finds a bot-skill checkpoint in the tenant workspace when authorized cwd is elsewhere", async () => {
    await createFixture();
    const decoy = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-restore-decoy-"));
    state.decoyWorkspaceDir = decoy;
    state.tenantWorkspaceDir = path.dirname(state.memoryDir);
    const respond = vi.fn();
    const context = {
      broadcastChat: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "agent:bot-skill:main", checkpointId: "checkpoint-1" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: {
        platformUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        connect: { device: { id: "webchat" } },
      } as never,
      isWebchatConnect: () => true,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        checkpointId: "checkpoint-1",
      }),
    );
    await fs.rm(decoy, { recursive: true, force: true });
  });
});

function restoreContext() {
  return {
    broadcastChat: vi.fn(),
    nodeSendToSession: vi.fn(),
    chatAbortControllers: new Map(),
    logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
}

async function seedCurrentAndGhostTasks(checkpointOpenTasks: string[]) {
  await createFixture();
  const workspaceDir = path.dirname(state.memoryDir);
  const now = new Date().toISOString();
  state.taskContextId = "task_live";
  await fs.writeFile(path.join(workspaceDir, "old-deliverable.md"), "still here", "utf8");
  const taskLedger = {
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
        last_session_id: state.sessionId,
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
        last_session_id: "sess-old",
        updated_at: now,
      },
    ],
  };
  const taskLedgerPath = path.join(state.memoryDir, "task_ledger.json");
  await fs.writeFile(taskLedgerPath, JSON.stringify(taskLedger), "utf8");
  await fs.writeFile(
    path.join(state.memoryDir, "artifact_ledger.json"),
    JSON.stringify({
      version: 1,
      updated_at: now,
      items: [
        {
          id: "art_live",
          title: "current.md",
          type: "doc",
          task_id: "task_live",
          source_session: state.sessionId,
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
          source_session: "sess-old",
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
    path.join(state.memoryDir, "checkpoints", "latest.json"),
    JSON.stringify({
      id: "checkpoint-1",
      scope: "agent",
      owner_id: "main",
      session_id: state.sessionId,
      source_session_file: state.transcriptPath,
      created_at: now,
      summary: "当前摘要保持独立",
      decisions: [],
      preferences: [],
      open_tasks: checkpointOpenTasks,
      completed_tasks: [],
      artifacts: ["art_old"],
      evidence_refs: [],
    }),
    "utf8",
  );
  return { workspaceDir, taskLedgerPath, ledgerBefore: JSON.stringify(taskLedger) };
}

describe("chat.restore task main line", () => {
  const ghostTasks = ["缺关系旧任务", "请生成 ghost-bleed.md"];

  it("does not inject checkpoint open_tasks on a targeted restore", async () => {
    const { taskLedgerPath, ledgerBefore } = await seedCurrentAndGhostTasks(ghostTasks);
    const transcriptBefore = await fs.readFile(state.transcriptPath, "utf8");
    const respond = vi.fn();
    const context = restoreContext();

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId: "checkpoint-1" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const transcriptAfter = await fs.readFile(state.transcriptPath, "utf8");
    expect(transcriptAfter).toBe(transcriptBefore);
    expect(transcriptAfter).not.toContain("Open tasks:");
    expect(transcriptAfter).not.toContain("Checkpoint restored");
    expect(transcriptAfter).not.toContain("缺关系旧任务");
    expect(transcriptAfter).not.toContain("ghost-bleed.md");
    expect(await fs.readFile(taskLedgerPath, "utf8")).toBe(ledgerBefore);
    expect(context.broadcastChat).not.toHaveBeenCalled();
    expect(context.nodeSendToSession).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        checkpointId: "checkpoint-1",
        taskIsolation: {
          currentTaskId: "task_live",
          pendingReviewCount: expect.any(Number),
          autoClosedTaskIds: [],
        },
      }),
    );
    const payload = respond.mock.calls[0]?.[1] as {
      taskIsolation: { pendingReviewCount: number };
    };
    expect(payload.taskIsolation.pendingReviewCount).toBeGreaterThan(0);
  });

  it("keeps legacy open_tasks in the transcript but off the current task main line", async () => {
    const { workspaceDir, taskLedgerPath, ledgerBefore } =
      await seedCurrentAndGhostTasks(ghostTasks);
    const respond = vi.fn();
    const context = restoreContext();

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const transcript = await fs.readFile(state.transcriptPath, "utf8");
    expect(transcript).toContain("Open tasks:");
    expect(transcript).toContain("缺关系旧任务");
    expect(transcript).toContain("ghost-bleed.md");
    expect(transcript).toContain(RESTORE_OPEN_TASKS_FENCE_START);
    expect(transcript).toContain("openclawRestoreTaskIsolation");
    expect(await fs.readFile(taskLedgerPath, "utf8")).toBe(ledgerBefore);

    const receipt = transcript
      .split("\n")
      .filter((line) => line.includes("openclawRestoreTaskIsolation"))
      .map((line) => JSON.parse(line) as { message?: unknown });
    expect(receipt.length).toBeGreaterThan(0);
    const visible = sanitizeChatHistoryMessagesForTest(receipt.map((line) => line.message));
    expect(JSON.stringify(visible)).not.toContain("ghost-bleed.md");
    expect(JSON.stringify(visible)).not.toContain("缺关系旧任务");

    const prompt = await buildSessionContinuityPrompt({
      cfg: {},
      workspaceDir,
      agentId: "main",
      sessionKey: "main",
      sessionEntry: {
        sessionId: state.sessionId,
        updatedAt: Date.now(),
        taskContextId: "task_live",
      },
      isNewSession: true,
    });
    expect(prompt).toContain("当前主线");
    expect(prompt).toContain("当前摘要保持独立");
    expect(prompt).not.toContain("Open tasks:");
    expect(prompt).not.toContain("缺关系旧任务");
    expect(prompt).not.toContain("ghost-bleed.md");
    expect(prompt).not.toContain("old-deliverable.md");

    const rolled = await commitSessionContinuity({
      cfg: {},
      workspaceDir,
      agentId: "main",
      sessionKey: "main",
      previousSessionEntry: {
        sessionId: state.sessionId,
        sessionFile: state.transcriptPath,
        updatedAt: Date.now(),
        taskContextId: "task_live",
      },
      reason: "rollover",
    });
    expect(rolled?.open_tasks.join("\n") ?? "").not.toContain("ghost-bleed");
    const artifactLedger = JSON.parse(
      await fs.readFile(path.join(state.memoryDir, "artifact_ledger.json"), "utf8"),
    ) as { items: Array<{ title: string; task_id?: string }> };
    expect(
      artifactLedger.items.some(
        (item) => item.title === "ghost-bleed.md" && item.task_id === "task_live",
      ),
    ).toBe(false);
    expect(await fs.readFile(taskLedgerPath, "utf8")).toBe(ledgerBefore);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        checkpointId: "checkpoint-1",
        taskIsolation: expect.objectContaining({
          currentTaskId: "task_live",
          autoClosedTaskIds: [],
        }),
      }),
    );
    expect(context.broadcastChat).toHaveBeenCalled();
  });
});

describe("chat.checkpoints.list", () => {
  it("lists the session's checkpoints", async () => {
    await createFixture();
    const respond = vi.fn();

    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: { sessionKey: "main" },
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        checkpoints: expect.arrayContaining([
          expect.objectContaining({
            checkpointId: "checkpoint-1",
            summary: "恢复到上一个稳定工作上下文",
            restorable: { files: false, transcript: true },
            externalEffects: { present: false, kinds: [] },
          }),
        ]),
      }),
    );
  });

  it("rejects params without a session key", async () => {
    const respond = vi.fn();

    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: {},
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function transcriptIds(transcriptPath: string): Promise<string[]> {
  const content = await fs.readFile(transcriptPath, "utf8");
  return content
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => (JSON.parse(l) as { id?: string }).id)
    .filter((id): id is string => typeof id === "string");
}

/**
 * Seed a real checkpoint (snapshot of the workspace + transcript boundary), then
 * mutate the workspace + transcript so a targeted restore has something to undo.
 * The session transcript lives OUTSIDE the workspace root (as in production), so
 * the file snapshot never captures it — file rollback and transcript truncation
 * are independent.
 */
async function createRollbackFixture(): Promise<{
  workspace: string;
  transcriptPath: string;
  checkpointId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-chat-rollback-"));
  const workspace = path.join(dir, "workspace");
  const memoryDir = path.join(workspace, "memory");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "doc.md"), "v1", "utf8");

  const sessionId = "sess-main";
  const transcriptPath = path.join(dir, `${sessionId}.jsonl`);
  await fs.writeFile(
    transcriptPath,
    `${[
      JSON.stringify({ type: "session", version: 1, id: sessionId }),
      JSON.stringify({
        type: "message",
        id: "m0",
        message: { role: "assistant", content: "就绪" },
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        message: { role: "user", content: "帮我建文档" },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        message: { role: "assistant", content: "已建 doc.md" },
      }),
    ].join("\n")}\n`,
    "utf8",
  );

  const checkpoint = await commitSessionContinuityForCurrentSession({
    cfg: {},
    workspaceDir: workspace,
    agentId: "main",
    sessionKey: "main",
    sessionEntry: { sessionId, updatedAt: Date.now(), sessionFile: transcriptPath },
    reason: "turn_completed",
  });
  if (!checkpoint) {
    throw new Error("fixture failed to create checkpoint");
  }

  // Mutate workspace + transcript AFTER the checkpoint.
  await fs.writeFile(path.join(workspace, "doc.md"), "v2-modified", "utf8");
  await fs.writeFile(path.join(workspace, "new.md"), "created after checkpoint", "utf8");
  await fs.appendFile(
    transcriptPath,
    `${[
      JSON.stringify({ type: "message", id: "m3", message: { role: "user", content: "再改" } }),
      JSON.stringify({
        type: "message",
        id: "m4",
        message: { role: "assistant", content: "改好了" },
      }),
    ].join("\n")}\n`,
    "utf8",
  );

  state.transcriptPath = transcriptPath;
  state.sessionId = sessionId;
  state.memoryDir = memoryDir;
  return { workspace, transcriptPath, checkpointId: checkpoint.id };
}

describe("chat.restore targeted rollback (P3)", () => {
  it("rolls back workspace files and truncates the transcript for a targeted checkpoint", async () => {
    const { workspace, transcriptPath, checkpointId } = await createRollbackFixture();
    const respond = vi.fn();
    const context = {
      broadcast: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    // Files rolled back to the checkpoint state.
    expect(await fs.readFile(path.join(workspace, "doc.md"), "utf8")).toBe("v1");
    expect(await exists(path.join(workspace, "new.md"))).toBe(false);

    // Transcript truncated: post-boundary messages removed (archived).
    const ids = await transcriptIds(transcriptPath);
    expect(ids).not.toContain("m1");
    expect(ids).not.toContain("m2");
    expect(ids).not.toContain("m3");
    expect(ids).not.toContain("m4");
    expect(await exists(path.join(path.dirname(transcriptPath), "sess-main.jsonl.archive"))).toBe(
      true,
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, checkpointId, truncatedFrom: 4 }),
    );
    // Targeted restore does NOT inject a "Checkpoint restored" receipt: the
    // transcript ends exactly at the boundary (m0), and nothing is broadcast.
    // The client reloads the truncated conversation as the confirmation.
    expect(ids[ids.length - 1]).toBe("m0");
    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.nodeSendToSession).not.toHaveBeenCalled();
  });

  it("rewinds a GROUP_PUBLIC transcript and drops the agent mirror that would resurrect the tail", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-group-restore-"));
    const previousStateDir = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    const groupId = "grp-paper";
    const sessionId = "sess-group";
    const shared = resolveGroupPublicTranscriptPath(groupId, {});
    state.transcriptPath = path.join(stateDir, "keep.jsonl");
    state.sessionId = sessionId;
    state.groupId = groupId;
    state.memoryDir = path.join(path.dirname(path.dirname(shared)), "memory");
    try {
      await fs.mkdir(path.dirname(shared), { recursive: true });
      await fs.writeFile(
        shared,
        `${[
          JSON.stringify({ type: "session", version: 1, id: sessionId }),
          JSON.stringify({
            type: "message",
            id: "m0",
            message: { role: "assistant", content: "论文标题已确认" },
          }),
          JSON.stringify({
            type: "message",
            id: "m1",
            message: { role: "user", content: "继续这一题" },
          }),
        ].join("\n")}\n`,
        "utf8",
      );
      const checkpoint = await commitSessionContinuityForCurrentSession({
        cfg: {},
        workspaceDir: path.dirname(path.dirname(shared)),
        agentId: "main",
        sessionKey: "main",
        sessionEntry: {
          sessionId,
          updatedAt: Date.now(),
          sessionFile: shared,
          groupId,
          space: groupId,
        },
        reason: "turn_completed",
      });
      if (!checkpoint) {
        throw new Error("fixture failed to create group checkpoint");
      }
      await fs.appendFile(
        shared,
        `${JSON.stringify({
          type: "message",
          id: "m2",
          message: { role: "user", content: "刚才打错字了，是论文" },
        })}\n`,
        "utf8",
      );
      const mirror = path.join(path.dirname(shared), `${sessionId}.jsonl`);
      await fs.writeFile(
        mirror,
        `${JSON.stringify({
          type: "message",
          id: "m2",
          message: { role: "assistant", content: "唤醒正常、身份稳定" },
        })}\n`,
        "utf8",
      );
      state.transcriptPath = shared;

      const respond = vi.fn();
      await chatHandlers["chat.restore"]({
        params: { sessionKey: "main", checkpointId: checkpoint.id },
        respond: respond as never,
        context: {
          broadcast: vi.fn(),
          nodeSendToSession: vi.fn(),
          chatAbortControllers: new Map(),
          logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        } as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
      });

      const body = await fs.readFile(shared, "utf8");
      expect(body).toContain("论文标题已确认");
      expect(body).not.toContain("刚才打错字了，是论文");
      expect(body).not.toContain("唤醒正常、身份稳定");
      const ids = await transcriptIds(shared);
      expect(ids.at(-1)).toBe("m0");
      expect(await exists(mirror)).toBe(false);
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ ok: true, checkpointId: checkpoint.id }),
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previousStateDir;
      }
      state.groupId = "";
      state.transcriptPath = path.join(stateDir, "keep.jsonl");
    }
  });

  it("transcript-only restores a collaboration space session key (Phase A; no hard reject)", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-space-restore-"));
    const previousStateDir = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    const groupId = "grp-phase-a";
    const sessionKey = `space:${groupId}`;
    const sessionId = "sess-space-phase-a";
    const shared = resolveGroupPublicTranscriptPath(groupId, {});
    const workspaceRoot = path.dirname(path.dirname(shared));
    const deliverablePath = path.join(workspaceRoot, "notes.md");
    state.transcriptPath = path.join(stateDir, "keep.jsonl");
    state.sessionId = sessionId;
    state.groupId = groupId;
    state.memoryDir = path.join(workspaceRoot, "memory");
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: sessionKey,
          groupId,
          ownerUserId: "owner-1",
          members: { humans: [{ userId: "owner-1", name: "Owner", status: "active" }] },
        },
      ],
    });
    try {
      await fs.mkdir(workspaceRoot, { recursive: true });
      await fs.writeFile(deliverablePath, "v1-before", "utf8");
      await fs.mkdir(path.dirname(shared), { recursive: true });
      await fs.writeFile(
        shared,
        `${[
          JSON.stringify({ type: "session", version: 1, id: sessionId }),
          JSON.stringify({
            type: "message",
            id: "m0",
            message: { role: "assistant", content: "协作会话已就绪" },
          }),
          JSON.stringify({
            type: "message",
            id: "m1",
            message: { role: "user", content: "帮小组安排一下分工" },
          }),
          JSON.stringify({
            type: "message",
            id: "m2",
            message: { role: "assistant", content: "已给出分工建议" },
          }),
        ].join("\n")}\n`,
        "utf8",
      );
      const checkpoint = await commitSessionContinuityForCurrentSession({
        cfg: {},
        workspaceDir: workspaceRoot,
        agentId: "main",
        sessionKey,
        sessionEntry: {
          sessionId,
          updatedAt: Date.now(),
          sessionFile: shared,
          groupId,
          space: groupId,
        },
        reason: "turn_completed",
      });
      if (!checkpoint) {
        throw new Error("fixture failed to create space checkpoint");
      }
      expect(checkpoint.restorable).toEqual({ files: false, transcript: true });
      expect(checkpoint.snapshot?.store === "content-addressed").toBe(false);

      await fs.writeFile(deliverablePath, "v2-mutated-after-checkpoint", "utf8");
      await fs.appendFile(
        shared,
        `${JSON.stringify({
          type: "message",
          id: "m3",
          message: { role: "user", content: "撤回刚才那句" },
        })}\n`,
        "utf8",
      );
      state.transcriptPath = shared;

      const respond = vi.fn();
      await chatHandlers["chat.restore"]({
        params: { sessionKey, checkpointId: checkpoint.id },
        respond: respond as never,
        context: {
          broadcast: vi.fn(),
          nodeSendToSession: vi.fn(),
          chatAbortControllers: new Map(),
          logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        } as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
      });

      const body = await fs.readFile(shared, "utf8");
      expect(body).toContain("协作会话已就绪");
      expect(body).not.toContain("撤回刚才那句");
      const ids = await transcriptIds(shared);
      expect(ids.at(-1)).toBe("m0");
      // Phase A: workspace files must not roll back for space keys.
      expect(await fs.readFile(deliverablePath, "utf8")).toBe("v2-mutated-after-checkpoint");
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          ok: true,
          checkpointId: checkpoint.id,
          truncatedFrom: expect.any(Number),
        }),
      );
      const errArg = respond.mock.calls[0]?.[2];
      expect(JSON.stringify(errArg ?? null)).not.toContain(
        "Checkpoint restore is not available in collaboration group chats.",
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previousStateDir;
      }
      state.groupId = "";
      state.transcriptPath = path.join(stateDir, "keep.jsonl");
    }
  });

  it("rewinds the robot transcript history paints when the model path is a different header", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-robot-restore-"));
    const sessionId = "sess-robot-paper";
    const sessionsDir = path.join(root, ".openbot", "agents", "robot", "sessions");
    const visible = path.join(sessionsDir, "paper.jsonl");
    const openclawFile = path.join(root, ".openclaw", "agents", "robot", "sessions", "paper.jsonl");
    const modelFallback = path.join(sessionsDir, `${sessionId}.jsonl`);
    const workspace = path.join(root, "workspace");
    const memoryDir = path.join(workspace, "memory");
    await fs.mkdir(path.dirname(visible), { recursive: true });
    await fs.mkdir(path.dirname(openclawFile), { recursive: true });
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(
      visible,
      `${[
        JSON.stringify({ type: "session", version: 1, id: sessionId }),
        JSON.stringify({
          type: "message",
          id: "m0",
          message: { role: "assistant", content: "论文标题已确认" },
        }),
        JSON.stringify({
          type: "message",
          id: "m1",
          message: { role: "user", content: "继续写论文" },
        }),
      ].join("\n")}\n`,
      "utf8",
    );
    await fs.writeFile(
      modelFallback,
      `${JSON.stringify({ type: "session", version: 1, id: sessionId })}\n`,
      "utf8",
    );
    const checkpoint = await commitSessionContinuityForCurrentSession({
      cfg: {},
      workspaceDir: workspace,
      agentId: "robot",
      sessionKey: "agent:robot:main",
      sessionEntry: { sessionId, updatedAt: Date.now(), sessionFile: visible },
      reason: "turn_completed",
    });
    if (!checkpoint) {
      throw new Error("fixture failed to create robot checkpoint");
    }
    await fs.appendFile(
      visible,
      `${[
        JSON.stringify({
          type: "message",
          id: "m2",
          message: { role: "user", content: "刚才打错字了，是论文" },
        }),
        JSON.stringify({
          type: "message",
          id: "m3",
          message: { role: "assistant", content: "唤醒正常、身份稳定" },
        }),
      ].join("\n")}\n`,
      "utf8",
    );
    state.transcriptPath = visible;
    state.sessionFile = openclawFile;
    state.sessionId = sessionId;
    state.memoryDir = memoryDir;
    const respond = vi.fn();
    await chatHandlers["chat.restore"]({
      params: { sessionKey: "agent:robot:main", checkpointId: checkpoint.id },
      respond: respond as never,
      context: {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers: new Map(),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      } as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const modelBody = await fs.readFile(modelFallback, "utf8");
    expect(modelBody).toContain("论文标题已确认");
    expect(modelBody).not.toContain("唤醒正常、身份稳定");
    expect(modelBody).not.toContain("刚才打错字了，是论文");
    const painted = (await exists(visible)) ? await fs.readFile(visible, "utf8") : "";
    expect(painted).not.toContain("唤醒正常、身份稳定");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, checkpointId: checkpoint.id }),
    );
  });

  it("rejects a targeted restore while a run is active for the session", async () => {
    const { workspace, checkpointId } = await createRollbackFixture();
    const respond = vi.fn();
    const context = {
      broadcast: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map([
        ["run-1", { sessionKey: "main", controller: new AbortController() }],
      ]),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ reasonCode: "RUN_ACTIVE", retryable: true }),
    );
    // No rollback happened (workspace mutation preserved).
    expect(await fs.readFile(path.join(workspace, "doc.md"), "utf8")).toBe("v2-modified");
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("queues restore when queueWhenActive is set", async () => {
    const { workspace, checkpointId } = await createRollbackFixture();
    const respond = vi.fn();
    const context = {
      broadcast: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map([
        [
          "run-1",
          {
            sessionKey: "main",
            controller: new AbortController(),
            sessionId: "sess-1",
            startedAtMs: Date.now(),
            expiresAtMs: Date.now() + 60_000,
          },
        ],
      ]),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId, queueWhenActive: true },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, queued: true, reasonCode: "RUN_ACTIVE" }),
    );
    expect(await fs.readFile(path.join(workspace, "doc.md"), "utf8")).toBe("v2-modified");
  });

  it("rejects a non-existent checkpoint id", async () => {
    await createRollbackFixture();
    const respond = vi.fn();
    const context = {
      broadcast: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId: "checkpoint_does_not_exist" },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    expect(context.broadcast).not.toHaveBeenCalled();
  });
});

describe("chat.restore concurrency", () => {
  it("rejects a second restore while one is in progress for the same session", async () => {
    const { workspace, checkpointId } = await createRollbackFixture();
    // Make the first restore hang by replacing a workspace file with a FIFO that
    // blocks the digest comparison / write path. Instead, hold the session lock
    // by injecting a long-running restore via a deferred promise on the store.
    const storeMod = await import("../../infra/workspace-snapshot/content-addressed-store.js");
    const originalCreate = storeMod.createContentAddressedSnapshotStore;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const createSpy = vi
      .spyOn(storeMod, "createContentAddressedSnapshotStore")
      .mockImplementation((options) => {
        const store = originalCreate(options);
        const originalRestore = store.restore.bind(store);
        store.restore = async (input) => {
          entered = true;
          await gate;
          return originalRestore(input);
        };
        return store;
      });

    const respond = vi.fn();
    const context = {
      broadcast: vi.fn(),
      nodeSendToSession: vi.fn(),
      chatAbortControllers: new Map(),
      logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };

    const first = chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    await vi.waitFor(() => expect(entered).toBe(true));

    const respond2 = vi.fn();
    await chatHandlers["chat.restore"]({
      params: { sessionKey: "main", checkpointId },
      respond: respond2 as never,
      context: context as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond2).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ reasonCode: "RESTORE_IN_PROGRESS", retryable: true }),
    );

    release();
    await first;
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }));
    expect(await fs.readFile(path.join(workspace, "doc.md"), "utf8")).toBe("v1");
    createSpy.mockRestore();
  });
});

describe("chat.restore deadline", () => {
  it("returns RESTORE_TIMEOUT and leaves files untouched when snapshot restore hangs", async () => {
    const { workspace, checkpointId } = await createRollbackFixture();
    const previousDeadline = process.env.OPENBOT_CHAT_RESTORE_DEADLINE_MS;
    process.env.OPENBOT_CHAT_RESTORE_DEADLINE_MS = "80";
    const storeMod = await import("../../infra/workspace-snapshot/content-addressed-store.js");
    const originalCreate = storeMod.createContentAddressedSnapshotStore;
    const createSpy = vi
      .spyOn(storeMod, "createContentAddressedSnapshotStore")
      .mockImplementation((options) => {
        const store = originalCreate(options);
        store.restore = (input) =>
          new Promise((_resolve, reject) => {
            const fail = () => {
              const reason = input.signal?.reason;
              reject(reason instanceof Error ? reason : new Error("restore aborted"));
            };
            if (input.signal?.aborted) {
              fail();
              return;
            }
            input.signal?.addEventListener("abort", fail, { once: true });
          });
        return store;
      });
    try {
      const respond = vi.fn();
      const context = {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers: new Map(),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      };
      await chatHandlers["chat.restore"]({
        params: { sessionKey: "main", checkpointId },
        respond: respond as never,
        context: context as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
      });
      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({
          reasonCode: "RESTORE_TIMEOUT",
          retryable: true,
          details: expect.objectContaining({ reasonCode: "RESTORE_TIMEOUT" }),
        }),
      );
      expect(await fs.readFile(path.join(workspace, "doc.md"), "utf8")).toBe("v2-modified");
      expect(await exists(path.join(workspace, "new.md"))).toBe(true);
    } finally {
      createSpy.mockRestore();
      if (previousDeadline === undefined) {
        delete process.env.OPENBOT_CHAT_RESTORE_DEADLINE_MS;
      } else {
        process.env.OPENBOT_CHAT_RESTORE_DEADLINE_MS = previousDeadline;
      }
    }
  });
});
