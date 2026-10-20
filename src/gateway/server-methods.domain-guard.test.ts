import { describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";

const noWebchat = () => false;

function buildContext() {
  return {
    logGateway: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"];
}

function buildClient(sessionDomain?: "platform" | "enterprise" | "employee") {
  return {
    connect: {
      role: "operator",
      scopes: ["operator.admin"],
      client: { id: "openbot-control-ui", version: "1.0.0", platform: "darwin", mode: "ui" },
      minProtocol: 1,
      maxProtocol: 1,
    },
    connId: "conn-1",
    clientIp: "10.0.0.5",
    ...(sessionDomain ? { sessionDomain } : {}),
  } as Parameters<typeof handleGatewayRequest>[0]["client"];
}

async function runRequest(params: {
  method: string;
  client: Parameters<typeof handleGatewayRequest>[0]["client"];
  handler: GatewayRequestHandler;
}) {
  const respond = vi.fn();
  await handleGatewayRequest({
    req: { type: "req", id: crypto.randomUUID(), method: params.method },
    respond,
    client: params.client,
    isWebchatConnect: noWebchat,
    context: buildContext(),
    extraHandlers: { [params.method]: params.handler },
  });
  return respond;
}

describe("gateway session-domain guard (dispatch)", () => {
  const okHandler: GatewayRequestHandler = (opts) => opts.respond(true, { ok: true }, undefined);

  it("rejects a platform-scoped method when the session domain is enterprise", async () => {
    const respond = await runRequest({
      method: "platform-plans.create",
      client: buildClient("enterprise"),
      handler: okHandler,
    });
    expect(respond).toHaveBeenCalledTimes(1);
    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("allows a platform-scoped method when the session domain is platform", async () => {
    const respond = await runRequest({
      method: "platform-plans.create",
      client: buildClient("platform"),
      handler: okHandler,
    });
    const [ok] = respond.mock.calls[0];
    expect(ok).toBe(true);
  });

  it("rejects platform-plan-bundle.create-version for a non-platform session", async () => {
    const respond = await runRequest({
      method: "platform-plan-bundle.create-version",
      client: buildClient("enterprise"),
      handler: okHandler,
    });
    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("rejects platform-plan-bundle.activate for a non-platform session", async () => {
    const respond = await runRequest({
      method: "platform-plan-bundle.activate",
      client: buildClient("enterprise"),
      handler: okHandler,
    });
    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("rejects platform-plan-bundle.deprecate for a non-platform session", async () => {
    const respond = await runRequest({
      method: "platform-plan-bundle.deprecate",
      client: buildClient("enterprise"),
      handler: okHandler,
    });
    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("rejects platform-plan-bundle.delete-version for a non-platform session", async () => {
    const respond = await runRequest({
      method: "platform-plan-bundle.delete-version",
      client: buildClient("enterprise"),
      handler: okHandler,
    });
    const [ok, , error] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("domain_mismatch");
  });

  it("allows a platform-scoped method when the session has no domain (legacy → any)", async () => {
    const respond = await runRequest({
      method: "platform-plans.create",
      client: buildClient(undefined),
      handler: okHandler,
    });
    const [ok] = respond.mock.calls[0];
    expect(ok).toBe(true);
  });

  it("allows an unscoped method regardless of session domain", async () => {
    const respond = await runRequest({
      method: "skills.status",
      client: buildClient("employee"),
      handler: okHandler,
    });
    const [ok] = respond.mock.calls[0];
    expect(ok).toBe(true);
  });
});
