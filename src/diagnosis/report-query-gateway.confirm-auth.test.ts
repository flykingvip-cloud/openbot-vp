import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import {
  createMemoryDelegationStore,
  createDiagnosisDelegationMachine,
  type AuthorizationGrant,
  type DelegationActor,
} from "./delegation.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  prescriptionGrantViewFromAuthorization,
} from "./diagnose-self-evolution.js";
import {
  createDefaultDiagnosisReportApiDeps,
  createDiagnosisReportGatewayHandlers,
  type DiagnosisGatewayAuthClient,
} from "./report-query-gateway.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "diag-confirm-auth-"));
  tempDirs.push(dir);
  return dir;
}

function actor(id: string, tenantId: string): DelegationActor {
  return {
    role: "enterprise",
    principal: { schemaVersion: 1, principalId: id, kind: "user", tenantId },
  };
}

function grant(
  over: Partial<AuthorizationGrant> & Pick<AuthorizationGrant, "grantId">,
): AuthorizationGrant {
  const issuer = actor("ent-admin", TENANT_A);
  return {
    schemaVersion: 1,
    kind: "authorization",
    issuer,
    approver: issuer,
    grantee: actor("admin-1", TENANT_A),
    sourceTenant: TENANT_A,
    targetTenant: TENANT_A,
    targetPrincipal: "employee-9",
    targetScope: { tenantId: TENANT_A, targetType: "agent", targetId: "bot-2" },
    allowedEvidence: [],
    allowedActions: ["schedule_diagnosis_prescription"],
    purpose: "schedule_diagnosis_prescription",
    canSubdelegate: false,
    expiresAt: "2027-01-01T00:00:00.000Z",
    oneShot: false,
    status: "APPROVED",
    auditReceipt: `aud:${over.grantId}`,
    ...over,
  };
}

function gapAssessment(): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: TENANT_A,
    agentAssetId: "asset-bot-2",
    targetOwnerId: "employee-9",
    groupId: null,
    objectLabel: "bot-2",
    displayName: null,
    identity: {
      readable: true,
      bootstrapPending: true,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: false, fresh: false },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

function clientFor(userId: string, _tenantId = TENANT_A): DiagnosisGatewayAuthClient {
  return {
    user: `${userId}@example.com`,
    platformUserId: userId,
    sessionDomain: "enterprise",
    sessionKind: "member",
  };
}

async function invokeConfirm(input: {
  userId: string;
  tenantId?: string;
  configDir: string;
  inspectGrant: (grantId: string) => ReturnType<typeof prescriptionGrantViewFromAuthorization>;
  params: Record<string, unknown>;
}) {
  const created: unknown[] = [];
  const handlers = createDiagnosisReportGatewayHandlers(
    createDefaultDiagnosisReportApiDeps(),
    {
      resolveMembership: async () => ({
        tenantId: input.tenantId ?? TENANT_A,
        userId: input.userId,
      }),
    },
    {
      configDir: input.configDir,
      inspectGrant: input.inspectGrant,
      confirmEnabled: true,
    },
  );
  const handler = handlers["diagnosis.self-evolution.confirm"] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error("missing confirm handler");
  }
  let captured:
    | { ok: boolean; payload?: { ok?: boolean; reason?: string }; error?: { code: string } }
    | undefined;
  await handler({
    req: { type: "req", id: "test", method: "diagnosis.self-evolution.confirm" } as never,
    params: input.params,
    client: clientFor(input.userId, input.tenantId) as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = {
        ok,
        payload: payload as { ok?: boolean; reason?: string },
        ...(error ? { error: { code: error.code } } : {}),
      };
    },
    context: {
      cron: {
        add: async (job: unknown) => {
          created.push(job);
          return { id: `job-${created.length}` };
        },
        list: async () => [],
      },
    } as never,
  });
  return { captured, created };
}

