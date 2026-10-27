import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const releaseViaGatewayMock = vi.fn();
const confirmViaGatewayMock = vi.fn();
const resolveTenantMock = vi.fn(
  async (_client: import("./types.js").GatewayClient | null | undefined) => ({
    tenantId: "001",
    trust: "membership" as const,
  }),
);

vi.mock("../collaboration-learning.js", async () => {
  const actual = await vi.importActual<typeof import("../collaboration-learning.js")>(
    "../collaboration-learning.js",
  );
  return {
    ...actual,
    releaseWakeOpForRetryViaGatewaySession: (...args: unknown[]) => releaseViaGatewayMock(...args),
    confirmWakeOpCompletedViaGatewaySession: (...args: unknown[]) => confirmViaGatewayMock(...args),
  };
});

vi.mock("../collaboration-learning/trusted-tenant.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-learning/trusted-tenant.js")
  >("../collaboration-learning/trusted-tenant.js");
  return {
    ...actual,
    resolveCollaborationTenantResolution: (
      ...args: Parameters<typeof actual.resolveCollaborationTenantResolution>
    ) => resolveTenantMock(...args),
  };
});

import { collaborationLearningHandlers } from "./collaboration-learning.js";

function makeCtx(params: Record<string, unknown>): GatewayRequestHandlerOptions {
  const respond = vi.fn();
  return {
    req: { type: "req", id: "1", method: "test" } as never,
    params,
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: { id: "web", version: "1", platform: "web", mode: "webchat" },
      },
      platformUserId: "user-42",
      user: "user-42@example.com",
      sessionDomain: "employee",
      sessionKind: "member",
      sessionMembershipId: "mem-42",
    },
    isWebchatConnect: () => true,
    respond,
    context: {} as never,
  };
}

describe("collaboration.task.wakeOp.* gateway methods", () => {
  beforeEach(() => {
    releaseViaGatewayMock.mockReset();
    confirmViaGatewayMock.mockReset();
    resolveTenantMock.mockClear();
  });

  it("releaseForRetry routes through ViaGatewaySession entry (mint/recovery path)", async () => {
    releaseViaGatewayMock.mockResolvedValue({
      ok: true,
      record: { status: "failed" },
      identityProvenance: "gateway_session",
    });
    const ctx = makeCtx({
      groupId: "grp-canary",
      taskId: "task-1",
      opKey: "op-1",
      verificationId: "ver-1",
    });
    await collaborationLearningHandlers["collaboration.task.wakeOp.releaseForRetry"](ctx);
    expect(releaseViaGatewayMock).toHaveBeenCalledTimes(1);
    expect(releaseViaGatewayMock.mock.calls[0][0]).toMatchObject({
      groupId: "grp-canary",
      taskId: "task-1",
      opKey: "op-1",
      verificationId: "ver-1",
      client: expect.objectContaining({ platformUserId: "user-42" }),
    });
    expect(ctx.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, identityProvenance: "gateway_session" }),
      undefined,
    );
  });

  it("confirmCompleted routes through ViaGatewaySession entry", async () => {
    confirmViaGatewayMock.mockResolvedValue({
      ok: true,
      record: { status: "completed" },
      identityProvenance: "gateway_session",
    });
    const ctx = makeCtx({
      groupId: "grp-canary",
      taskId: "task-1",
      opKey: "op-1",
      roundId: "round-1",
    });
    await collaborationLearningHandlers["collaboration.task.wakeOp.confirmCompleted"](ctx);
    expect(confirmViaGatewayMock).toHaveBeenCalledTimes(1);
    expect(confirmViaGatewayMock.mock.calls[0][0]).toMatchObject({
      groupId: "grp-canary",
      taskId: "task-1",
      opKey: "op-1",
      roundId: "round-1",
    });
    expect(ctx.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true }),
      undefined,
    );
  });

  it("releaseForRetry rejects actorId in params (additionalProperties false)", async () => {
    const ctx = makeCtx({
      groupId: "grp-canary",
      taskId: "task-1",
      opKey: "op-1",
      verificationId: "ver-1",
      actorId: "forged",
    });
    await collaborationLearningHandlers["collaboration.task.wakeOp.releaseForRetry"](ctx);
    expect(releaseViaGatewayMock).not.toHaveBeenCalled();
    expect(ctx.respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});
