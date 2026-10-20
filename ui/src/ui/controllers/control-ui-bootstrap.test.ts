/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "../../../../src/gateway/control-ui-contract.js";
import {
  isCurrentControlUiGatewayTarget,
  loadControlUiBootstrapConfig,
} from "./control-ui-bootstrap.ts";

describe("loadControlUiBootstrapConfig", () => {
  it("loads assistant identity from the bootstrap endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        basePath: "/openclaw",
        assistantName: "Ops",
        assistantAvatar: "O",
        assistantAgentId: "main",
        serverVersion: "2026.3.7",
        authMode: "trusted-proxy",
        authSession: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: "acme",
          role: "operator",
          scopes: ["operator.read"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          allowRegistration: true,
          pendingActivation: {
            kind: "employee-activation",
            assignmentId: "assign-1",
            email: "alice@example.com",
            code: "EMP-0001",
            expiresAt: "2026-04-10T00:00:00.000Z",
            enterpriseName: "Acme",
          },
          organization: {
            seatCount: 1,
            occupiedSeatCount: 1,
            assignedSeatCount: 0,
            vacantSeatCount: 0,
            handoverSeatCount: 0,
            frozenSeatCount: 0,
            pendingOfferCount: 0,
            seats: [
              {
                seatId: "seat-1",
                title: "CEO",
                status: "occupied",
                currentEmployeeUser: "alice@example.com",
                currentEmployeeDisplayName: "Alice",
                activeBindingStatus: "active",
              },
            ],
            handovers: [],
            offers: [],
          },
          employeeAccess: {
            currentSeat: {
              seatId: "seat-1",
              title: "CEO",
              status: "occupied",
              bindingStatus: "active",
            },
            pendingOffer: {
              assignmentId: "assign-offer-1",
              assignmentType: "internal",
              offerId: "offer-1",
              seatId: "seat-2",
              seatTitle: "Finance Successor",
              offeredAt: "2026-04-09T01:00:00.000Z",
            },
            notice: null,
          },
          members: [
            {
              user: "alice@example.com",
              displayName: "Alice",
              membershipRole: "enterprise-admin",
              joinedAt: "2026-04-09T00:00:00.000Z",
              isCurrentUser: true,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "/openclaw",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Ops");
    expect(state.assistantAvatar).toBe("O");
    expect(state.assistantAgentId).toBe("main");
    expect(state.serverVersion).toBe("2026.3.7");
    expect(state.bootstrapAuthMode).toBe("trusted-proxy");
    expect(state.bootstrapAuthSession).toEqual({
      provider: "trusted-proxy",
      user: "alice@example.com",
      displayName: "Alice",
      tenantId: "acme",
      role: "operator",
      scopes: ["operator.read"],
    });
    expect(state.platformAuthState).toEqual({
      enabled: true,
      hasUsers: true,
      allowRegistration: true,
      pendingActivation: {
        kind: "employee-activation",
        assignmentId: "assign-1",
        email: "alice@example.com",
        code: "EMP-0001",
        expiresAt: "2026-04-10T00:00:00.000Z",
        enterpriseName: "Acme",
      },
      organization: {
        seatCount: 1,
        occupiedSeatCount: 1,
        assignedSeatCount: 0,
        vacantSeatCount: 0,
        handoverSeatCount: 0,
        frozenSeatCount: 0,
        pendingOfferCount: 0,
        seats: [
          {
            seatId: "seat-1",
            title: "CEO",
            status: "occupied",
            currentEmployeeUser: "alice@example.com",
            currentEmployeeDisplayName: "Alice",
            activeBindingStatus: "active",
          },
        ],
        handovers: [],
        offers: [],
      },
      employeeAccess: {
        currentSeat: {
          seatId: "seat-1",
          title: "CEO",
          status: "occupied",
          bindingStatus: "active",
        },
        pendingOffer: {
          assignmentId: "assign-offer-1",
          assignmentType: "internal",
          offerId: "offer-1",
          seatId: "seat-2",
          seatTitle: "Finance Successor",
          offeredAt: "2026-04-09T01:00:00.000Z",
        },
        notice: null,
      },
      members: [
        {
          user: "alice@example.com",
          displayName: "Alice",
          membershipRole: "enterprise-admin",
          joinedAt: "2026-04-09T00:00:00.000Z",
          isCurrentUser: true,
        },
      ],
    });

    vi.unstubAllGlobals();
  });

  it("preserves employeeAccess ownedAgentIds and employeeUserId from bootstrap", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assistantName: "Ops",
        platformAuth: {
          enabled: true,
          hasUsers: true,
          session: {
            provider: "trusted-proxy",
            user: "ceo@example.com",
            displayName: "CEO",
            tenantId: "001",
          },
          employeeAccess: {
            currentSeat: {
              seatId: "seat-ceo",
              title: "CEO",
              status: "occupied",
              bindingStatus: "active",
            },
            agentIds: ["main"],
            ownedAgentIds: ["bot", "bot-2"],
            employeeUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
            defaultSpaceIds: [],
            notice: null,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    const platformAuthState = state.platformAuthState as
      | { employeeAccess?: { ownedAgentIds?: string[]; employeeUserId?: string } }
      | null
      | undefined;
    const employeeAccess = platformAuthState?.employeeAccess as
      | { ownedAgentIds?: string[]; employeeUserId?: string }
      | undefined;
    expect(employeeAccess?.ownedAgentIds).toEqual(["bot", "bot-2"]);
    expect(employeeAccess?.employeeUserId).toBe("90fed19a-1c8b-4420-87e0-bcc6165e32fa");

    vi.unstubAllGlobals();
  });

  it("loads trusted-proxy browser auth session from bootstrap when platform auth is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        basePath: "",
        assistantName: "Ops",
        assistantAvatar: "O",
        assistantAgentId: "main",
        serverVersion: "2026.3.7",
        authMode: "trusted-proxy",
        authSession: {
          provider: "trusted-proxy",
          user: "owner@example.com",
          displayName: "Owner",
          tenantId: "acme",
          role: "operator",
          scopes: ["operator.admin"],
        },
        platformAuth: {
          enabled: true,
          hasUsers: true,
          sessionKind: "enterprise-admin",
          sessionDomain: "enterprise",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(state.bootstrapAuthMode).toBe("trusted-proxy");
    expect(state.bootstrapAuthSession).toMatchObject({
      user: "owner@example.com",
      tenantId: "acme",
    });
    expect(state.platformAuthState).toMatchObject({
      sessionKind: "enterprise-admin",
      sessionDomain: "enterprise",
      membershipRole: "enterprise-admin",
    });

    vi.unstubAllGlobals();
  });

  it("promotes the validated platform session when the top-level auth session is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assistantName: "Ops",
        authMode: "trusted-proxy",
        platformAuth: {
          enabled: true,
          hasUsers: true,
          sessionKind: "member",
          session: {
            provider: "trusted-proxy",
            user: "employee@example.com",
            tenantId: "acme",
            role: "operator",
            scopes: ["operator.read"],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(state.bootstrapAuthSession).toMatchObject({
      provider: "trusted-proxy",
      user: "employee@example.com",
      tenantId: "acme",
    });

    vi.unstubAllGlobals();
  });

  it("ignores failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Assistant");

    vi.unstubAllGlobals();
  });

  it("normalizes trailing slash basePath for bootstrap fetch path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "/openclaw/",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      bootstrapAuthMode: null,
      bootstrapAuthSession: null,
      platformAuthState: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
  });

  it("recognizes the current page host as the active gateway target", () => {
    expect(
      isCurrentControlUiGatewayTarget({
        gatewayUrl: "ws://127.0.0.1:18789/openclaw",
        pageUrl: "http://127.0.0.1:18789/openclaw",
      }),
    ).toBe(true);
    expect(
      isCurrentControlUiGatewayTarget({
        gatewayUrl: "wss://gateway.example.com/openclaw",
        pageUrl: "http://127.0.0.1:18789/openclaw",
      }),
    ).toBe(false);
  });
});
