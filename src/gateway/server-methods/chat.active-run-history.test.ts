/**
 * Reconnect discovery: chat.history reports the in-flight run and re-binds
 * tool events to the new connection. WebSocket close does not abort the run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_CAPS } from "../protocol/client-info.js";

const loadSessionEntryForClientMock = vi.hoisted(() =>
  vi.fn(async (sessionKey: string, _client: unknown) => ({
    cfg: { session: {} },
    storePath: `/tmp/active-run-history/${sessionKey}/sessions.json`,
    entry: { sessionId: "sid-active-run", updatedAt: 1 },
    canonicalKey: sessionKey,
  })),
);

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: loadSessionEntryForClientMock,
  };
});

vi.mock("../employee-steward-session.js", () => ({
  resolveEmployeeScopedChatSessionKey: vi.fn(async (_client: unknown, raw: string) => raw.trim()),
  resolveEmployeeWorkbenchActorForClient: vi.fn(async () => null),
  applyEmployeeStewardSessionDefaults: vi.fn(),
  employeeGlobalStewardTranscriptBlocked: () => false,
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    readSessionMessages: () => [],
    resolveSessionTranscriptsDirForAgent: () => "/tmp/active-run-transcripts",
  };
});

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...original,
    requiresEmployeeAssetScope: () => false,
  };
});

vi.mock("../webchat-client-platform-identity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../webchat-client-platform-identity.js")>();
  return {
    ...original,
    hydrateWebchatGatewayClientPlatformIdentity: vi.fn(
      async (params: { client: unknown }) => params.client,
    ),
    ensureGatewayClientUserFromPlatformIdentity: vi.fn(
      async (params: { client: unknown }) => params.client,
    ),
  };
});

vi.mock("../../agents/agent-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../agents/agent-scope.js")>();
  return {
    ...original,
    resolveSessionAgentId: () => "main",
    resolveAgentWorkspaceDir: () => "/tmp/active-run-workspace",
  };
});

const { chatHandlers } = await import("./chat.js");

function activeEntry(sessionKey: string) {
  return {
    controller: new AbortController(),
    sessionId: "sid-active-run",
    sessionKey,
    startedAtMs: 10,
    expiresAtMs: Date.now() + 60_000,
  };
}

const historyClient = {
  connect: { caps: [] as string[] },
  connId: "conn-new",
  user: "a@acme.com",
  sessionDomain: "employee",
};

describe("chat.history active run", () => {
  beforeEach(() => {
    loadSessionEntryForClientMock.mockClear();
  });

  it("returns activeRun null when the session is idle", async () => {
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: "agent:bot-2:main" },
      respond: respond as never,
      context: {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers: new Map(),
        chatRunBuffers: new Map(),
        registerToolEventRecipient: vi.fn(),
        loadGatewayModelCatalog: vi.fn(async () => []),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      } as never,
      req: {} as never,
      client: historyClient as never,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        sessionKey: "agent:bot-2:main",
        activeRun: null,
      }),
    );
  });

  it("reports the buffered run and re-registers tool events for the new connId", async () => {
    const respond = vi.fn();
    const registerToolEventRecipient = vi.fn();
    const chatAbortControllers = new Map([
      ["run-live", activeEntry("agent:bot-2:main")],
      ["run-live:bot-2", activeEntry("agent:bot-2:main")],
      ["run-other", activeEntry("agent:other:main")],
    ]);
    const chatRunBuffers = new Map<string, string>([
      ["run-live", ""],
      ["run-live:bot-2", "继续上次的草稿"],
    ]);

    await chatHandlers["chat.history"]({
      params: { sessionKey: "agent:bot-2:main" },
      respond: respond as never,
      context: {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers,
        chatRunBuffers,
        registerToolEventRecipient,
        loadGatewayModelCatalog: vi.fn(async () => []),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      } as never,
      req: {} as never,
      client: {
        ...historyClient,
        connId: "conn-reconnect",
        connect: { caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS] },
      } as never,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        activeRun: { runId: "run-live", text: "继续上次的草稿" },
      }),
    );
    expect(chatAbortControllers.has("run-live")).toBe(true);
    expect(registerToolEventRecipient).toHaveBeenCalledWith("run-live", "conn-reconnect");
    expect(registerToolEventRecipient).toHaveBeenCalledWith("run-live:bot-2", "conn-reconnect");
    expect(registerToolEventRecipient).not.toHaveBeenCalledWith("run-other", "conn-reconnect");
  });
});
