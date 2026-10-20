import { describe, expect, it } from "vitest";
import { createDiagnosisDelegationMachine } from "../../diagnosis/delegation.js";
import type { TrustedTenantContext } from "../../diagnosis/types.js";
import {
  encodeEvolutionGrantPurpose,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
  resolveEvolutionGrantRequestTrusted,
} from "./evolution-grant.js";

const TENANT = "tenant-fixture-a";
const AGENT_ID = "wdna-grant-unit-bot";
const TRUSTED_ENTERPRISE: TrustedTenantContext = { tenantId: TENANT };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };

describe("requestEvolutionWorkingDnaGrant trusted context", () => {
  it("accepts platform issuer with enterprise client trusted context (platform_to_enterprise)", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-06T10:00:00.000Z"),
    });
    const issuer = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
      "platform",
    );
    const enterprise = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "ent-admin", kind: "user", tenantId: TENANT },
      "enterprise",
    );

    const { grantId, receipt } = requestEvolutionWorkingDnaGrant({
      machine,
      commandId: "cmd-platform-trusted-fix",
      trusted: TRUSTED_ENTERPRISE,
      issuer,
      approver: enterprise,
      grantee: enterprise,
      tenantId: TENANT,
      agentId: AGENT_ID,
      evidenceRefs: ["ev-platform-trusted"],
      expiresAt: "2027-09-07T00:00:00.000Z",
    });

    expect(receipt.status).toBe("REQUESTED");
    expect(grantId).toMatch(/^grant:/);
    const grant = machine.getGrant(grantId);
    expect(grant?.issuer.role).toBe("platform");
    expect(grant?.targetTenant).toBe(TENANT);
    expect(grant?.approver.role).toBe("enterprise");
  });

  it("never forwards enterprise-scoped trusted context for a platform issuer", () => {
    const issuer = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
      "platform",
    );

    expect(resolveEvolutionGrantRequestTrusted({ issuer, trusted: TRUSTED_ENTERPRISE })).toEqual({
      tenantId: null,
    });
    expect(resolveEvolutionGrantRequestTrusted({ issuer, trusted: TRUSTED_PLATFORM })).toEqual({
      tenantId: null,
    });
    const enterpriseIssuer = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "ent-admin", kind: "user", tenantId: TENANT },
      "enterprise",
    );
    expect(
      resolveEvolutionGrantRequestTrusted({
        issuer: enterpriseIssuer,
        trusted: TRUSTED_ENTERPRISE,
      }),
    ).toEqual(TRUSTED_ENTERPRISE);
  });

  it("allows raw platform_to_enterprise dispatch with platform trusted context", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-06T10:00:00.000Z"),
    });
    const issuer = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
      "platform",
    );
    const enterprise = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "ent-admin", kind: "user", tenantId: TENANT },
      "enterprise",
    );
    const metadata = {
      schemaVersion: 1 as const,
      grantVersion: 1 as const,
      tenantId: TENANT,
      agentId: AGENT_ID,
      surfaceId: "agent.working-dna" as const,
    };

    const receipt = machine.dispatch({
      commandId: "cmd-raw-platform-trusted",
      command: "request",
      trusted: TRUSTED_PLATFORM,
      actor: issuer,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
      targetTenant: TENANT,
      targetScope: {
        tenantId: TENANT,
        targetType: "agent",
        targetId: AGENT_ID,
      },
      allowedEvidence: ["ev-raw-platform"],
      allowedActions: ["diagnose"],
      purpose: encodeEvolutionGrantPurpose(metadata),
      expiresAt: "2027-09-07T00:00:00.000Z",
      canSubdelegate: false,
      oneShot: false,
    });

    expect(receipt.status).toBe("REQUESTED");
    expect(receipt.grantId).toMatch(/^grant:/);
  });
});
