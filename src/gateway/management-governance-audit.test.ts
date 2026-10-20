import { describe, expect, it, vi } from "vitest";

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));
vi.mock("./access-control/audit-sink.js", () => ({ emitManagementGovernanceAudit: emitMock }));

import {
  auditManagementDecision,
  filterManagementAuditEvents,
} from "./management-governance-audit.js";

describe("management governance audit", () => {
  it("preserves platform super-administrator identity", async () => {
    emitMock.mockResolvedValue(undefined);
    await auditManagementDecision({
      client: {
        user: "root@example.com",
        sessionDomain: "platform",
        sessionKind: "platform-super-admin",
        connect: {} as never,
      },
      scope: { kind: "platform" },
      action: "approve",
      target: { kind: "user", resourceId: "admin@example.com" },
      effect: "allowed",
    });
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ role: "platform-super-admin" }) }),
    );
  });

  it("records an enterprise administrator decision without sensitive material", async () => {
    emitMock.mockResolvedValue(undefined);
    await auditManagementDecision({
      client: {
        user: "ADMIN@EXAMPLE.COM",
        sessionDomain: "enterprise",
        connect: {} as never,
      },
      scope: { kind: "tenant", tenantId: "tenant-a" },
      action: "invoke",
      target: { kind: "worker-agent", resourceId: "sales", tenantId: "tenant-a" },
      effect: "denied",
      reason: "outside-governance-scope",
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          role: "tenant-admin",
          subjectId: "admin@example.com",
          scope: "tenant",
        },
        action: "invoke",
        effect: "denied",
        reason: "outside-governance-scope",
      }),
    );
  });

  it("filters tenant and employee queries without trusting a requested tenant", () => {
    const events = [
      {
        ts: "2026-08-04T02:00:00.000Z",
        actor: { role: "tenant-admin" as const, subjectId: "a", scope: "tenant" as const },
        action: "invoke" as const,
        target: {
          kind: "worker-agent" as const,
          resourceId: "sales",
          tenantId: "tenant-a",
          ownerUserId: "user-a",
        },
        effect: "allowed" as const,
      },
      {
        ts: "2026-08-04T01:00:00.000Z",
        actor: { role: "tenant-admin" as const, subjectId: "b", scope: "tenant" as const },
        action: "invoke" as const,
        target: {
          kind: "worker-agent" as const,
          resourceId: "support",
          tenantId: "tenant-b",
          ownerUserId: "user-b",
        },
        effect: "denied" as const,
      },
    ];
    expect(
      filterManagementAuditEvents({ events, scope: { kind: "tenant", tenantId: "tenant-a" } }),
    ).toHaveLength(1);
    expect(
      filterManagementAuditEvents({ events, scope: { kind: "self", ownerId: "user-b" } })[0]?.target
        .resourceId,
    ).toBe("support");
  });
});