describe("gateway diagnosis confirm grant wiring", () => {
  it("lets the owner confirm without a grant and ignores spoofed grant params", async () => {
    const configDir = tempDir();
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ store });
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-owner",
      confirmable: true,
      configDir,
    });
    const result = await invokeConfirm({
      userId: "employee-9",
      configDir,
      inspectGrant: (grantId) => prescriptionGrantViewFromAuthorization(machine.getGrant(grantId)),
      params: {
        prescriptionId: identity.prescriptionId,
        professionalReportId: "pdr-owner",
        prescriptionContentHash: identity.prescriptionContentHash,
        grant: {
          status: "DENIED",
          tenantId: TENANT_B,
          allowedActions: ["schedule_diagnosis_prescription"],
        },
      },
    });
    expect(result.captured?.ok).toBe(true);
    expect(result.captured?.payload).toMatchObject({ ok: true });
    expect(result.created).toHaveLength(1);
  });

  it("lets a legal proxy confirm only after reading the full Delegation Machine grant", async () => {
    const configDir = tempDir();
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ store });
    store.putGrant(grant({ grantId: "grant-prescription" }));
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-proxy",
      confirmable: true,
      authorizationRef: "grant-prescription",
      configDir,
    });
    expect(machine.inspectGrant("grant-prescription")).toEqual({ status: "APPROVED" });
    const mapped = prescriptionGrantViewFromAuthorization(machine.getGrant("grant-prescription"));
    expect(mapped.targetPrincipal).toBe("employee-9");
    expect(mapped.targetAgent).toBe("bot-2");
    const result = await invokeConfirm({
      userId: "admin-1",
      configDir,
      inspectGrant: (grantId) => prescriptionGrantViewFromAuthorization(machine.getGrant(grantId)),
      params: {
        prescriptionId: identity.prescriptionId,
        professionalReportId: "pdr-proxy",
        prescriptionContentHash: identity.prescriptionContentHash,
      },
    });
    expect(result.captured?.payload).toMatchObject({ ok: true });
    expect(result.created).toHaveLength(1);
  });

  it("rejects an admin without a grant even when params carry an APPROVED grant", async () => {
    const configDir = tempDir();
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ store });
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-admin",
      confirmable: true,
      authorizationRef: "grant-missing",
      configDir,
    });
    const result = await invokeConfirm({
      userId: "admin-1",
      configDir,
      inspectGrant: (grantId) => prescriptionGrantViewFromAuthorization(machine.getGrant(grantId)),
      params: {
        prescriptionId: identity.prescriptionId,
        professionalReportId: "pdr-admin",
        grant: {
          status: "APPROVED",
          tenantId: TENANT_A,
          targetPrincipal: "employee-9",
          targetAgent: "bot-2",
          allowedActions: ["schedule_diagnosis_prescription"],
        },
      },
    });
    expect(result.captured?.payload).toMatchObject({
      ok: false,
      reason: "authorization_required",
    });
    expect(result.created).toEqual([]);
  });

  it("rejects a Working DNA evolution-grant from the Delegation Machine", async () => {
    const configDir = tempDir();
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ store });
    store.putGrant(
      grant({
        grantId: "grant-wdna",
        purpose: `evolution-grant:${JSON.stringify({
          schemaVersion: 1,
          grantVersion: 1,
          tenantId: TENANT_A,
          agentId: "bot-2",
          surfaceId: "agent.working-dna",
        })}`,
        allowedActions: ["diagnose", "suggest", "apply"],
      }),
    );
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-wdna",
      confirmable: true,
      authorizationRef: "grant-wdna",
      configDir,
    });
    const result = await invokeConfirm({
      userId: "admin-1",
      configDir,
      inspectGrant: (grantId) => prescriptionGrantViewFromAuthorization(machine.getGrant(grantId)),
      params: {
        prescriptionId: identity.prescriptionId,
        professionalReportId: "pdr-wdna",
      },
    });
    expect(result.captured?.payload).toMatchObject({
      ok: false,
      reason: "wdna_grant_forbidden",
    });
    expect(result.created).toEqual([]);
  });

  it("rejects a cross-tenant confirm against another tenant store", async () => {
    const configDir = tempDir();
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ store });
    store.putGrant(grant({ grantId: "grant-prescription" }));
    const [identity] = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-cross",
      confirmable: true,
      authorizationRef: "grant-prescription",
      configDir,
    });
    const result = await invokeConfirm({
      userId: "admin-1",
      tenantId: TENANT_B,
      configDir,
      inspectGrant: (grantId) => prescriptionGrantViewFromAuthorization(machine.getGrant(grantId)),
      params: {
        prescriptionId: identity.prescriptionId,
        professionalReportId: "pdr-cross",
      },
    });
    expect(result.captured?.payload).toMatchObject({
      ok: false,
      reason: "prescription_gone",
    });
    expect(result.created).toEqual([]);
  });
});
