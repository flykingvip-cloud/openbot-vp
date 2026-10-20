/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_UI_ENTERPRISE_BASE_PATH,
  CONTROL_UI_PLATFORM_AUTH_BASE_PATH,
} from "../../../src/gateway/control-ui-contract.js";
import { OpenBotApp } from "./app.ts";

function seatCreateResponse(seatId: string, title: string) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      seat: {
        seatId,
        title,
        status: "vacant",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    }),
  };
}

function provisionResponse(code = "EMP-1") {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      emailDelivery: { status: "queued", reason: "smtp_not_configured" },
      platformAuth: {
        enabled: true,
        pendingActivation: {
          kind: "employee-activation",
          email: "member@example.com",
          code,
          expiresAt: "2026-06-20T00:00:00.000Z",
        },
      },
    }),
  };
}

function enterpriseState(tenantId = "acme") {
  return {
    enabled: true,
    hasUsers: true,
    sessionKind: "enterprise-admin" as const,
    enterprise: {
      id: tenantId,
      name: "Acme",
      status: "paid" as const,
      plan: "pro",
      billingStatus: "active",
      createdSource: "self-service" as const,
      seatQuota: 10,
      seatUsed: 0,
      seatsRemaining: 10,
    },
  };
}

describe("OpenBotApp invite binds a created position", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an empty seat before createPlatformAuthInvite provisions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-sales", "Sales Lead"))
      .mockResolvedValueOnce(provisionResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const app = new OpenBotApp();
    app.platformAuthState = enterpriseState();
    app.platformAuthDisplayName = "Member";
    app.platformAuthEmail = "member@example.com";
    app.platformAuthSeatTitle = "Sales Lead";

    await app.createPlatformAuthInvite();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${CONTROL_UI_ENTERPRISE_BASE_PATH}/acme/seats`,
    );
    const provisionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      seatId?: string;
    };
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/employee/provision");
    expect(provisionBody.seatId).toBe("seat-sales");
    expect(app.platformAuthError).toBeNull();
  });

  it("imports organization rows by creating each position before invite", async () => {
    vi.spyOn(
      await import("./controllers/enterprise-seat-assets.ts"),
      "mutateEnterpriseOrganizationDepartment",
    ).mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-import", "销售助理"))
      .mockResolvedValueOnce(provisionResponse("EMP-IMPORT"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const app = new OpenBotApp();
    app.platformAuthState = enterpriseState();
    app.loadOverview = vi.fn(async () => {});

    await app.importEnterpriseOrganizationRows([
      {
        employeeName: "Alice",
        employeeEmail: "alice@example.com",
        seatTitle: "销售助理",
        teamLabel: "销售部",
      },
    ]);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      seatTitle: "销售助理",
      teamLabel: "销售部",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      employeeEmail: "alice@example.com",
      seatId: "seat-import",
      sendActivationEmail: false,
    });
    expect(app.platformAuthError).toBeNull();
  });

  it("creates the position before submitEnterpriseSeatCreate sends the invite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-new", "Sales Lead"))
      .mockResolvedValueOnce(provisionResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const app = new OpenBotApp();
    app.platformAuthState = enterpriseState("tenant-submit");
    app.loadOverview = vi.fn(async () => {});
    app.enterpriseSeatCreateEditorSeatId = null;
    app.enterpriseSeatCreateEditorSeatTitle = "Sales Lead";
    app.enterpriseSeatCreateEditorTeamLabel = "Sales";
    app.enterpriseSeatCreateEditorResponsibility = "Own the pipeline";
    app.enterpriseSeatCreateEditorEmployeeEmail = "member@example.com";

    await app.submitEnterpriseSeatCreate("tenant-submit");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${CONTROL_UI_ENTERPRISE_BASE_PATH}/tenant-submit/seats`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      seatTitle: "Sales Lead",
      teamLabel: "Sales",
      responsibility: "Own the pipeline",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).seatId).toBe("seat-new");
    expect(app.platformAuthError).toBeNull();
  });

  it("creates a position for each organization member before inviting them", async () => {
    vi.spyOn(
      await import("./controllers/enterprise-seat-assets.ts"),
      "mutateEnterpriseOrganizationDepartment",
    ).mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seatCreateResponse("seat-member", "销售助理"))
      .mockResolvedValueOnce(provisionResponse("EMP-MEMBER"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const app = new OpenBotApp();
    app.platformAuthState = enterpriseState();
    app.loadOverview = vi.fn(async () => {});

    await app.buildEnterpriseOrganization({
      departmentPaths: ["销售部"],
      seats: [
        {
          teamLabel: "销售部",
          seatTitle: "销售助理",
          employeeName: "Alice",
          employeeEmail: "alice@example.com",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).seatTitle).toBe("销售助理");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      employeeEmail: "alice@example.com",
      seatId: "seat-member",
      sendActivationEmail: false,
    });
    expect(app.platformAuthError).toBeNull();
  });
});
