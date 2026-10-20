import { describe, expect, it } from "vitest";
import { canAutoApplySurface } from "./autonomy.js";
import { classifyGrantActivity, evaluateAuthorityGate } from "./contracts.js";
import { FORBIDDEN_SURFACE_IDS, getEvolutionSurface, listEvolutionSurfaces } from "./surfaces.js";

describe("surface registry", () => {
  it("registers the first nine surfaces and never auto-applies", () => {
    const surfaces = listEvolutionSurfaces();
    expect(surfaces).toHaveLength(9);
    expect(new Set(surfaces.map((row) => row.surfaceId)).size).toBe(9);
    for (const surface of surfaces) {
      expect(surface.autoApply).toBe(false);
      expect(canAutoApplySurface(surface)).toBe(false);
      if (surface.allowedOperations.includes("experiment")) {
        expect(surface.allowedOperations).toContain("hold");
      }
    }
  });

  it("maps required verifiers and keeps other surfaces unsupported", () => {
    const dna = getEvolutionSurface("agent.working-dna");
    const install = getEvolutionSurface("capability.skill-installation");
    expect(dna?.requiredVerifierId).toBe("working-dna-read-after-write");
    expect(install?.requiredVerifierId).toBe("skill-installation-read-after-write");
    expect(dna?.requiredVerifierId).not.toBe(install?.requiredVerifierId);
    const registry: Array<{ surfaceId: string; verifier: string | null; status: string }> = [
      {
        surfaceId: "agent.working-dna",
        verifier: "working-dna-read-after-write",
        status: "supported",
      },
      {
        surfaceId: "capability.skill-installation",
        verifier: "skill-installation-read-after-write",
        status: "supported",
      },
      { surfaceId: "capability.skill-spec", verifier: null, status: "fail-closed" },
      { surfaceId: "knowledge.experience-capsule", verifier: null, status: "fail-closed" },
      { surfaceId: "knowledge.managed-memory", verifier: null, status: "fail-closed" },
      { surfaceId: "organization.task-routing", verifier: null, status: "fail-closed" },
      { surfaceId: "organization.team-composition", verifier: null, status: "fail-closed" },
      { surfaceId: "system.diagnosis-contract", verifier: null, status: "fail-closed" },
      { surfaceId: "system.runtime-binding-governance", verifier: null, status: "fail-closed" },
    ];
    for (const row of registry) {
      const surface = getEvolutionSurface(row.surfaceId);
      expect(surface).not.toBeNull();
      if (row.status === "supported") {
        expect(surface?.externalVerificationPolicy).toBe("required");
        expect(surface?.requiredVerifierId).toBe(row.verifier);
        expect(surface?.requiresExternalEffectVerification).toBe(true);
      } else {
        expect(surface?.externalVerificationPolicy).toBe("unsupported");
        expect(surface?.requiredVerifierId).toBeUndefined();
      }
    }
  });

  it("fails closed for unknown and forbidden surfaces", () => {
    expect(getEvolutionSurface("agent.unknown")).toBeNull();
    for (const id of FORBIDDEN_SURFACE_IDS) {
      expect(getEvolutionSurface(id)).toBeNull();
    }
  });

  it("keeps runtime apply gated by platform approval and critical risk", () => {
    const surface = getEvolutionSurface("system.runtime-binding-governance");
    expect(surface?.riskLevel).toBe("critical");
    expect(surface?.autoApply).toBe(false);
    expect(surface?.allowedOperations).toContain("apply");
    expect(surface?.requiredApprovals).toContain("platform");
    const grant = {
      grantId: "g1",
      status: "APPROVED" as const,
      tenantScope: "tenant-a",
      allowedEvidence: ["ev-a"],
      allowedActions: ["suggest", "experiment", "apply", "verify", "promote"],
      confidentialityCeiling: "enterprise" as const,
    };
    expect(
      evaluateAuthorityGate({
        surface,
        grant,
        tenantScope: "tenant-a",
        trustedTenantId: "tenant-a",
        requestedAction: "apply",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: false,
      }),
    ).toMatchObject({ ok: false, code: "platform_approval_required" });
    expect(
      evaluateAuthorityGate({
        surface,
        grant: { ...grant, allowedActions: [...grant.allowedActions, "platform"] },
        tenantScope: "tenant-a",
        trustedTenantId: "tenant-a",
        requestedAction: "apply",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: false,
      }).ok,
    ).toBe(true);
  });

  it("rejects expired, cross-tenant, and scope-expanding grants", () => {
    const surface = getEvolutionSurface("agent.working-dna");
    expect(surface).not.toBeNull();
    const baseGrant = {
      grantId: "g1",
      status: "APPROVED" as const,
      tenantScope: "tenant-a",
      allowedEvidence: ["ev-a"],
      allowedActions: ["suggest", "experiment"],
      confidentialityCeiling: "enterprise" as const,
    };
    expect(
      evaluateAuthorityGate({
        surface,
        grant: { status: "missing" },
        tenantScope: "tenant-a",
        trustedTenantId: "tenant-a",
        requestedAction: "suggest",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: false,
      }).ok,
    ).toBe(false);
    for (const status of ["EXPIRED", "REVOKED", "CONSUMED", "SUSPENDED", "REQUESTED", "DENIED"]) {
      expect(classifyGrantActivity({ ...baseGrant, status }).active).toBe(false);
    }
    expect(classifyGrantActivity(baseGrant).active).toBe(true);
    expect(
      evaluateAuthorityGate({
        surface,
        grant: { ...baseGrant, expired: true, status: "EXPIRED" },
        tenantScope: "tenant-a",
        trustedTenantId: "tenant-a",
        requestedAction: "suggest",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: false,
      }).ok,
    ).toBe(false);
    expect(
      evaluateAuthorityGate({
        surface,
        grant: baseGrant,
        tenantScope: "tenant-b",
        trustedTenantId: "tenant-a",
        requestedAction: "suggest",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: false,
      }).ok,
    ).toBe(false);
    expect(
      evaluateAuthorityGate({
        surface,
        grant: baseGrant,
        tenantScope: "tenant-a",
        trustedTenantId: "tenant-a",
        requestedAction: "suggest",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
        expandScope: true,
      }).ok,
    ).toBe(false);
  });
});
