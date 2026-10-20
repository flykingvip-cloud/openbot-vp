import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import { authorizeOperatorScopesForMethod, PLATFORM_SCOPE, READ_SCOPE } from "./method-scopes.js";
import { ErrorShapeSchema } from "./protocol/index.js";
import { handleGatewayRequest } from "./server-methods.js";
import { doctorHandlers } from "./server-methods/doctor.js";

function buildContext() {
  return {
    logGateway: { warn: vi.fn(), info: vi.fn() },
  } as never;
}

function buildClient(
  scopes: string[],
  sessionDomain: "platform" | "enterprise" = "platform",
  role: "operator" | "node" = "operator",
) {
  return {
    connect: {
      role,
      scopes,
      client: {
        id: role === "node" ? "node-host" : "openbot-control-ui",
        version: "1.0.0",
        platform: "darwin",
        mode: role === "node" ? "node" : "ui",
      },
      minProtocol: 1,
      maxProtocol: 1,
    },
    connId: "conn-1",
    clientIp: "10.0.0.5",
    sessionDomain,
  } as never;
}

function expectScopeDenied403(respond: ReturnType<typeof vi.fn>) {
  expect(respond).toHaveBeenCalledTimes(1);
  const [ok, payload, error] = respond.mock.calls[0];
  expect(ok).toBe(false);
  expect(payload).toBeUndefined();
  expect(error).toEqual({
    code: "403",
    message: expect.any(String),
    reasonCode: "scope.denied",
    reason: expect.any(String),
  });
  expect(Value.Check(ErrorShapeSchema, error)).toBe(true);
}

describe("gateway method auth — doctor.memory.health", () => {
  it("T-8: READ caller cannot invoke doctor.memory.health", async () => {
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", [READ_SCOPE])).toEqual({
      allowed: false,
      missingScope: PLATFORM_SCOPE,
    });

    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: crypto.randomUUID(), method: "doctor.memory.health" },
      respond,
      client: buildClient([READ_SCOPE]),
      isWebchatConnect: () => false,
      context: buildContext(),
      extraHandlers: doctorHandlers,
    });

    expectScopeDenied403(respond);
    expect((respond.mock.calls[0][2] as { message?: string }).message).toContain(
      "missing scope: operator.platform",
    );
  });

  it("rejects agent/node session tokens on every memory health RPC", async () => {
    for (const method of [
      "doctor.memory.health",
      "doctor.memory.health.tenant",
      "doctor.memory.health.summary",
    ]) {
      const respond = vi.fn();
      await handleGatewayRequest({
        req: { type: "req", id: crypto.randomUUID(), method },
        respond,
        client: buildClient([], "platform", "node"),
        isWebchatConnect: () => false,
        context: buildContext(),
        extraHandlers: doctorHandlers,
      });
      expectScopeDenied403(respond);
      expect((respond.mock.calls[0][2] as { message?: string }).message).toContain(
        "agent session cannot invoke memory health RPC",
      );
    }
  });

  it("allows platform scope on platform domain", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: crypto.randomUUID(), method: "doctor.memory.health", params: {} },
      respond,
      client: buildClient(["operator.platform"], "platform"),
      isWebchatConnect: () => false,
      context: buildContext(),
      extraHandlers: doctorHandlers,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const [ok] = respond.mock.calls[0];
    expect(ok).toBe(true);
  });

  it("rejects doctor.memory.health on enterprise session domain", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: crypto.randomUUID(), method: "doctor.memory.health" },
      respond,
      client: buildClient(["operator.platform"], "enterprise"),
      isWebchatConnect: () => false,
      context: buildContext(),
      extraHandlers: doctorHandlers,
    });

    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("returns scope.denied envelope for tenant RPC without tenant context", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: crypto.randomUUID(),
        method: "doctor.memory.health.tenant",
        params: {},
      },
      respond,
      client: buildClient(["operator.admin"], "platform"),
      isWebchatConnect: () => false,
      context: buildContext(),
      extraHandlers: doctorHandlers,
    });

    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "scope.denied",
      }),
    );
    expect(payload).not.toHaveProperty("agents");
    expect(payload).not.toHaveProperty("runtime");
  });

  it("does not classify doctor.memory.health as READ scope", () => {
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", [READ_SCOPE]).allowed).toBe(
      false,
    );
    expect(authorizeOperatorScopesForMethod("doctor.memory.status", [READ_SCOPE]).allowed).toBe(
      true,
    );
  });
});
