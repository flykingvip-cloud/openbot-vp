import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGroupCollaborationPaths } from "../../gateway/collaboration-learning/collaboration-paths.js";
import {
  resolveEffectiveRestoreBoundaryMessageId,
  TRANSCRIPT_START_BOUNDARY_ID,
} from "./chat-checkpoint-boundary.js";
import {
  cleanupSessionContinuityCheckpoints,
  commitSessionContinuityForCurrentSession,
  detectExternalEffectsFromTranscript,
  listSessionContinuityCheckpoints,
  pruneSessionContinuityCheckpoints,
  resolveCheckpointBoundaryMessageId,
  resolveSessionContinuityWorkspaceDir,
} from "./session-continuity.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

async function setupSession(opts?: {
  toolLine?: Record<string, unknown>;
}): Promise<{ ws: string; sessionFile: string }> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ckpt-"));
  const ws = path.join(tempDir, "workspace");
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(ws, "doc.md"), "hello world", "utf8");
  const sessionFile = path.join(tempDir, "sess-1.jsonl");
  const lines = [
    JSON.stringify({ type: "session", id: "sess-1", timestamp: new Date().toISOString() }),
    // Prelude so resolveCheckpointBoundaryMessageId can anchor before the user turn.
    JSON.stringify({
      type: "message",
      id: "m0",
      timestamp: new Date().toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: "就绪" }] },
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: "帮我整理演讲提纲" }] },
    }),
    ...(opts?.toolLine ? [JSON.stringify(opts.toolLine)] : []),
    JSON.stringify({
      type: "message",
      id: "m2",
      timestamp: new Date().toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: "已完成初稿" }] },
    }),
  ];
  await fs.writeFile(sessionFile, lines.join("\n"), "utf8");
  return { ws, sessionFile };
}

describe("checkpoint rollback metadata capture", () => {
  it("re-derives a tip/empty boundary so first-turn restore can truncate", () => {
    const messages = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
    ];
    expect(resolveEffectiveRestoreBoundaryMessageId(undefined, messages)).toBe(
      TRANSCRIPT_START_BOUNDARY_ID,
    );
    expect(resolveEffectiveRestoreBoundaryMessageId("a1", messages)).toBe(
      TRANSCRIPT_START_BOUNDARY_ID,
    );
  });

  it("anchors the first user turn to the transcript-start sentinel", () => {
    expect(
      resolveCheckpointBoundaryMessageId([
        { id: "u1", role: "user", text: "TO: Skill孵化" },
        { id: "a1", role: "assistant", text: "已生成 PDF" },
      ]),
    ).toBe(TRANSCRIPT_START_BOUNDARY_ID);
  });

  it("captures a workspace snapshot + boundary + session key on turn completion", async () => {
    const { ws, sessionFile } = await setupSession();
    const checkpoint = await commitSessionContinuityForCurrentSession({
      cfg: {},
      workspaceDir: ws,
      agentId: "main",
      sessionKey: "emp:alice:main",
      sessionEntry: { sessionId: "sess-1", updatedAt: Date.now(), sessionFile },
      reason: "turn_completed",
    });

    expect(checkpoint?.snapshot?.store).toBe("content-addressed");
    expect(checkpoint?.snapshot?.fileCount).toBeGreaterThanOrEqual(1);
    expect(checkpoint?.restorable).toEqual({ files: true, transcript: true });
    expect(checkpoint?.boundary_message_id).toBe("m0");
    expect(checkpoint?.session_key).toBe("emp:alice:main");

    // The snapshot manifest exists under the memory snapshots store.
    const manifestPath = path.join(
      ws,
      "memory",
      "snapshots",
      "manifests",
      `${checkpoint?.id}.json`,
    );
    expect(
      await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
  });

  it("skips the snapshot when disabled but still records a restorable transcript boundary", async () => {
    const { ws, sessionFile } = await setupSession();
    const checkpoint = await commitSessionContinuityForCurrentSession({
      cfg: {},
      workspaceDir: ws,
      agentId: "main",
      sessionKey: "emp:alice:main",
      sessionEntry: { sessionId: "sess-1", updatedAt: Date.now(), sessionFile },
      reason: "turn_completed",
      enableWorkspaceSnapshot: false,
    });

    expect(checkpoint?.snapshot?.store).toBe("none");
    expect(checkpoint?.restorable).toEqual({ files: false, transcript: true });
    expect(checkpoint?.boundary_message_id).toBe("m0");
  });

  it("flags external effects from an email-sending tool call", async () => {
    const { ws, sessionFile } = await setupSession({
      toolLine: {
        type: "message",
        id: "t1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "send_email", input: { to: "x@y.z" } }],
        },
      },
    });
    const checkpoint = await commitSessionContinuityForCurrentSession({
      cfg: {},
      workspaceDir: ws,
      agentId: "main",
      sessionKey: "emp:alice:main",
      sessionEntry: { sessionId: "sess-1", updatedAt: Date.now(), sessionFile },
      reason: "turn_completed",
    });
    expect(checkpoint?.external_effects?.present).toBe(true);
    expect(checkpoint?.external_effects?.kinds).toContain("email");
  });
});

