import { describe, expect, it } from "vitest";
import {
  canAccessTab,
  canExecuteGatewayMethod,
  filterTabsByPermission,
  resolveAuthorizedTab,
  resolveUnauthorizedFallbackTab,
  resolveUiPermissionSnapshot,
  sanitizeCrossPortContextForPort,
} from "./port-permissions.ts";

describe("resolveUiPermissionSnapshot", () => {
  it("treats local sessions as unrestricted local operators", () => {
    const snapshot = resolveUiPermissionSnapshot({});

    expect(snapshot.role).toBe("local-operator");
    expect(snapshot.readablePorts).toEqual(
      expect.arrayContaining(["employee", "enterprise", "platform", "ops"]),
    );
  });

  it("limits enterprise members to employee and enterprise ports", () => {
    const snapshot = resolveUiPermissionSnapshot({
      bootstrapAuthMode: "trusted-proxy",
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "member@example.com",
        tenantId: "acme",
      },
      platformAuthState: {
        enabled: true,
        hasUsers: true,
        allowRegistration: false,
        membershipRole: "member",
      },
    });

    expect(snapshot.role).toBe("enterprise-member");
    expect(snapshot.readablePorts).toEqual(["employee", "enterprise"]);
    expect(snapshot.writablePorts).toEqual([]);
  });

  it("allows scoped operators to read platform, enterprise, and ops", () => {
    const snapshot = resolveUiPermissionSnapshot({
      bootstrapAuthMode: "trusted-proxy",
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "ops@example.com",
        role: "operator",
        scopes: ["operator.read"],
      },
    });

    expect(snapshot.role).toBe("operator");
    expect(snapshot.readablePorts).toEqual(
      expect.arrayContaining(["employee", "enterprise", "platform", "ops"]),
    );
  });
});

describe("tab and method authorization", () => {
  const enterpriseMember = {
    bootstrapAuthMode: "trusted-proxy" as const,
    bootstrapAuthSession: {
      provider: "trusted-proxy" as const,
      user: "member@example.com",
      tenantId: "acme",
    },
    platformAuthState: {
      enabled: true,
      hasUsers: true,
      allowRegistration: false,
      membershipRole: "member" as const,
    },
  };

  it("filters tabs to the readable port set", () => {
    expect(
      filterTabsByPermission(enterpriseMember, ["me", "enterpriseDashboard", "overview"]),
    ).toEqual(["me", "enterpriseDashboard"]);
    expect(canAccessTab(enterpriseMember, "overview")).toBe(false);
    expect(resolveAuthorizedTab(enterpriseMember, "overview")).toBe("me");
  });

  it("falls back to subdomain login surfaces instead of employee me", () => {
    expect(resolveUnauthorizedFallbackTab("admin.openbot.love")).toBe("platformLogin");
    expect(resolveUnauthorizedFallbackTab("biz.openbot.love")).toBe("enterpriseLogin");
    expect(resolveUnauthorizedFallbackTab("gw.openbot.love")).toBe("me");
    expect(resolveAuthorizedTab(enterpriseMember, "platformDashboard", "admin.openbot.love")).toBe(
      "platformLogin",
    );
    // Member can read enterprise tabs; unauthorized platform tab on biz → enterprise login.
    expect(resolveAuthorizedTab(enterpriseMember, "platformDashboard", "biz.openbot.love")).toBe(
      "enterpriseLogin",
    );
  });

  it("enforces method scopes for operator actions", () => {
    const readOnlyOperator = {
      bootstrapAuthMode: "trusted-proxy" as const,
      bootstrapAuthSession: {
        provider: "trusted-proxy" as const,
        user: "ops@example.com",
        role: "operator",
        scopes: ["operator.read"],
      },
    };

    expect(canExecuteGatewayMethod(readOnlyOperator, "sessions.list")).toBe(true);
    expect(canExecuteGatewayMethod(readOnlyOperator, "sessions.patch")).toBe(false);
    expect(canExecuteGatewayMethod(readOnlyOperator, "exec.approval.resolve")).toBe(false);
  });
});

describe("sanitizeCrossPortContextForPort", () => {
  it("keeps only the context keys that belong to the target port", () => {
    expect(
      sanitizeCrossPortContextForPort("platform", {
        tenantId: "acme",
        agentId: "agent-1",
        capabilityId: "cap-1",
        executionId: "exec-1",
        sourcePort: "platform",
        sourcePage: "catalog",
      }),
    ).toEqual({
      tenantId: "acme",
      agentId: "agent-1",
      capabilityId: "cap-1",
      sourcePort: "platform",
      sourcePage: "catalog",
    });
  });
});
