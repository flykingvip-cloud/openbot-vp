import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  hydrate: vi.fn(async () => {}),
  visibility: vi.fn(),
}));
vi.mock("../tenant-context.js", async (original) => ({
  ...(await original<typeof import("../tenant-context.js")>()),
  loadSessionEntryForClient: mocks.load,
}));
vi.mock("../../agent-runtime/state/index.js", async (original) => ({
  ...(await original<typeof import("../../agent-runtime/state/index.js")>()),
  sessionTaskState: { read: mocks.read },
}));
vi.mock("../webchat-client-platform-identity.js", async (original) => ({
  ...(await original<typeof import("../webchat-client-platform-identity.js")>()),
  hydrateWebchatGatewayClientPlatformIdentity: mocks.hydrate,
  ensureGatewayClientUserFromPlatformIdentity: vi.fn(async () => {}),
}));
vi.mock("../employee-workbench-actor-restore.js", async (original) => ({
  ...(await original<typeof import("../employee-workbench-actor-restore.js")>()),
  restorePersonalWorkbenchActor: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../employee-steward-session.js", async (original) => ({
  ...(await original<typeof import("../employee-steward-session.js")>()),
  resolveEmployeeScopedChatSessionKey: vi.fn(async (_client, key: string) => key),
  employeeGlobalStewardTranscriptBlocked: () => false,
}));
vi.mock("../employee-workbench-scope.js", async (original) => ({
  ...(await original<typeof import("../employee-workbench-scope.js")>()),
  requiresEmployeeAssetScope: () => true,
  buildEmployeeSessionVisibilityContext: mocks.visibility,
  isSessionVisibleToEmployeeActor: (row: { key: string }, context: { allowed: string }) =>
    row.key === context.allowed,
}));
const { chatHandlers } = await import("./chat.js");
const key = "agent:report:main";
const owner = {
  user: "owner@example.test",
  platformUserId: "owner",
  sessionEnterpriseId: "tenant-a",
  sessionDomain: "employee",
  connect: { caps: [] },
};
async function request(
  client: unknown = owner,
  sessionKey = key,
  runOptions: { id?: string; expired?: boolean; aborted?: boolean; sessionKey?: string } = {},
) {
  const respond = vi.fn();
  const controller = new AbortController();
  if (runOptions.aborted) {
    controller.abort();
  }
  await chatHandlers["task.activity.get"]({
    params: { sessionKey },
    respond: respond as never,
    req: {} as never,
    client: client as never,
    isWebchatConnect: () => false,
    context: {
      logGateway: { warn: vi.fn() },
      chatAbortControllers: new Map([
        [
          runOptions.id ?? "run",
          {
            controller,
            sessionId: "sid",
            sessionKey: runOptions.sessionKey ?? key,
            expiresAtMs: Date.now() + (runOptions.expired ? -1 : 60_000),
            startedAtMs: 1,
          },
        ],
      ]),
    } as never,
  });
  return respond;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({
    cfg: { session: {} },
    storePath: "/tmp/task-activity-rpc/sessions.json",
    entry: { sessionId: "sid", sessionFile: "/tmp/task-activity-rpc/sid.jsonl" },
  });
  mocks.read.mockReturnValue({
    focusRevision: 1,
    parked: [],
    current: {
      taskId: "task",
      title: "Report",
      goalText: "Report",
      unfinished: true,
      createdAtMs: 1,
      executionAttempt: "run",
      stop: { summary: "", workspacePaths: [] },
    },
  });
  mocks.visibility.mockImplementation(async ({ client }: { client: typeof owner | null }) =>
    client?.platformUserId === "owner" && client.sessionEnterpriseId === "tenant-a"
      ? { allowed: key }
      : null,
  );
});
it("hydrates identity and returns only an authorized task read-model with a bound live run", async () => {
  const result = await request();
  expect(mocks.hydrate).toHaveBeenCalled();
  expect(result).toHaveBeenCalledWith(
    true,
    expect.objectContaining({
      sessionKey: key,
      task: { taskId: "task", lifecycle: "active", health: "running" },
    }),
  );
  expect(JSON.stringify(result.mock.calls)).not.toContain("goalText");
});
it.each([
  { ...owner, platformUserId: "other" },
  { ...owner, sessionEnterpriseId: "tenant-b" },
  null,
])("rejects foreign user/tenant or missing actor before reading task state: %j", async (client) => {
  const result = await request(client);
  expect(result.mock.calls[0]?.[0]).toBe(false);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("rejects an invisible session before reading its board", async () => {
  expect((await request(owner, "agent:foreign:main")).mock.calls[0]?.[0]).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([{ id: "aside" }, { expired: true }, { aborted: true }, { sessionKey: "other" }])(
  "does not assert running for a mismatched/dead run: %j",
  async (options) => {
    expect((await request(owner, key, options)).mock.calls[0]?.[1]).toMatchObject({
      task: { health: "unknown" },
    });
  },
);
it("does not revive a completed or paused task because a registry entry survives", async () => {
  const board = mocks.read();
  board.current.unfinished = false;
  expect((await request()).mock.calls[0]?.[1]).toMatchObject({
    task: { lifecycle: "terminal", health: "unknown" },
  });
  board.current.unfinished = true;
  board.current.wakeSuppress = true;
  expect((await request()).mock.calls[0]?.[1]).toMatchObject({
    task: { lifecycle: "paused", health: "unknown" },
  });
});