describe("detectExternalEffectsFromTranscript", () => {
  it("returns present=false when there are no external tool calls", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ext-"));
    const file = path.join(tempDir, "s.jsonl");
    await fs.writeFile(
      file,
      [
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "帮我发送邮件" }] },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", name: "read_file", input: {} }],
          },
        }),
      ].join("\n"),
      "utf8",
    );
    // User text mentions "发送邮件" but only tool names are inspected → no false positive.
    expect(await detectExternalEffectsFromTranscript(file)).toEqual({ present: false, kinds: [] });
  });
});

async function writeCheckpointFile(
  memoryDir: string,
  cp: { id: string; created_at: string; session_key?: string; session_id?: string },
): Promise<void> {
  const dir = path.join(memoryDir, "checkpoints");
  await fs.mkdir(dir, { recursive: true });
  const full = {
    scope: "agent",
    owner_id: "main",
    session_id: cp.session_id ?? "sess",
    source_session_file: "",
    summary: "",
    decisions: [],
    preferences: [],
    open_tasks: [],
    completed_tasks: [],
    artifacts: [],
    evidence_refs: [],
    ...cp,
  };
  await fs.writeFile(
    path.join(dir, `${cp.created_at.replaceAll(":", "-")}-${cp.id}.json`),
    JSON.stringify(full),
    "utf8",
  );
}

async function listCheckpointIds(memoryDir: string): Promise<string[]> {
  const dir = path.join(memoryDir, "checkpoints");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const ids: string[] = [];
  for (const file of files) {
    const cp = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { id: string };
    ids.push(cp.id);
  }
  return ids.toSorted();
}

describe("checkpoint retention + cleanup", () => {
  it("prunes to the newest N checkpoints per session", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-retain-"));
    const ws = path.join(tempDir, "workspace");
    const memoryDir = path.join(ws, "memory");
    const stamps = [
      "2026-07-07T00:00:01.000Z",
      "2026-07-07T00:00:02.000Z",
      "2026-07-07T00:00:03.000Z",
      "2026-07-07T00:00:04.000Z",
    ];
    for (const [i, ts] of stamps.entries()) {
      await writeCheckpointFile(memoryDir, { id: `cp${i + 1}`, created_at: ts, session_key: "A" });
    }

    await pruneSessionContinuityCheckpoints({
      cfg: {},
      workspaceDir: ws,
      agentId: "main",
      sessionKey: "A",
      maxPerSession: 2,
    });

    expect(await listCheckpointIds(memoryDir)).toEqual(["cp3", "cp4"]);
  });

  it("cleanup removes one session's checkpoints and keeps other sessions", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cleanup-"));
    const ws = path.join(tempDir, "workspace");
    const memoryDir = path.join(ws, "memory");
    await writeCheckpointFile(memoryDir, {
      id: "cpA1",
      created_at: "2026-07-07T00:00:01.000Z",
      session_key: "A",
    });
    await writeCheckpointFile(memoryDir, {
      id: "cpB1",
      created_at: "2026-07-07T00:00:02.000Z",
      session_key: "B",
    });

    await cleanupSessionContinuityCheckpoints({
      cfg: {},
      workspaceDir: ws,
      agentId: "main",
      sessionKey: "A",
    });

    expect(await listCheckpointIds(memoryDir)).toEqual(["cpB1"]);
  });
});

