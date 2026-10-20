/**
 * Phase D3 — lock chat.history to tenant-aware loadSessionEntryForClient (T1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSessionEntryForClientMock = vi.hoisted(() =>
  vi.fn(async (sessionKey: string, _client: unknown) => ({
    cfg: { session: {} },
    storePath: `/tmp/d3-tenant/${sessionKey}/sessions.json`,
    entry: { sessionId: "sid-d3-history", updatedAt: 1 },
    canonicalKey: sessionKey,
  })),
);
const hydrateWebchatIdentityMock = vi.hoisted(() =>
  vi.fn(async (params: { client: unknown }) => params.client),
);
const ensureWebchatIdentityMock = vi.hoisted(() =>
  vi.fn(async (params: { client: unknown }) => params.client),
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
    resolveSessionTranscriptsDirForAgent: () => "/tmp/d3-transcripts",
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
    hydrateWebchatGatewayClientPlatformIdentity: hydrateWebchatIdentityMock,
    ensureGatewayClientUserFromPlatformIdentity: ensureWebchatIdentityMock,
  };
});

vi.mock("../../agents/agent-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../agents/agent-scope.js")>();
  return {
    ...original,
    resolveSessionAgentId: () => "bot-2",
    resolveAgentWorkspaceDir: () => "/tmp/d3-workspace",
  };
});

const { chatHandlers } = await import("./chat.js");

describe("chat.history tenant load path (D3 T1)", () => {
  beforeEach(() => {
    loadSessionEntryForClientMock.mockClear();
    hydrateWebchatIdentityMock.mockClear();
    ensureWebchatIdentityMock.mockClear();
  });

  it("loads history via loadSessionEntryForClient with the gateway client", async () => {
    const respond = vi.fn();
    const client = { connect: {} as never, user: "a@acme.com", sessionDomain: "employee" };

    await chatHandlers["chat.history"]({
      params: { sessionKey: "agent:bot-2:main" },
      respond: respond as never,
      context: {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers: new Map(),
        loadGatewayModelCatalog: vi.fn(async () => []),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      } as never,
      req: {} as never,
      client: client as never,
      isWebchatConnect: () => false,
    });

    expect(hydrateWebchatIdentityMock).toHaveBeenCalled();
    expect(ensureWebchatIdentityMock).toHaveBeenCalled();

    expect(loadSessionEntryForClientMock).toHaveBeenCalled();
    const [sessionKeyArg, clientArg] = loadSessionEntryForClientMock.mock.calls[0] ?? [];
    expect(sessionKeyArg).toBe("agent:bot-2:main");
    expect(clientArg).toBe(client);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:bot-2:main",
        messages: expect.any(Array),
      }),
    );
  });

  it("rejects invalid archiveId on history (negative)", async () => {
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: {
        sessionKey: "agent:bot-2:main",
        archiveId: "../escape.jsonl",
      },
      respond: respond as never,
      context: {
        broadcast: vi.fn(),
        nodeSendToSession: vi.fn(),
        chatAbortControllers: new Map(),
        loadGatewayModelCatalog: vi.fn(async () => []),
        logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      } as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});
