import { describe, expect, it } from "vitest";
import {
  governanceRoleForSession,
  isGovernanceActionAllowed,
  type GovernanceAction,
  type GovernanceResource,
  type GovernanceSubject,
} from "./governance-policy.js";

describe("governance policy", () => {
  const device = { kind: "device" as const, tenantId: "t1", ownerUserId: "u1", deviceId: "d1" };

  it("maps platform, tenant, and employee supervisor identities", () => {
    expect(governanceRoleForSession({ platformRole: "super-admin" })).toBe("platform-super-admin");
    expect(governanceRoleForSession({ platformRole: "admin" })).toBe("platform-admin");
    expect(governanceRoleForSession({ membershipRole: "enterprise-admin" })).toBe("tenant-admin");
    expect(governanceRoleForSession({ membershipRole: "member", isSupervisor: true })).toBe(
      "employee-supervisor",
    );
    expect(governanceRoleForSession({ membershipRole: "member" })).toBe("worker-agent");
  });

  it("keeps tenant admins inside their tenant", () => {
    const subject = { role: "tenant-admin" as const, tenantId: "t1" };
    expect(isGovernanceActionAllowed(subject, "invoke", device)).toBe(true);
    expect(isGovernanceActionAllowed(subject, "invoke", { ...device, tenantId: "t2" })).toBe(false);
    expect(isGovernanceActionAllowed(subject, "pair", device)).toBe(true);
    expect(isGovernanceActionAllowed(subject, "approve", device)).toBe(false);
  });

  it("gives employee supervisors control of their own agent estate only", () => {
    const subject = { role: "employee-supervisor" as const, userId: "u1" };
    expect(isGovernanceActionAllowed(subject, "invoke", device)).toBe(true);
    expect(isGovernanceActionAllowed(subject, "write", { ...device, ownerUserId: "u2" })).toBe(
      false,
    );
    expect(isGovernanceActionAllowed(subject, "approve", device)).toBe(false);
    expect(isGovernanceActionAllowed(subject, "revoke", device)).toBe(false);
  });

  it("does not let worker agents administer siblings", () => {
    const subject = { role: "worker-agent" as const, agentId: "a1" };
    expect(
      isGovernanceActionAllowed(subject, "read", { kind: "worker-agent", agentId: "a1" }),
    ).toBe(true);
    expect(
      isGovernanceActionAllowed(subject, "invoke", { kind: "worker-agent", agentId: "a2" }),
    ).toBe(false);
  });

  it("enforces the complete administrator and steward authority matrix", () => {
    const actions: GovernanceAction[] = [
      "observe",
      "read",
      "write",
      "invoke",
      "pair",
      "revoke",
      "approve",
    ];
    const ownDevice: GovernanceResource = {
      kind: "device",
      tenantId: "t1",
      ownerUserId: "u1",
      deviceId: "d1",
    };
    const ownWorker: GovernanceResource = {
      kind: "worker-agent",
      tenantId: "t1",
      ownerUserId: "u1",
      agentId: "a1",
    };
    const otherTenantDevice: GovernanceResource = {
      ...ownDevice,
      tenantId: "t2",
      ownerUserId: "u2",
      deviceId: "d2",
    };
    const platformResource: GovernanceResource = { kind: "platform" };
    const cases: Array<{
      subject: GovernanceSubject;
      resource: GovernanceResource;
      allowed: GovernanceAction[];
    }> = [
      {
        subject: { role: "platform-super-admin" },
        resource: platformResource,
        allowed: actions,
      },
      {
        subject: { role: "platform-admin" },
        resource: otherTenantDevice,
        allowed: actions,
      },
      {
        subject: { role: "platform-admin" },
        resource: platformResource,
        allowed: [],
      },
      {
        subject: { role: "tenant-admin", tenantId: "t1" },
        resource: ownDevice,
        allowed: actions.filter((action) => action !== "approve"),
      },
      {
        subject: { role: "tenant-admin", tenantId: "t1" },
        resource: otherTenantDevice,
        allowed: [],
      },
      {
        subject: { role: "employee-supervisor", userId: "u1" },
        resource: ownWorker,
        allowed: ["observe", "read", "write", "invoke"],
      },
      {
        subject: { role: "employee-supervisor", userId: "u1" },
        resource: otherTenantDevice,
        allowed: [],
      },
      {
        subject: { role: "worker-agent", agentId: "a1" },
        resource: ownWorker,
        allowed: ["observe", "read"],
      },
    ];

    for (const testCase of cases) {
      for (const action of actions) {
        expect(
          isGovernanceActionAllowed(testCase.subject, action, testCase.resource),
          `${testCase.subject.role} ${action} ${testCase.resource.kind}`,
        ).toBe(testCase.allowed.includes(action));
      }
    }
  });
});
