import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as OpenBotConfig));
const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "main"));
const getMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId,
}));

vi.mock("../../memory/index.js", () => ({
  getMemorySearchManager,
}));

import { resetMemoryDoctorEmbeddingProbeCache } from "../../memory/doctor-status.js";
import { handleGatewayRequest } from "../server-methods.js";
import { doctorHandlers } from "./doctor.js";

const invokeDoctorMemoryStatus = async (respond: ReturnType<typeof vi.fn>) => {
  await doctorHandlers["doctor.memory.status"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {} as never,
    client: null,
    isWebchatConnect: () => false,
  });
};

const expectEmbeddingErrorResponse = (respond: ReturnType<typeof vi.fn>, error: string) => {
  expect(respond).toHaveBeenCalledWith(
    true,
    {
      agentId: "main",
      embedding: {
        ok: false,
        error,
      },
    },
    undefined,
  );
};

describe("doctor.memory.status", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    resolveDefaultAgentId.mockClear();
    getMemorySearchManager.mockReset();
    resetMemoryDoctorEmbeddingProbeCache();
  });

  it("returns gateway embedding probe status for the default agent", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          backend: "builtin",
          provider: "gemini",
          custom: {
            distillation: {
              atoms: 3,
              evidence: 2,
            },
            sourcePolicy: {
              memory: {
                enabled: true,
                allowsSharedScope: false,
              },
              sessions: {
                enabled: false,
                allowsSharedScope: false,
              },
            },
          },
        }),
        probeEmbeddingAvailability: vi.fn().mockResolvedValue({ ok: true }),
        close,
      },
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expect(getMemorySearchManager).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      agentId: "main",
      purpose: "status",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        agentId: "main",
        backend: "builtin",
        provider: "gemini",
        enabledSources: ["memory"],
        sharedSources: [],
        transcriptIngest: "disabled",
        distillation: { atoms: 3, evidence: 2 },
        embedding: { ok: true },
      },
      undefined,
    );
    expect(close).toHaveBeenCalled();
  });

  it("returns unavailable when memory manager is missing", async () => {
    getMemorySearchManager.mockResolvedValue({
      manager: null,
      error: "memory search unavailable",
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expectEmbeddingErrorResponse(respond, "memory search unavailable");
  });

  it("returns probe failure when manager probe throws", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({ backend: "builtin", provider: "openai" }),
        probeEmbeddingAvailability: vi.fn().mockRejectedValue(new Error("timeout")),
        close,
      },
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expectEmbeddingErrorResponse(respond, "gateway memory probe failed: timeout");
    expect(close).toHaveBeenCalled();
  });
});

describe("doctor.memory.health READ harness (§6.6)", () => {
  it("rejects operator.read at dispatch with 403 scope.denied", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: crypto.randomUUID(), method: "doctor.memory.health" },
      respond,
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.read"],
          client: { id: "openbot-control-ui", version: "1.0.0", platform: "darwin", mode: "ui" },
          minProtocol: 1,
          maxProtocol: 1,
        },
        connId: "conn-read",
        sessionDomain: "platform",
      } as never,
      isWebchatConnect: () => false,
      context: { logGateway: { warn: vi.fn(), info: vi.fn() } } as never,
      extraHandlers: doctorHandlers,
    });
    const [ok, payload, error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error).toEqual({
      code: "403",
      message: expect.any(String),
      reasonCode: "scope.denied",
      reason: expect.any(String),
    });
  });
});
