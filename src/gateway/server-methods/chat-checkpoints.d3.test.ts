/**
 * Phase D3 — chat.checkpoints.list tenant-aware path + negatives (T3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listChatCheckpointsMock = vi.hoisted(() =>
  vi.fn(async (_sessionKey: string, _client: unknown) => [
    {
      checkpointId: "cp-d3",
      summary: "d3",
      createdAt: new Date(0).toISOString(),
      restorable: { files: false, transcript: true },
      externalEffects: { present: false, kinds: [] },
    },
  ]),
);

const resolveEmployeeScopedChatSessionKeyMock = vi.hoisted(() =>
  vi.fn(async (_client: unknown, raw: string) => raw.trim()),
);

vi.mock("../checkpoint-store.js", () => ({
  listChatCheckpoints: listChatCheckpointsMock,
}));

vi.mock("../employee-steward-session.js", () => ({
  resolveEmployeeScopedChatSessionKey: resolveEmployeeScopedChatSessionKeyMock,
  employeeGlobalStewardTranscriptBlocked: () => false,
}));

const { chatCheckpointHandlers } = await import("./chat-checkpoints.js");

describe("chat.checkpoints.list D3 hardening (T3)", () => {
  beforeEach(() => {
    listChatCheckpointsMock.mockClear();
    listChatCheckpointsMock.mockResolvedValue([
      {
        checkpointId: "cp-d3",
        summary: "d3",
        createdAt: new Date(0).toISOString(),
        restorable: { files: false, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ]);
    resolveEmployeeScopedChatSessionKeyMock.mockClear();
    resolveEmployeeScopedChatSessionKeyMock.mockImplementation(async (_c, raw) => raw.trim());
  });

  it("passes scoped sessionKey and client into listChatCheckpoints", async () => {
    const respond = vi.fn();
    const client = { connect: {} as never, user: "a@acme.com", sessionDomain: "employee" };
    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: { sessionKey: "agent:bot-2:main" },
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: client as never,
      isWebchatConnect: () => false,
    });
    expect(resolveEmployeeScopedChatSessionKeyMock).toHaveBeenCalledWith(
      client,
      "agent:bot-2:main",
    );
    expect(listChatCheckpointsMock).toHaveBeenCalledWith(
      "agent:bot-2:main",
      client,
      "agent:bot-2:main",
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        checkpoints: [expect.objectContaining({ checkpointId: "cp-d3" })],
      }),
    );
  });

  it("lists checkpoints for collaboration space session keys (Phase A 恢复线)", async () => {
    const respond = vi.fn();
    const client = { connect: {} as never, user: "a@acme.com", sessionDomain: "employee" };
    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: { sessionKey: "space:group-abc" },
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: client as never,
      isWebchatConnect: () => false,
    });
    expect(resolveEmployeeScopedChatSessionKeyMock).toHaveBeenCalledWith(client, "space:group-abc");
    expect(listChatCheckpointsMock).toHaveBeenCalledWith(
      "space:group-abc",
      client,
      "space:group-abc",
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        checkpoints: [expect.objectContaining({ checkpointId: "cp-d3" })],
      }),
    );
  });

  it("rejects empty sessionKey (negative)", async () => {
    const respond = vi.fn();
    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: { sessionKey: "" },
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
    expect(listChatCheckpointsMock).not.toHaveBeenCalled();
  });

  it("surfaces list failures as UNAVAILABLE (negative)", async () => {
    listChatCheckpointsMock.mockRejectedValueOnce(new Error("tenant workspace denied"));
    const respond = vi.fn();
    await chatCheckpointHandlers["chat.checkpoints.list"]({
      params: { sessionKey: "agent:bot-2:main" },
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      client: { connect: {} as never, user: "a@acme.com" } as never,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("failed to list checkpoints"),
      }),
    );
  });
});
