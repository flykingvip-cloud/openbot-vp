import type { EvolutionSurface } from "./contracts.js";

export const FORBIDDEN_SURFACE_IDS = [
  "system.model-weights",
  "system.production-cutover",
  "system.core-identity",
  "system.security-authorization",
  "system.secrets",
] as const;

const SURFACES: readonly EvolutionSurface[] = [
  {
    surfaceId: "agent.working-dna",
    domain: "agent",
    sourceOfTruth: "src/gateway/agent-growth/working-style-store.ts",
    authorityRole: "enterprise",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "medium",
    experimentStrategy: "ab",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "working-dna",
    rollbackStrategy: "restore-previous-values",
    autoApply: false,
    requiresExternalEffectVerification: true,
    externalEffectKind: "working-style-field",
    requiredVerifierId: "working-dna-read-after-write",
    externalVerificationPolicy: "required",
  },
  {
    surfaceId: "knowledge.experience-capsule",
    domain: "knowledge",
    sourceOfTruth: "src/gateway/collaboration-learning/capsule-governance.ts",
    authorityRole: "enterprise",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "low",
    experimentStrategy: "offline",
    requiredApprovals: ["grant", "content-review", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "capsule",
    rollbackStrategy: "unproject-capsule",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "knowledge.managed-memory",
    domain: "knowledge",
    sourceOfTruth: "src/gateway/collaboration-learning",
    authorityRole: "enterprise",
    allowedOperations: ["inspect", "suggest", "experiment", "observe", "hold", "reject", "expire"],
    riskLevel: "high",
    experimentStrategy: "shadow",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "managed-memory",
    rollbackStrategy: "drop-projection",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "capability.skill-spec",
    domain: "capability",
    sourceOfTruth: "src/gateway/skill-lifecycle-store.ts",
    authorityRole: "enterprise",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "medium",
    experimentStrategy: "offline",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "skill_success_rate"],
    adapterId: "skill",
    rollbackStrategy: "restore-skill-version",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "capability.skill-installation",
    domain: "capability",
    sourceOfTruth: "src/gateway/skill-lifecycle-store.ts",
    authorityRole: "enterprise",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "high",
    experimentStrategy: "canary",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "skill-installation",
    rollbackStrategy: "restore-installation",
    autoApply: false,
    requiresExternalEffectVerification: true,
    externalEffectKind: "skill-installation",
    requiredVerifierId: "skill-installation-read-after-write",
    externalVerificationPolicy: "required",
  },
  {
    surfaceId: "organization.task-routing",
    domain: "organization",
    sourceOfTruth: "src/organization/routing-policy.ts",
    authorityRole: "enterprise",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "high",
    experimentStrategy: "shadow",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "organization",
    rollbackStrategy: "restore-routing-policy",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "organization.team-composition",
    domain: "organization",
    sourceOfTruth: "src/organization",
    authorityRole: "enterprise",
    allowedOperations: ["inspect", "suggest", "experiment", "observe", "hold", "reject", "expire"],
    riskLevel: "high",
    experimentStrategy: "shadow",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "organization",
    rollbackStrategy: "restore-composition-policy",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "system.diagnosis-contract",
    domain: "system",
    sourceOfTruth: "src/diagnosis",
    authorityRole: "platform",
    allowedOperations: ["inspect", "suggest", "experiment", "observe", "hold", "reject", "expire"],
    riskLevel: "medium",
    experimentStrategy: "offline",
    requiredApprovals: ["grant", "experiment"],
    requiredRegressionLocks: ["security_violations"],
    adapterId: "diagnosis-contract",
    rollbackStrategy: "restore-contract-revision",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
  {
    surfaceId: "system.runtime-binding-governance",
    domain: "system",
    sourceOfTruth: "src/gateway/evolution-governance",
    authorityRole: "platform",
    allowedOperations: [
      "inspect",
      "suggest",
      "experiment",
      "apply",
      "verify",
      "promote",
      "rollback",
      "observe",
      "hold",
      "reject",
      "expire",
    ],
    riskLevel: "critical",
    experimentStrategy: "canary",
    requiredApprovals: ["grant", "experiment", "platform"],
    requiredRegressionLocks: ["security_violations", "cross_tenant_contamination"],
    adapterId: "runtime-governance",
    rollbackStrategy: "compare-and-restore",
    autoApply: false,
    externalVerificationPolicy: "unsupported",
  },
];

const BY_ID = new Map(SURFACES.map((row) => [row.surfaceId, row]));

export function listEvolutionSurfaces(): readonly EvolutionSurface[] {
  return SURFACES;
}

export function getEvolutionSurface(surfaceId: string): EvolutionSurface | null {
  if ((FORBIDDEN_SURFACE_IDS as readonly string[]).includes(surfaceId)) {
    return null;
  }
  return BY_ID.get(surfaceId) ?? null;
}

export function requireEvolutionSurface(surfaceId: string): EvolutionSurface {
  const surface = getEvolutionSurface(surfaceId);
  if (!surface) {
    throw new Error(`unknown or forbidden surface: ${surfaceId}`);
  }
  return surface;
}

export function isForbiddenSurfaceId(surfaceId: string): boolean {
  return (FORBIDDEN_SURFACE_IDS as readonly string[]).includes(surfaceId);
}

export function requiredVerifierIdForSurface(surfaceId: string): string | undefined {
  const surface = getEvolutionSurface(surfaceId);
  if (!surface || surface.externalVerificationPolicy !== "required") {
    return undefined;
  }
  return surface.requiredVerifierId;
}
