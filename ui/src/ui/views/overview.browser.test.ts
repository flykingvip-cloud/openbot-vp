/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function getButtonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}

function baseProps(): OverviewProps {
  return {
    connected: false,
    hello: {
      snapshot: {
        authMode: "trusted-proxy",
      },
    } as OverviewProps["hello"],
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
    } as OverviewProps["settings"],
    password: "",
    bootstrapAuthMode: "trusted-proxy" as const,
    bootstrapAuthSession: null,
    platformAuthState: {
      enabled: true,
      hasUsers: false,
      allowRegistration: true,
    },
    lastError: "unauthorized",
    lastErrorCode: "AUTH_REQUIRED",
    presenceCount: 0,
    sessionsCount: 0,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    onSettingsChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onSessionKeyChange: vi.fn(),
    onConnect: vi.fn(),
    onRefresh: vi.fn(),
    onPlatformAuthModeChange: vi.fn(),
    onPlatformAuthEmailChange: vi.fn(),
    onPlatformAuthPasswordChange: vi.fn(),
    onPlatformAuthDisplayNameChange: vi.fn(),
    onPlatformAuthPlatformAdminDisplayNameChange: vi.fn(),
    onPlatformAuthTenantNameChange: vi.fn(),
    onPlatformAuthSeatTitleChange: vi.fn(),
    onPlatformAuthInviteCodeChange: vi.fn(),
    onPlatformAuthCurrentPasswordChange: vi.fn(),
    onPlatformAuthNewPasswordChange: vi.fn(),
    onPlatformAuthPolicyTrialDaysChange: vi.fn(),
    onPlatformAuthPolicySeatCountChange: vi.fn(),
    onPlatformAuthPolicyUpgradeUrlChange: vi.fn(),
    onPlatformAuthPolicyContactAdvisorUrlChange: vi.fn(),
    onPlatformAuthInstanceEnterpriseIdChange: vi.fn(),
    onPlatformAuthInstanceTrialDaysChange: vi.fn(),
    onPlatformAuthInstanceSeatCountChange: vi.fn(),
    onPlatformAuthInstanceUpgradeUrlChange: vi.fn(),
    onPlatformAuthInstanceContactAdvisorUrlChange: vi.fn(),
    onPlatformAuthSubmit: vi.fn(),
    onPlatformAuthCreatePlatformAdmin: vi.fn(),
    onPlatformAuthLogout: vi.fn(),
    onPlatformAuthCreateInvite: vi.fn(),
    onPlatformAuthRevokeInvite: vi.fn(),
    onPlatformAuthRemoveMember: vi.fn(),
    onPlatformAuthChangePassword: vi.fn(),
    onPlatformAuthUpdateTrialPolicy: vi.fn(),
    onPlatformAuthUpdateTrialInstance: vi.fn(),
    platformAuthMode: "enterprise-create" as const,
    platformAuthBusy: false,
    platformAuthError: null,
    platformAuthNotice: null,
    platformAuthEmail: "",
    platformAuthPassword: "",
    platformAuthDisplayName: "",
    platformAuthPlatformAdminDisplayName: "",
    platformAuthTenantName: "",
    platformAuthSeatTitle: "",
    platformAuthInviteCode: "",
    platformAuthCurrentPassword: "",
    platformAuthNewPassword: "",
    platformAuthPolicyTrialDays: "",
    platformAuthPolicySeatCount: "",
    platformAuthPolicyUpgradeUrl: "",
    platformAuthPolicyContactAdvisorUrl: "",
    platformAuthInstanceEnterpriseId: "",
    platformAuthInstanceTrialDays: "",
    platformAuthInstanceSeatCount: "",
    platformAuthInstanceUpgradeUrl: "",
    platformAuthInstanceContactAdvisorUrl: "",
    platformAuthPlatformAdminEmail: "",
    platformAuthPlatformAdminPassword: "",
    platformAuthPlatformAdminScopes: [],
    onPlatformAuthPlatformAdminEmailChange: vi.fn(),
    onPlatformAuthPlatformAdminPasswordChange: vi.fn(),
    onPlatformAuthPlatformAdminScopesChange: vi.fn(),
  };
}

