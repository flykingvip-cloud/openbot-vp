/**
 * Employee steward history must not load the global `agent:main:main` transcript.
 * A device-owner-only client (platform user id, no email, no session domain) used
 * to fail open onto that transcript, including unrelated audit turns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_CAPS } from "../protocol/client-info.js";

const F5_AUDIT = "AUDIT-F5-20260904D-004";
const ZHANG_ID = "e8666db5-f43d-4d98-883e-536a6808a8c0";
const ZHANG_KEY = `agent:main:employee:${ZHANG_ID}`;

const loadedSessionKeys: string[] = [];

const loadSessionEntryForClientMock = vi.hoisted(() => vi.fn());
const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: loadSessionEntryForClientMock,
  };
});

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...original,
    resolveEmployeeWorkbenchActor: resolveEmployeeWorkbenchActorMock,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    readSessionMessages: (sessionId: string) => {
      if (sessionId === "global-f5") {
        return [
          {
            role: "user",
            content: [{ type: "text", text: F5_AUDIT }],
            timestamp: 1,
          },
        ];
      }
      return [
        {
          role: "assistant",
          content: [{ type: "text", text: "welcome guidance" }],
          timestamp: 1,
        },
      ];
    },
    resolveSessionTranscriptsDirForAgent: () => "/tmp/employee-isolation-transcripts",
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
    resolveAgentWorkspaceDir: () => "/tmp/employee-isolation-workspace",
  };
});

const { chatHandlers } = await import("./chat.js");

function isGlobalStewardKey(sessionKey: string): boolean {
  const lower = sessionKey.trim().toLowerCase();
  return (
    lower === "main" || lower === "global" || lower === "agent:main" || lower === "agent:main:main"
  );
}

function historyContext(extra?: {
  chatAbortControllers?: Map<string, unknown>;
  registerToolEventRecipient?: ReturnType<typeof vi.fn>;
}) {
  return {
    broadcast: vi.fn(),
    nodeSendToSession: vi.fn(),
    chatAbortControllers: extra?.chatAbortControllers ?? new Map(),
    chatRunBuffers: new Map<string, string>([["run-zhang", "继续整理"]]),
    registerToolEventRecipient: extra?.registerToolEventRecipient ?? vi.fn(),
    loadGatewayModelCatalog: vi.fn(async () => []),
    logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
}

async function loadHistory(params: {
  sessionKey: string;
  client: Record<string, unknown>;
  context?: ReturnType<typeof historyContext>;
}) {
  const respond = vi.fn();
  await chatHandlers["chat.history"]({
    params: { sessionKey: params.sessionKey },
    respond: respond as never,
    context: (params.context ?? historyContext()) as never,
    req: {} as never,
    client: params.client as never,
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("chat.history employee steward isolation", () => {
  beforeEach(() => {
    loadedSessionKeys.length = 0;
    resolveEmployeeWorkbenchActorMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
    loadSessionEntryForClientMock.mockReset();
    loadSessionEntryForClientMock.mockImplementation(async (sessionKey: string) => {
      loadedSessionKeys.push(sessionKey);
      const global = isGlobalStewardKey(sessionKey);
      return {
        cfg: {
          session: {},
          agents: { defaults: { workspace: "/tmp/openbot-employee-isolation-workspace" } },
        },
        storePath: global
          ? "/tmp/openbot-global-steward-missing/sessions.json"
          : `/tmp/openbot-employee-steward-missing/${sessionKey}/sessions.json`,
        entry: {
          sessionId: global ? "global-f5" : "employee-welcome",
          updatedAt: 1,
        },
        canonicalKey: sessionKey,
      };
    });
  });

  it("does not load the global F5 transcript for a device-owner employee", async () => {
    const respond = await loadHistory({
      sessionKey: "agent:main:main",
      client: {
        connect: { caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS] },
        connId: "conn-zhang",
        platformUserId: ZHANG_ID,
      },
    });

    expect(loadedSessionKeys.filter(isGlobalStewardKey)).toEqual([]);
    expect(loadedSessionKeys).toContain(ZHANG_KEY);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: ZHANG_KEY,
      }),
    );
    expect(JSON.stringify(respond.mock.calls[0]?.[1])).not.toContain(F5_AUDIT);
    expect(JSON.stringify(respond.mock.calls[0]?.[1])).toContain("welcome guidance");
  });

  it("adopts the employee's own in-flight run and not a global steward run", async () => {
    const registerToolEventRecipient = vi.fn();
    const chatAbortControllers = new Map<string, unknown>([
      [
        "run-zhang",
        {
          controller: new AbortController(),
          sessionId: "employee-welcome",
          sessionKey: ZHANG_KEY,
          startedAtMs: 20,
          expiresAtMs: Date.now() + 60_000,
        },
      ],
      [
        "run-global-f5",
        {
          controller: new AbortController(),
          sessionId: "global-f5",
          sessionKey: "agent:main:main",
          startedAtMs: 50,
          expiresAtMs: Date.now() + 60_000,
        },
      ],
    ]);
    const respond = await loadHistory({
      sessionKey: "main",
      client: {
        connect: { caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS] },
        connId: "conn-reconnect",
        platformUserId: ZHANG_ID,
      },
      context: historyContext({ chatAbortControllers, registerToolEventRecipient }),
    });

    expect(JSON.stringify(respond.mock.calls[0]?.[1])).not.toContain(F5_AUDIT);
    expect(respond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        sessionKey: ZHANG_KEY,
        activeRun: { runId: "run-zhang", text: "继续整理" },
      }),
    );
    expect(registerToolEventRecipient).toHaveBeenCalledWith("run-zhang", "conn-reconnect");
    expect(registerToolEventRecipient).not.toHaveBeenCalledWith("run-global-f5", "conn-reconnect");
    expect(loadedSessionKeys.filter(isGlobalStewardKey)).toEqual([]);
  });

  it("returns empty history instead of the global transcript when remap cannot finish", async () => {
    const respond = await loadHistory({
      sessionKey: "agent:main:main",
      client: {
        connect: {},
        sessionDomain: "employee",
      },
    });

    expect(loadedSessionKeys).toEqual([]);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        messages: [],
        activeRun: null,
      }),
    );
    expect(JSON.stringify(respond.mock.calls[0]?.[1])).not.toContain(F5_AUDIT);
  });
});
