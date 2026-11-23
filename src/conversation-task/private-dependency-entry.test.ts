import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sessionTaskState } from "../agent-runtime/state/index.js";
import {
  seedSessionTaskBoard,
  readSessionTaskBoard,
} from "../agent-runtime/state/repository/task-board-file.js";
const fixture = vi.hoisted(() => ({ file: "", dispatch: vi.fn(), owner: true }));
vi.mock("../diagnosis/diagnose-growth-locator.js", async (original) => ({
  ...(await original<typeof import("../diagnosis/diagnose-growth-locator.js")>()),
  loadPlatformAuthStoreForDiagnosis: vi.fn(async () => ({})),
  resolveDiagnoseGrowthActor: () =>
    fixture.owner ? { actorUserId: "owner", tenantId: "tenant", tenantAdmin: false } : null,
}));
vi.mock("../gateway/tenant-context.js", async (original) => ({
  ...(await original<typeof import("../gateway/tenant-context.js")>()),
  loadSessionEntryForClient: vi.fn(async () => ({ entry: { sessionFile: fixture.file } })),
}));
vi.mock("./conversation-handoff.js", async (original) => ({
  ...(await original<typeof import("./conversation-handoff.js")>()),
  listConversationPeers: vi.fn(async () => [
    {
      agentId: "child",
      displayName: "Analyst",
      sessionKey: "agent:child:main",
      sessionExists: true,
    },
  ]),
  resolveConversationSessionExists: vi.fn(async () => () => true),
  dispatchConversationHandoff: fixture.dispatch,
  postConversationOutboundLine: vi.fn(async () => {}),
}));
const { createConversationSendTool } = await import("../agents/tools/conversation-send-tool.js");
const { listPrivateDependencies } = await import("./private-dependency-store.js");
const { observePrivateDependencyEvent, tickPrivateDependencies } =
  await import("./private-dependency-runtime.js");
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fixture.owner = true;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("runs the actual conversation_send entry through durable child dispatch, event receipt and same-task wake without group state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "private-dependency-entry-"));
  roots.push(dir);
  vi.stubEnv("OPENBOT_STATE_DIR", dir);
  fixture.file = path.join(dir, "parent.jsonl");
  fs.writeFileSync(fixture.file, "");
  seedSessionTaskBoard(fixture.file, {
    focusRevision: 1,
    parked: [],
    current: {
      taskId: "parent",
      goalText: "Report",
      title: "Report",
      unfinished: true,
      createdAtMs: 1,
      executionAttempt: "parent-run",
      stop: { summary: "", workspacePaths: [] },
    },
  });
  fixture.dispatch.mockImplementation(
    async (input: { idempotencyKey: string; waitForReply: boolean }) => {
      const rows = listPrivateDependencies();
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("dispatching");
      expect(input.idempotencyKey).toBe(rows[0].child.runId);
      expect(input.waitForReply).toBe(false);
      return {
        ok: true,
        reason: "sent",
        runId: input.idempotencyKey,
        targetSessionKey: "agent:child:main",
      };
    },
  );
  const tool = createConversationSendTool({
    agentSessionKey: "agent:main:employee:owner",
    requesterAgentIdOverride: "main",
    tenantId: "tenant",
    gatewayClientPlatformUserId: "owner",
    gatewayClientSessionDomain: "employee",
  });
  const args = {
    target: "Analyst",
    message: "Review sources",
    taskId: "parent",
    successCriteria: "Verified sources",
    forbiddenZones: "No outbound",
    singleOwner: "Analyst",
  };
  await tool.execute("call-1", args);
  await tool.execute("call-1", args);
  expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  const row = listPrivateDependencies()[0];
  const wake = vi.fn(async (dependency: typeof row) => {
    sessionTaskState.startExecution(
      fixture.file,
      sessionTaskState.captureBinding(fixture.file),
      dependency.wakeRunId,
    );
  });
  const ports = {
    authorize: async () => true,
    childCompleted: async () => true,
    parentBusy: () => false,
    wake,
  };
  await observePrivateDependencyEvent(
    {
      runId: row.child.runId,
      sessionKey: row.child.sessionKey,
      seq: 1,
      ts: Date.now(),
      stream: "lifecycle",
      data: { phase: "end" },
    },
    { ports },
  );
  await tickPrivateDependencies({ ports });
  expect(wake).toHaveBeenCalledTimes(1);
  expect(readSessionTaskBoard(fixture.file).current?.taskId).toBe("parent");
  expect(readSessionTaskBoard(fixture.file).parked).toEqual([]);
  expect(listPrivateDependencies()[0].state).toBe("completed");
});
it("an untrusted actor is rejected before dispatch or dependency mutation", async () => {
  fixture.owner = false;
  const tool = createConversationSendTool({ agentSessionKey: "agent:main:employee:owner" });
  const result = await tool.execute("bad", { target: "Analyst", message: "hello" });
  expect(JSON.stringify(result)).toContain("unauthorized");
  expect(fixture.dispatch).not.toHaveBeenCalled();
});