describe("overview platform auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    window.history.replaceState({}, "", "/control-ui");
    await i18n.setLocale("en");
  });

  it("shows the embedded registration panel for trusted-proxy auth failures", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
      }),
      container,
    );

    expect(container.textContent).toContain("Create enterprise");
    expect(container.textContent).toContain("Open a workspace for your team.");
    expect(container.textContent).not.toContain(
      "This gateway delegates end-user auth to a trusted proxy.",
    );
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[autocomplete="organization"]')).not.toBeNull();
  });

  it("keeps invite-based registration available for existing invite-only enterprises", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: [
            "enterprise-create",
            "enterprise-activate",
            "login",
            "forgot-password",
            "password-reset",
          ],
        },
        platformAuthMode: "enterprise-create",
      }),
      container,
    );

    expect(container.textContent).toContain("Create enterprise");
    // The mode switcher offers the enterprise admin activation option (tab label "Activate").
    expect(container.textContent).toContain("Activate");
    expect(container.textContent).not.toContain(
      "This gateway delegates end-user auth to a trusted proxy.",
    );
  });

  it("renders platform auth success notices for follow-up admin actions", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          tenantId: "acme",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          session: {
            provider: "trusted-proxy",
            user: "alice@example.com",
            tenantId: "acme",
          },
          sessionKind: "enterprise-admin",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
          enterprise: {
            id: "acme",
            name: "Acme",
            status: "trial",
            plan: "trial",
            billingStatus: "trialing",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 1,
            seatsRemaining: 4,
          },
        },
        platformAuthNotice: "A new invite was created.",
      }),
      container,
    );

    expect(container.querySelector(".callout.success")?.textContent).toContain(
      "A new invite was created.",
    );
  });

  it("shows the enterprise-side employee activation panel for enterprise administrators", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "owner@example.com",
          tenantId: "acme",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          session: {
            provider: "trusted-proxy",
            user: "owner@example.com",
            tenantId: "acme",
          },
          sessionKind: "enterprise-admin",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
          enterprise: {
            id: "acme",
            name: "Acme",
            status: "trial",
            plan: "trial",
            billingStatus: "trialing",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 1,
            seatsRemaining: 4,
          },
        },
        platformAuthDisplayName: "Taylor",
        platformAuthEmail: "taylor@example.com",
        platformAuthSeatTitle: "Support",
        platformAuthInviteCode: "EMP-TAYLORX",
      }),
      container,
    );

    expect(container.textContent).toContain("Employee account");
    expect(container.textContent).toContain("Issue employee invite");
    expect(container.textContent).toContain(
      "Share this code with the employee to complete activation.",
    );
    const employeeRegisterLink = container.querySelector('a[href*="authMode=employee-register"]');
    expect(employeeRegisterLink?.textContent?.trim()).toBe("Open employee homepage");
    expect(employeeRegisterLink?.getAttribute("href")).toContain("email=taylor%40example.com");
    expect(employeeRegisterLink?.getAttribute("href")).toContain("code=EMP-TAYLORX");
  });

  it("renders password and trial management panels for platform administrators", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformPolicy: {
            defaultTrialDays: 14,
            allowedTrialDays: [7, 14, 30],
            defaultTrialSeatCount: 5,
            trialSeatOptions: [5, 10, 20],
            allowCustomTrialSeatCount: true,
            trialExpiryPolicy: "choose",
            upgradeUrl: "https://example.com/upgrade",
            contactAdvisorUrl: "https://example.com/advisor",
          },
        },
      }),
      container,
    );

    expect(container.textContent).toContain("Change password");
    expect(container.textContent).toContain("Platform trial policy");
    expect(container.textContent).toContain("Enterprise trial override");
  });

  it("shows trial controls inside the platform enterprise creation form", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthMode: "platform-enterprise-create",
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
        },
      }),
      container,
    );

    expect(container.textContent).toContain("Trial days");
    expect(container.textContent).toContain("Seat count");
    expect(container.textContent).toContain("Upgrade URL");
    expect(container.textContent).toContain("Advisor URL");
  });

  it("prefills the enterprise override editor from the platform enterprise directory", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformEnterprises: [
            {
              id: "acme-1234",
              name: "Acme",
              status: "trial",
              plan: "trial",
              billingStatus: "trialing",
              createdSource: "platform-created",
              trialDaysSnapshot: 21,
              seatQuota: 10,
              seatUsed: 2,
              seatsRemaining: 8,
              trialEndsAt: "2026-05-01T00:00:00.000Z",
              upgradeUrl: "https://example.com/upgrade",
              contactAdvisorUrl: "https://example.com/advisor",
            },
          ],
        },
      }),
      container,
    );

    getButtonByText(container, "Use in override").click();

    expect(props.onPlatformAuthInstanceEnterpriseIdChange).toHaveBeenCalledWith("acme-1234");
    expect(props.onPlatformAuthInstanceTrialDaysChange).toHaveBeenCalledWith("21");
    expect(props.onPlatformAuthInstanceSeatCountChange).toHaveBeenCalledWith("10");
    expect(props.onPlatformAuthInstanceUpgradeUrlChange).toHaveBeenCalledWith(
      "https://example.com/upgrade",
    );
    expect(props.onPlatformAuthInstanceContactAdvisorUrlChange).toHaveBeenCalledWith(
      "https://example.com/advisor",
    );
  });

  it("highlights enterprises that need platform follow-up in the platform directory", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformEnterprises: [
            {
              id: "acme-1234",
              name: "Acme",
              status: "expired",
              plan: "trial",
              billingStatus: "expired",
              createdSource: "self-service",
              trialDaysSnapshot: 14,
              seatQuota: 5,
              seatUsed: 5,
              seatsRemaining: 0,
              trialEndsAt: "2026-04-01T00:00:00.000Z",
            },
            {
              id: "contoso-8888",
              name: "Contoso",
              status: "trial",
              plan: "trial",
              billingStatus: "trialing",
              createdSource: "platform-created",
              trialDaysSnapshot: 21,
              seatQuota: 3,
              seatUsed: 3,
              seatsRemaining: 0,
              trialEndsAt: "2026-04-28T00:00:00.000Z",
            },
            {
              id: "globex-1111",
              name: "Globex",
              status: "trial",
              plan: "trial",
              billingStatus: "trialing",
              createdSource: "self-service",
              trialDaysSnapshot: 21,
              seatQuota: 10,
              seatUsed: 2,
              seatsRemaining: 8,
              trialEndsAt: "2026-05-10T00:00:00.000Z",
            },
          ],
        },
      }),
      container,
    );

    expect(container.textContent).toContain("Needs follow-up");
    expect(container.textContent).toContain("Trial ended");
    expect(container.textContent).toContain("Trial seats exhausted");
    expect(container.textContent).toContain("All enterprises");
    expect(container.textContent).toContain("Globex");
  });

  it("offers a quick restore action for expired enterprises", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformPolicy: {
            defaultTrialDays: 14,
            allowedTrialDays: [7, 14, 21],
            defaultTrialSeatCount: 5,
            trialSeatOptions: [5, 10],
            allowCustomTrialSeatCount: true,
            trialExpiryPolicy: "choose",
          },
          platformEnterprises: [
            {
              id: "acme-1234",
              name: "Acme",
              status: "expired",
              plan: "trial",
              billingStatus: "expired",
              createdSource: "self-service",
              trialDaysSnapshot: 21,
              seatQuota: 5,
              seatUsed: 5,
              seatsRemaining: 0,
              trialEndsAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
      }),
      container,
    );

    getButtonByText(container, "Restore trial override").click();

    expect(props.onPlatformAuthInstanceEnterpriseIdChange).toHaveBeenCalledWith("acme-1234");
    expect(props.onPlatformAuthInstanceTrialDaysChange).toHaveBeenCalledWith("21");
    expect(props.onPlatformAuthInstanceSeatCountChange).toHaveBeenCalledWith("5");
  });

  it("offers a quick seat expansion action for full trial enterprises", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformEnterprises: [
            {
              id: "contoso-8888",
              name: "Contoso",
              status: "trial",
              plan: "trial",
              billingStatus: "trialing",
              createdSource: "platform-created",
              trialDaysSnapshot: 21,
              seatQuota: 3,
              seatUsed: 3,
              seatsRemaining: 0,
              trialEndsAt: "2026-04-28T00:00:00.000Z",
            },
          ],
        },
      }),
      container,
    );

    getButtonByText(container, "Increase seats override").click();

    expect(props.onPlatformAuthInstanceEnterpriseIdChange).toHaveBeenCalledWith("contoso-8888");
    expect(props.onPlatformAuthInstanceTrialDaysChange).toHaveBeenCalledWith("21");
    expect(props.onPlatformAuthInstanceSeatCountChange).toHaveBeenCalledWith("4");
  });

  it("highlights the currently edited enterprise in both the directory and override editor", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "ops@example.com",
          role: "operator",
        },
        platformAuthInstanceEnterpriseId: "acme-1234",
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          availableModes: ["platform-enterprise-create"],
          session: {
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          sessionKind: "platform-admin",
          canManagePlatform: true,
          platformEnterprises: [
            {
              id: "acme-1234",
              name: "Acme",
              status: "trial",
              plan: "trial",
              billingStatus: "trialing",
              createdSource: "self-service",
              trialDaysSnapshot: 21,
              seatQuota: 10,
              seatUsed: 2,
              seatsRemaining: 8,
              trialEndsAt: "2026-05-01T00:00:00.000Z",
            },
          ],
        },
      }),
      container,
    );

    expect(container.textContent).toContain("Editing");
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Trial ends at 2026-05-01T00:00:00.000Z");
  });

  it("confirms destructive enterprise admin actions before invoking handlers", () => {
    const container = document.createElement("div");
    const gatewayUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}`;
    const props = baseProps();
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          tenantId: "acme",
        },
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          session: {
            provider: "trusted-proxy",
            user: "alice@example.com",
            tenantId: "acme",
          },
          sessionKind: "enterprise-admin",
          tenantName: "Acme",
          membershipRole: "enterprise-admin",
          enterprise: {
            id: "acme",
            name: "Acme",
            status: "trial",
            plan: "trial",
            billingStatus: "trialing",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 2,
            seatsRemaining: 3,
          },
          members: [
            {
              user: "alice@example.com",
              displayName: "Alice",
              membershipRole: "enterprise-admin",
              isCurrentUser: true,
            },
            {
              user: "bob@example.com",
              displayName: "Bob",
              membershipRole: "member",
              isCurrentUser: false,
            },
          ],
        },
      }),
      container,
    );

    getButtonByText(container, "Remove member").click();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(props.onPlatformAuthRemoveMember).not.toHaveBeenCalled();

    confirmMock.mockReturnValue(true);
    getButtonByText(container, "Remove member").click();

    expect(props.onPlatformAuthRemoveMember).toHaveBeenCalledWith("bob@example.com");
  });

  it("clears the current token when the gateway URL changes from the overview access form", () => {
    const container = document.createElement("div");
    const props = baseProps();

    render(
      renderOverview({
        ...props,
        settings: {
          ...props.settings,
          gatewayUrl: "wss://gateway.example/openclaw",
          token: "abc123",
        },
      }),
      container,
    );

    const gatewayUrlInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="ws://100.x.y.z:18789"]',
    );
    expect(gatewayUrlInput).not.toBeNull();

    gatewayUrlInput!.value = "wss://other-gateway.example/openclaw";
    gatewayUrlInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(props.onSettingsChange).toHaveBeenCalledWith({
      ...props.settings,
      gatewayUrl: "wss://other-gateway.example/openclaw",
      token: "",
    });
  });
});
