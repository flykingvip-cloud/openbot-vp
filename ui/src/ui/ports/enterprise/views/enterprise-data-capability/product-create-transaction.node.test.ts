import { describe, expect, it, vi } from "vitest";
import { runProductCreateSaga } from "./product-create-transaction.ts";

function createGateway(overrides: Record<string, unknown> = {}) {
  return {
    upsertCapability: vi.fn(
      async (_tenant: string, payload: { enabled?: boolean; capabilityId?: string }) => ({
        ok: true as const,
        data: {
          capabilityId: payload.capabilityId ?? "cap-1",
          capabilityKey: "crm_sync",
          displayName: "客户同步",
        },
      }),
    ),
    archiveCapability: vi.fn(async () => ({ ok: true as const })),
    upsertProjectionSpec: vi.fn(async () => ({
      ok: true as const,
      data: { projectionId: "proj-1" },
    })),
    upsertProjectionBinding: vi.fn(async () => ({
      ok: true as const,
      data: { bindingId: "bind-1" },
    })),
    grantCapabilityToSeat: vi.fn(async () => ({
      ok: true as const,
      data: { grantCount: 2 },
    })),
    getCapabilityGovernanceView: vi.fn(async () => ({
      ok: true as const,
      data: {
        accessScope: {
          activeGrants: [] as Array<{ grantId: string; seatId: string; revokedAt?: string }>,
        },
      },
    })),
    revokeSeatActionGrant: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

const baseInput = {
  capabilityKey: "crm_sync",
  displayName: "客户同步",
  description: "",
  sourceIds: ["s1"],
  actionRefs: [{ connectorId: "crm", actionKey: "read", version: "v1" }],
  enabled: true,
  outputMode: "projection" as const,
  projectionTemplateKey: "NormalizeTemplate",
  seatIds: ["seat-1"],
};

describe("runProductCreateSaga", () => {
  it("creates disabled first, then enables after all steps succeed", async () => {
    const gateway = createGateway();
    const result = await runProductCreateSaga(gateway, "t1", baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capabilityId).toBe("cap-1");
    }
    expect(gateway.upsertCapability).toHaveBeenCalledTimes(2);
    const first = gateway.upsertCapability.mock.calls[0]?.[1] as { enabled: boolean } | undefined;
    const second = gateway.upsertCapability.mock.calls[1]?.[1] as { enabled: boolean } | undefined;
    expect(first?.enabled).toBe(false);
    expect(second?.enabled).toBe(true);
    expect(gateway.archiveCapability).not.toHaveBeenCalled();
  });

  it("archives capability when projection spec fails (never leaves enabled product)", async () => {
    const gateway = createGateway({
      upsertProjectionSpec: vi.fn(async () => ({ ok: false as const, error: "spec-boom" })),
    });
    const result = await runProductCreateSaga(gateway, "t1", baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compensated).toBe(true);
      expect(result.error).toContain("spec-boom");
      expect(result.error).toContain("已回滚");
    }
    expect(gateway.archiveCapability).toHaveBeenCalledWith("t1", "cap-1");
    expect(gateway.upsertCapability).toHaveBeenCalledTimes(1);
    const createPayload = gateway.upsertCapability.mock.calls[0]?.[1] as
      | { enabled: boolean }
      | undefined;
    expect(createPayload?.enabled).toBe(false);
  });

  it("deprecates spec and archives capability when binding fails", async () => {
    const gateway = createGateway({
      upsertProjectionBinding: vi.fn(async () => ({ ok: false as const, error: "bind-boom" })),
    });
    const result = await runProductCreateSaga(gateway, "t1", baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compensated).toBe(true);
    }
    expect(gateway.upsertProjectionSpec).toHaveBeenCalledTimes(2);
    const deprecateArgs = (
      gateway.upsertProjectionSpec.mock.calls as unknown as Array<
        [string, { lifecycle: string; projectionId: string }]
      >
    )[1]?.[1];
    expect(deprecateArgs?.lifecycle).toBe("deprecated");
    expect(deprecateArgs?.projectionId).toBe("proj-1");
    expect(gateway.archiveCapability).toHaveBeenCalledWith("t1", "cap-1");
  });

  it("revokes partial seat grants then rolls back when a later grant fails", async () => {
    const grant = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, data: { grantCount: 2 } })
      .mockResolvedValueOnce({ ok: false as const, error: "grant-boom" });
    const gateway = createGateway({
      grantCapabilityToSeat: grant,
      getCapabilityGovernanceView: vi.fn(async () => ({
        ok: true as const,
        data: {
          accessScope: {
            activeGrants: [{ grantId: "g-seat-1", seatId: "seat-1" }],
          },
        },
      })),
    });
    const result = await runProductCreateSaga(gateway, "t1", {
      ...baseInput,
      seatIds: ["seat-1", "seat-2"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("grant-boom");
      expect(result.compensated).toBe(true);
    }
    expect(gateway.revokeSeatActionGrant).toHaveBeenCalledWith("t1", "g-seat-1");
    expect(gateway.archiveCapability).toHaveBeenCalled();
    expect(gateway.upsertProjectionBinding).toHaveBeenCalledTimes(2);
  });

  it("does not create a projection when the product only registers the capability", async () => {
    const gateway = createGateway();
    const result = await runProductCreateSaga(gateway, "t1", {
      ...baseInput,
      outputMode: "direct",
      projectionTemplateKey: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notices).toContain("数据产品已创建并启用。");
      expect(result.notices).toContain("未创建供给记录。知识宇宙不会出现可消费内容。");
    }
    expect(gateway.upsertProjectionSpec).not.toHaveBeenCalled();
    expect(gateway.upsertProjectionBinding).not.toHaveBeenCalled();
  });
});
