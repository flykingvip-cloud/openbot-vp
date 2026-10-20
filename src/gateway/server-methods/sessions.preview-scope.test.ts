import { beforeEach, describe, expect, it, vi } from "vitest";

const buildSessionStorePathResolverMock = vi.hoisted(() => vi.fn());
const buildEmployeeSessionVisibilityContextMock = vi.hoisted(() => vi.fn());
const isPersonalWorkbenchClientMock = vi.hoisted(() =>
  vi.fn(
    (client: { sessionDomain?: string } | null | undefined) =>
      client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
  ),
);
const filterSessionKeysForEmployeeActorMock = vi.hoisted(() => vi.fn((keys: string[]) => keys));
const resolveGatewaySessionStoreTargetMock = vi.hoisted(() =>
  vi.fn(
    ({
      key,
      resolveAgentStorePath,
    }: {
      key: string;
      resolveAgentStorePath?: (id: string) => string;
    }) => {
      const storePath = resolveAgentStorePath
        ? resolveAgentStorePath("main")
        : "/global/agents/main/sessions/sessions.json";
      return {
        agentId: "main",
        storePath,
        canonicalKey: key,
        storeKeys: [key],
      };
    },
  ),
);
const loadSessionStoreMock = vi.hoisted(() => vi.fn(() => ({})));
const readSessionPreviewItemsFromTranscriptMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ session: {} }),
}));

vi.mock("../tenant-context.js", () => ({
  buildSessionStorePathResolver: (...args: unknown[]) => buildSessionStorePathResolverMock(...args),
}));

vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    buildEmployeeSessionVisibilityContext: (...args: unknown[]) =>
      buildEmployeeSessionVisibilityContextMock(...args),
    isPersonalWorkbenchClient: (...args: unknown[]) =>
      isPersonalWorkbenchClientMock(...(args as [never])),
    resolveEmployeeWorkbenchActor: vi.fn(async () => null),
  };
});

vi.mock("../actor-scope.js", () => ({
  filterSessionKeysForEmployeeActor: (...args: unknown[]) =>
    filterSessionKeysForEmployeeActorMock(...(args as [string[]])),
}));

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    loadSessionStore: loadSessionStoreMock as typeof actual.loadSessionStore,
  };
});

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    resolveGatewaySessionStoreTarget:
      resolveGatewaySessionStoreTargetMock as typeof actual.resolveGatewaySessionStoreTarget,
    readSessionPreviewItemsFromTranscript:
      readSessionPreviewItemsFromTranscriptMock as typeof actual.readSessionPreviewItemsFromTranscript,
    loadCombinedSessionStoreForGateway: vi.fn(() => ({ storePath: "(denied)", store: {} })),
  };
});

vi.mock("../protocol/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../protocol/index.js")>("../protocol/index.js");
  return actual;
});

describe("sessions.preview store open scope", () => {
  beforeEach(() => {
    buildSessionStorePathResolverMock.mockReset();
    buildEmployeeSessionVisibilityContextMock.mockReset();
    isPersonalWorkbenchClientMock.mockClear();
    filterSessionKeysForEmployeeActorMock.mockReset();
    filterSessionKeysForEmployeeActorMock.mockImplementation((keys: string[]) => keys);
    resolveGatewaySessionStoreTargetMock.mockClear();
    loadSessionStoreMock.mockClear();
    readSessionPreviewItemsFromTranscriptMock.mockClear();
    buildSessionStorePathResolverMock.mockResolvedValue(
      (agentId: string) => `/tenant/users/u1/agents/${agentId}/sessions/sessions.json`,
    );
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue({
      actor: { userId: "u1", userEmail: "a@acme.com", seatAgentIds: ["main"], seatSpaceIds: [] },
      visibleAgentIds: new Set(["main"]),
      visibleSpaceIds: new Set(),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
  });

  it("opens the caller tenant store for personal-workbench previews", async () => {
    const { sessionsHandlers } = await import("./sessions.js");
    const respond = vi.fn();
    await sessionsHandlers["sessions.preview"]({
      params: { keys: ["agent:main:employee:u1"] },
      respond,
      client: { sessionDomain: "employee", user: "a@acme.com" },
      context: { logGateway: { warn: vi.fn() } },
    } as never);

    expect(buildSessionStorePathResolverMock).toHaveBeenCalled();
    expect(resolveGatewaySessionStoreTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resolveAgentStorePath: expect.any(Function),
      }),
    );
    const firstCall = resolveGatewaySessionStoreTargetMock.mock.calls[0]?.[0] as {
      resolveAgentStorePath?: (id: string) => string;
    };
    expect(firstCall.resolveAgentStorePath?.("main")).toBe(
      "/tenant/users/u1/agents/main/sessions/sessions.json",
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ previews: expect.any(Array) }),
      undefined,
    );
  });

  it("does not open any store when personal-workbench path resolution fails", async () => {
    buildSessionStorePathResolverMock.mockRejectedValue(new Error("unresolved tenant"));
    const { sessionsHandlers } = await import("./sessions.js");
    const respond = vi.fn();
    await sessionsHandlers["sessions.preview"]({
      params: { keys: ["agent:main:employee:u1"] },
      respond,
      client: { sessionDomain: "employee", user: "a@acme.com" },
      context: { logGateway: { warn: vi.fn() } },
    } as never);

    expect(resolveGatewaySessionStoreTargetMock).not.toHaveBeenCalled();
    expect(loadSessionStoreMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ previews: [] }),
      undefined,
    );
  });
});