describe("checkpoint session identity", () => {
  it("lists a checkpoint when the session id matches a different stored key", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ckpt-alias-"));
    const ws = path.join(tempDir, "workspace");
    const memoryDir = path.join(ws, "memory");
    await writeCheckpointFile(memoryDir, {
      id: "cpAlias",
      created_at: "2026-09-18T00:00:00.000Z",
      session_key: "agent:legacy:main",
      session_id: "sess-secretary",
    });
    await writeCheckpointFile(memoryDir, {
      id: "cpOther",
      created_at: "2026-09-18T00:00:01.000Z",
      session_key: "agent:other:main",
      session_id: "sess-other",
    });

    const listed = await listSessionContinuityCheckpoints({
      cfg: {},
      workspaceDir: ws,
      agentId: "agt-secretary",
      sessionKey: "agent:agt-secretary:main",
      sessionEntry: { sessionId: "sess-secretary", updatedAt: Date.now() },
    });

    expect(listed.map((row) => row.checkpointId)).toEqual(["cpAlias"]);
  });
});

describe("collaboration group checkpoint capture (Phase A 恢复线)", () => {
  it("lists a space-session checkpoint with transcript-only restorable and user-role boundary", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-group-ckpt-"));
    const groupWorkspaceRoot = path.join(tempDir, "collab-root");
    const sessionFile = path.join(tempDir, "group-sess.jsonl");
    await fs.writeFile(
      sessionFile,
      `${[
        JSON.stringify({ type: "session", version: 1, id: "group-sess" }),
        JSON.stringify({
          type: "message",
          id: "g0",
          message: { role: "assistant", content: "协作会话已就绪" },
        }),
        JSON.stringify({
          type: "message",
          id: "g1",
          message: { role: "user", content: "帮小组安排一下分工" },
        }),
        JSON.stringify({
          type: "message",
          id: "g2",
          message: { role: "assistant", content: "已给出分工建议" },
        }),
      ].join("\n")}\n`,
      "utf8",
    );

    const cfg = { collaboration: { defaults: { workspace: groupWorkspaceRoot } } };
    const groupId = "group-abc";
    const paths = resolveGroupCollaborationPaths(groupId, cfg);
    const deliverablePath = path.join(paths.workspacePath, "deliverables", "draft-outline.md");
    await fs.mkdir(path.dirname(deliverablePath), { recursive: true });
    await fs.writeFile(deliverablePath, "draft v1", "utf8");

    const sessionEntry = { sessionId: "group-sess", updatedAt: Date.now(), sessionFile };
    const scope = {
      cfg,
      workspaceDir: resolveSessionContinuityWorkspaceDir({
        cfg,
        sessionKey: "space:group-abc",
        sessionEntry,
        agentId: "main",
        agentWorkspaceDir: path.join(tempDir, "agent-ws"),
      }),
      agentId: "main",
      sessionKey: "space:group-abc",
      sessionEntry,
    };

    expect(scope.workspaceDir).toBe(paths.workspacePath);

    const checkpoint = await commitSessionContinuityForCurrentSession({
      ...scope,
      reason: "turn_completed",
    });

    // Phase A: no workspace snapshot for groups; transcript restore only.
    expect(checkpoint?.snapshot?.store).toBe("none");
    expect(checkpoint?.restorable).toEqual({ files: false, transcript: true });
    expect(checkpoint?.session_key).toBe("space:group-abc");
    // Human-user boundary: message before the latest user turn (g1), not assistant tip.
    expect(checkpoint?.boundary_message_id).toBe("g0");
    expect(
      resolveCheckpointBoundaryMessageId([
        { id: "g0", role: "assistant", text: "协作会话已就绪" },
        { id: "g1", role: "user", text: "帮小组安排一下分工" },
        { id: "g2", role: "assistant", text: "已给出分工建议" },
      ]),
    ).toBe("g0");

    const groupCheckpoints = await listSessionContinuityCheckpoints(scope);
    expect(groupCheckpoints.length).toBeGreaterThan(0);
    expect(groupCheckpoints.map((c) => c.checkpointId)).toContain(checkpoint?.id);
    expect(groupCheckpoints.find((c) => c.checkpointId === checkpoint?.id)?.restorable).toEqual({
      files: false,
      transcript: true,
    });
    expect(paths.workspacePath.startsWith(groupWorkspaceRoot)).toBe(true);
  });
});
