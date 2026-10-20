/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTROL_UI_ENTERPRISE_BASE_PATH } from "../../../../src/gateway/control-ui-contract.js";
import {
  approveEnterpriseSeatHandover,
  createEnterpriseSeat,
  getEnterpriseHandoverDetail,
  getEnterpriseSeatDetail,
  listEnterpriseSeats,
  remindEnterpriseSeatAssignmentOffer,
  rebindEnterpriseSeatHandover,
  reviewEnterpriseSeatHandover,
  startEnterpriseSeatHandover,
} from "./enterprise-seat-assets.ts";

function createHost() {
  return {
    basePath: "/openclaw/",
    platformAuthBusy: false,
    platformAuthError: null as string | null,
    platformAuthState: {
      enabled: true,
      hasUsers: true,
      sessionKind: "enterprise-admin" as const,
      tenantName: "Acme",
      organization: {
        seatCount: 1,
        occupiedSeatCount: 1,
        vacantSeatCount: 0,
        handoverSeatCount: 0,
        frozenSeatCount: 0,
        pendingOfferCount: 0,
        seats: [],
        handovers: [],
        offers: [],
      },
    },
  };
}

describe("enterprise seat assets controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts handover and updates the organization snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        conflicts: [],
        updatedSnapshot: {
          organization: {
            seatCount: 1,
            occupiedSeatCount: 0,
            vacantSeatCount: 0,
            handoverSeatCount: 1,
            frozenSeatCount: 0,
            pendingOfferCount: 0,
            seats: [],
            handovers: [],
            offers: [],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await startEnterpriseSeatHandover(host, "acme", "seat-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/handover/start`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ seatId: "seat-1" }),
      }),
    );
    expect(host.platformAuthState?.organization?.handoverSeatCount).toBe(1);
    expect(host.platformAuthError).toBeNull();
  });

  it("reviews, approves, and rebinds a handover case", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          conflicts: ["connector_rebind_required"],
          updatedSnapshot: {
            organization: {
              seatCount: 1,
              occupiedSeatCount: 0,
              vacantSeatCount: 0,
              handoverSeatCount: 0,
              frozenSeatCount: 1,
              pendingOfferCount: 0,
              seats: [],
              handovers: [],
              offers: [],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          conflicts: [],
          updatedSnapshot: {
            organization: {
              seatCount: 1,
              occupiedSeatCount: 0,
              vacantSeatCount: 0,
              handoverSeatCount: 0,
              frozenSeatCount: 1,
              pendingOfferCount: 0,
              seats: [],
              handovers: [],
              offers: [],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          conflicts: [],
          updatedSnapshot: {
            organization: {
              seatCount: 1,
              occupiedSeatCount: 1,
              vacantSeatCount: 0,
              handoverSeatCount: 0,
              frozenSeatCount: 0,
              pendingOfferCount: 0,
              seats: [],
              handovers: [],
              offers: [],
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const transferSelection = {
      agentIds: ["agent-main"],
      spaceIds: ["space-sales"],
      dataKeys: ["recent_sessions", "knowledge"],
      policyIds: ["employee-policy-1"],
    };
    await reviewEnterpriseSeatHandover(
      host,
      "acme",
      "handover-1",
      "Reviewed seat memory and connector drift.",
      ["connector_rebind_required"],
      transferSelection,
    );
    await approveEnterpriseSeatHandover(host, "acme", "handover-1");
    await rebindEnterpriseSeatHandover(host, "acme", "handover-1", "bob@example.com");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/handover/handover-1/review`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reviewSummary: "Reviewed seat memory and connector drift.",
          exceptionFlags: ["connector_rebind_required"],
          transferSelection: {
            agentIds: ["agent-main"],
            spaceIds: ["space-sales"],
            dataKeys: ["recent_sessions", "knowledge"],
            policyIds: ["employee-policy-1"],
          },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/handover/handover-1/approve`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/handover/handover-1/rebind`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ employeeEmail: "bob@example.com" }),
      }),
    );
    expect(host.platformAuthState?.organization?.occupiedSeatCount).toBe(1);
  });

  it("reminds a pending seat assignment offer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        conflicts: [],
        updatedSnapshot: {
          organization: {
            seatCount: 1,
            occupiedSeatCount: 0,
            vacantSeatCount: 1,
            handoverSeatCount: 0,
            frozenSeatCount: 0,
            pendingOfferCount: 1,
            seats: [],
            handovers: [],
            offers: [],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await remindEnterpriseSeatAssignmentOffer(host, "acme", "offer-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/offers/offer-1/remind`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(host.platformAuthState?.organization?.pendingOfferCount).toBe(1);
    expect(host.platformAuthError).toBeNull();
  });

  it("lists seats and refreshes the organization snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        seats: [
          {
            seatId: "seat-ceo",
            tenantId: "acme",
            title: "CEO",
            status: "occupied",
            defaultSpaceIds: ["space-1"],
            defaultAgentAssetIds: ["main"],
            createdAt: "2026-05-31T00:00:00.000Z",
            updatedAt: "2026-05-31T00:00:00.000Z",
          },
        ],
        updatedSnapshot: {
          organization: {
            seatCount: 4,
            occupiedSeatCount: 2,
            vacantSeatCount: 2,
            handoverSeatCount: 0,
            frozenSeatCount: 0,
            pendingOfferCount: 0,
            seats: [
              {
                seatId: "seat-ceo",
                title: "CEO",
                status: "occupied",
                currentEmployeeDisplayName: "UPBEYOND",
                defaultAgentId: "main",
                agentIds: ["main"],
                defaultSpaceIds: ["space-1"],
              },
            ],
            handovers: [],
            offers: [],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const result = await listEnterpriseSeats(host, "acme");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/seats`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
    expect(result?.seats).toHaveLength(1);
    const organization = host.platformAuthState?.organization as
      | { seatCount?: number; seats?: Array<{ title?: string }> }
      | undefined;
    expect(organization?.seatCount).toBe(4);
    expect(organization?.seats?.[0]?.title).toBe("CEO");
    expect(host.platformAuthError).toBeNull();
  });

  it("shows an actionable Chinese setup error when seat assets are disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        ok: false,
        code: "ENTERPRISE_ASSETS_NOT_ENABLED",
        error: "Enterprise seat assets are unavailable until platform auth is enabled.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await createEnterpriseSeat(host, "acme", {
      seatTitle: "销售助手",
      teamLabel: "销售部",
      responsibility: "负责销售计划制定",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/seats`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          seatTitle: "销售助手",
          teamLabel: "销售部",
          responsibility: "负责销售计划制定",
        }),
      }),
    );
    expect(host.platformAuthError).toContain("企业岗位资产服务尚未启用");
    expect(host.platformAuthError).toContain("gateway.auth.trustedProxy.platformAuth");
  });

  it("maps member-not-found errors to an activation guidance message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        ok: false,
        code: "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND",
        error: "Target employee was not found in this tenant.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    await rebindEnterpriseSeatHandover(host, "acme", "handover-1", "new.user@example.com");

    expect(host.platformAuthError).toContain("还不是当前企业的已激活成员");
    expect(host.platformAuthError).toContain("邀请激活");
  });

  it("loads handover detail through the enterprise detail endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        handover: {
          handoverCaseId: "handover-1",
          seatId: "seat-1",
          seatTitle: "Finance Lead",
          seatStatus: "frozen",
          status: "frozen",
          reviewSummary: "Assets reviewed.",
          exceptionFlags: ["connector_rebind_required"],
          outgoingEmployee: {
            userId: "user-1",
            email: "alice@example.com",
            displayName: "Alice",
          },
        },
        updatedSnapshot: {
          organization: {
            seatCount: 1,
            occupiedSeatCount: 0,
            vacantSeatCount: 0,
            handoverSeatCount: 0,
            frozenSeatCount: 1,
            pendingOfferCount: 0,
            seats: [],
            handovers: [],
            offers: [],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const result = await getEnterpriseHandoverDetail(host, "acme", "handover-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/handover/handover-1`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
    expect(result?.handover.seatTitle).toBe("Finance Lead");
    expect(host.platformAuthState?.organization?.frozenSeatCount).toBe(1);
  });

  it("loads seat detail through the enterprise seat endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        detail: {
          seat: {
            seatId: "seat-1",
            title: "Finance Lead",
            status: "frozen",
            defaultAgentIds: ["agent-main"],
            defaultSpaceIds: ["space-finance"],
          },
          currentEmployee: {
            userId: "user-1",
            email: "alice@example.com",
            displayName: "Alice",
            status: "disabled",
            membershipRole: "member",
          },
          binding: {
            bindingId: "binding-1",
            employeeId: "user-1",
            status: "ended",
            effectiveAt: "2026-04-10T00:00:00.000Z",
            endedAt: "2026-04-14T00:00:00.000Z",
            endedReason: "offboarded",
          },
          access: {
            employeePolicies: [
              {
                policyId: "policy-employee-1",
                subjectId: "user-1",
                resourceType: "connector",
                resourceId: "hubspot",
                action: "use",
                createdAt: "2026-04-10T00:00:00.000Z",
              },
            ],
            seatPolicies: [
              {
                policyId: "policy-seat-1",
                subjectId: "seat-1",
                resourceType: "memory",
                resourceId: "crm-playbook",
                action: "read",
                createdAt: "2026-04-10T00:00:00.000Z",
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const host = createHost();

    const result = await getEnterpriseSeatDetail(host, "acme", "seat-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/seats/seat-1`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
    expect(result?.detail.seat.title).toBe("Finance Lead");
    expect(result?.detail.access.employeePolicies[0]?.resourceId).toBe("hubspot");
    expect(host.platformAuthError).toBeNull();
  });
});
