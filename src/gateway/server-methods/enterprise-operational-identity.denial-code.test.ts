import { beforeEach, describe, expect, it, vi } from "vitest";

const requireResolvedEnterpriseAdminTenantIdMock = vi.hoisted(() => vi.fn());
const enforceOperationalIdentityRuntimeAccessMock = vi.hoisted(() => vi.fn());

vi.mock("../enterprise-data/enterprise-data-seat-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../enterprise-data/enterprise-data-seat-context.js")>();
  return {
    ...actual,
    requireResolvedEnterpriseAdminTenantId: (...args: unknown[]) =>
      requireResolvedEnterpriseAdminTenantIdMock(...args),
  };
});

vi.mock("../enterprise-operational-identity-runtime.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../enterprise-operational-identity-runtime.js")>();
  return {
    ...actual,
    enforceOperationalIdentityRuntimeAccess: (...args: unknown[]) =>
      enforceOperationalIdentityRuntimeAccessMock(...args),
  };
});

const { enterpriseOperationalIdentityHandlers } =
  await import("./enterprise-operational-identity.js");

describe("enterprise-operational-identity.access.resolve denial code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireResolvedEnterpriseAdminTenantIdMock.mockResolvedValue("001");
  });

  it("does not collapse a missing enforcement result into NO_SEAT_CONTEXT", async () => {
    enforceOperationalIdentityRuntimeAccessMock.mockResolvedValue({
      ok: false,
      scope: null,
      result: null,
      message: "denied",
    });

    let captured: { ok: boolean; payload?: Record<string, unknown> } = { ok: false };
    await enterpriseOperationalIdentityHandlers["enterprise-operational-identity.access.resolve"]({
      req: {} as never,
      params: {
        seatId: "seat-1",
        agentId: "bot--agent",
        identityId: "id-tm",
        action: "list_meetings",
      },
      client: {} as never,
      isWebchatConnect: () => false,
      respond: ((ok: boolean, payload?: unknown) => {
        captured = { ok, payload: payload as Record<string, unknown> };
      }) as never,
      context: {} as never,
    });

    expect(captured.ok).toBe(true);
    expect(captured.payload?.allowed).toBe(false);
    expect(captured.payload?.code).toBe("IDENTITY_ACTION_DENIED");
    expect(captured.payload?.code).not.toBe("NO_SEAT_CONTEXT");
  });
});
