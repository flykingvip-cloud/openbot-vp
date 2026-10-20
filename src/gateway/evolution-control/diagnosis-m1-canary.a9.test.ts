import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyA9M1Event,
  isE52CutoverReceipt,
  type DiagnosisIngestWalRecord,
} from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createDiagnosisDelegationMachine } from "../../diagnosis/delegation.js";
import { executeParsedDiagnoseRequest } from "../../diagnosis/diagnose-live-request.js";
import { parseDiagnoseRequest } from "../../diagnosis/diagnose-policy.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "../../diagnosis/diagnose-professional-protocol.js";
import { createDelegationEvolutionInspector } from "../../diagnosis/evolution-proposal.js";
import type { StructuralEvolutionCandidate } from "../../diagnosis/structural-evolution-candidate.js";
import { readEvolutionTaskOutcomes } from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import {
  readRobotWorkingStyleOrDefault,
  updateRobotWorkingStyle,
} from "../agent-growth/working-style-store.js";
import {
  createEvolutionControlHandlers,
  setEvolutionControlPlaneForTests,
} from "../server-methods/evolution-control.js";
import type { GatewayClient, GatewayRequestHandler } from "../server-methods/types.js";
import { startGatewayServer } from "../server.js";
import { recordSkillInvocationCompleted } from "../skill-invocation/record.js";
import { connectGatewayClient, getFreeGatewayPort } from "../test-helpers.e2e.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import {
  setEvolutionApplyAuthPortsForTests,
  type EvolutionApplyAuthPorts,
} from "./apply-authorization.js";
import {
  confirmDiagnosisCandidatePreview,
  diagnosisGrantViewFromAuthorization,
} from "./confirm-diagnosis-candidate.js";
import { createEvolutionControlPlane, type EvolutionControlPlane } from "./control-plane.js";
import { recommendDiagnosisApplyFollowUp } from "./diagnosis-apply-gate.js";
import {
  loadDiagnosisRecheckReceipt,
  persistDiagnosisRecheckReceipt,
  hydrateDiagnosisM1Receipts,
  setDiagnosisReceiptBuildInfoForTests,
  resetDiagnosisM1ReceiptsForTests,
} from "./diagnosis-m1-status.js";
import {
  createLiveDiagnosisRecheckPort,
  expectationFromControlPlane,
} from "./diagnosis-recheck-observer.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "./evolution-grant.js";
import { createAdapterObservationProvider } from "./observation.js";
import { setDiagnosisCandidateStatusPortsForTests } from "./project-diagnosis-candidate.js";
import { setEvolutionRpcTestIdentityForTests } from "./rpc-test-identity.js";
import {
  createControlPlaneDiagnosisSubmitPorts,
  defaultSnapshotReader,
  workingDnaBaselineHash,
} from "./submit-diagnosis-candidate.js";
import { withWorkingDnaExternal } from "./test-support.js";

const TENANT = "001";
const AGENT = "a8-m1-isolated";
const ADMIN_USER_ID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
const MEMBERSHIP_ID = "e4c8478b-e34e-4398-b093-326a162140bf";
const SAMPLE_SIZE = 20;
const dirs: string[] = [];

afterEach(() => {
  setEvolutionApplyAuthPortsForTests();
  setEvolutionControlPlaneForTests(undefined);
  setEvolutionRpcTestIdentityForTests(undefined);
  setDiagnosisCandidateStatusPortsForTests(undefined);
  resetDiagnosisM1ReceiptsForTests();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type EvolutionRpc = (
  method: string,
  params: Record<string, unknown>,
) => Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}>;

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "a9-m1-"));
  dirs.push(dir);
  return dir;
}

function cfgFor(agentDir: string): OpenBotConfig {
  return { agents: { list: [{ id: AGENT, agentDir }] } } as unknown as OpenBotConfig;
}

function fingerprint(root: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of ["proposals.json", "applications.json", "ledger.jsonl"]) {
    const file = path.join(root, name);
    try {
      out[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
    } catch {
      out[name] = null;
    }
  }
  return out;
}

function operatorClient(): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "ctrl",
        displayName: "ctrl",
        version: "1",
        platform: "web",
        mode: "webchat",
      },
      scopes: ["operator.approvals"],
    },
    user: ADMIN_USER_ID,
    platformUserId: ADMIN_USER_ID,
    sessionKind: "enterprise-admin",
    sessionMembershipId: MEMBERSHIP_ID,
    sessionEnterpriseId: TENANT,
  };
}

function authPorts(): EvolutionApplyAuthPorts {
  return {
    async resolveActor(client) {
      if (
        client.sessionKind !== "enterprise-admin" ||
        client.platformUserId !== ADMIN_USER_ID ||
        client.sessionMembershipId !== MEMBERSHIP_ID ||
        client.sessionEnterpriseId !== TENANT
      ) {
        return null;
      }
      return {
        sessionKind: "enterprise-admin",
        membershipRole: "enterprise-admin",
        tenantId: TENANT,
        userId: ADMIN_USER_ID,
      };
    },
    async resolveObject(proposal) {
      if (proposal.tenantScope !== TENANT || proposal.target.domain !== "agent") {
        return null;
      }
      if (proposal.target.agentId !== AGENT) {
        return null;
      }
      return {
        tenantId: TENANT,
        targetId: `agent:${AGENT}`,
        objectKind: "enterprise",
        ownerUserId: null,
      };
    },
    async resolveGrant() {
      return null;
    },
  };
}

function invoke(handler: GatewayRequestHandler, params: Record<string, unknown>) {
  return new Promise<{
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  }>((resolve) => {
    void handler({
      req: { id: "1", method: "test", type: "req" },
      params,
      client: operatorClient(),
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({
          ok,
          ...(payload && typeof payload === "object"
            ? { payload: payload as Record<string, unknown> }
            : {}),
          ...(error ? { error: error as { message?: string } } : {}),
        });
      },
      context: {} as never,
    });
  });
}

async function seedPreview(root: string, nowMs: number) {
  const agentDir = path.join(root, "agent");
  const skillDir = path.join(root, "skill");
  const bindDir = path.join(root, "outcome-bind");
  mkdirSync(agentDir, { recursive: true });
  const cfg = cfgFor(agentDir);
  await updateRobotWorkingStyle(cfg, AGENT, () => ({ ...DEFAULT_WORKING_STYLE }));
  const sessionKey = `agent:${AGENT}:main`;
  writeFileSync(
    path.join(root, "sessions.json"),
    `${JSON.stringify({
      [sessionKey]: {
        sessionId: "sess-a8-isolated",
        updatedAt: nowMs - 1_000,
        sessionFile: path.join(agentDir, "transcript.jsonl"),
      },
    })}\n`,
  );
  const runId = "run-a8-isolated";
  recordSkillInvocationCompleted(
    {
      invocationId: "inv-a8-isolated",
      skillId: "briefing",
      agentId: AGENT,
      tenantId: TENANT,
      outcome: "success",
      startedAt: nowMs - 2_000,
      completedAt: nowMs - 1_000,
      runId,
      taskId: runId,
      sessionKey,
    },
    { configDir: skillDir, persistDir: bindDir },
  );
  await recordRunOutcome(cfg, AGENT, {
    success: true,
    runId,
    tenantId: TENANT,
    latencyMs: 40,
    toolsTotal: 0,
    humanTakeover: false,
    securityViolation: false,
    crossTenantContamination: false,
    occurredAt: nowMs - 1_000,
    evolutionPersistDir: bindDir,
  });
  return { cfg, skillDir, sessionStorePath: path.join(root, "sessions.json") };
}

function previewCandidate(skillDir: string): StructuralEvolutionCandidate {
  const root = path.join(skillDir, "diagnosis-evolution-previews");
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (name.endsWith(".json")) {
        files.push(full);
      }
    }
  };
  visit(root);
  const parsed = JSON.parse(readFileSync(files[0] ?? "", "utf8")) as {
    candidate: StructuralEvolutionCandidate;
  };
  return parsed.candidate;
}

async function recordCohort(
  cfg: OpenBotConfig,
  persistDir: string,
  input: { count: number; succeeded: boolean; prefix: string; occurredAt: number },
) {
  for (let index = 0; index < input.count; index += 1) {
    await recordRunOutcome(cfg, AGENT, {
      success: input.succeeded,
      runId: `${input.prefix}-${index}`,
      tenantId: TENANT,
      latencyMs: 40,
      toolsTotal: 0,
      humanTakeover: false,
      securityViolation: false,
      crossTenantContamination: false,
      occurredAt: input.occurredAt,
      evolutionPersistDir: persistDir,
    });
  }
}

async function prepare(input: { baselineSucceeded: boolean; rpc?: EvolutionRpc }) {
  const nowMs = Date.now();
  const liveRoot = path.join(process.env.HOME ?? "", ".openbot/evolution-control");
  const liveBefore = fingerprint(liveRoot);
  const root = tempDir();
  const seeded = await seedPreview(root, nowMs);
  await recordCohort(seeded.cfg, path.join(root, "outcome-bind"), {
    count: SAMPLE_SIZE,
    succeeded: input.baselineSucceeded,
    prefix: "run-baseline",
    occurredAt: nowMs - 2 * 24 * 60 * 60 * 1000,
  });
  const diagnosed = await executeParsedDiagnoseRequest({
    request: parseDiagnoseRequest({
      agentId: AGENT,
      sessionKey: `agent:${AGENT}:main`,
      window: "24h",
      mode: "TARGETED",
    }),
    trusted: { tenantId: TENANT },
    requestedBy: {
      schemaVersion: 1,
      principalId: ADMIN_USER_ID,
      kind: "user",
      tenantId: TENANT,
    },
    skillConfigDir: seeded.skillDir,
    now: nowMs,
    allowConversationDelivery: false,
    allowSelfEvolutionConfirm: false,
    structuralPreview: { cfg: seeded.cfg, sessionStorePath: seeded.sessionStorePath },
  });
  const candidate = diagnosed.professionalReport?.producer.structuralCandidates?.[0];
  expect(candidate?.proposedChange).toEqual({ field: "reportingCadence", value: "milestone" });
  const stored = previewCandidate(seeded.skillDir);
  const persistDir = path.join(root, "control");
  const machine = createDiagnosisDelegationMachine({ now: () => nowMs });
  const enterprise = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: ADMIN_USER_ID, kind: "user", tenantId: TENANT },
    "enterprise",
  );
  const issuer = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
    "platform",
  );
  const { grantId } = requestEvolutionWorkingDnaGrant({
    machine,
    commandId: `cmd-a9-grant-${input.baselineSucceeded ? "up" : "down"}`,
    trusted: { tenantId: TENANT },
    issuer,
    approver: enterprise,
    grantee: enterprise,
    tenantId: TENANT,
    agentId: AGENT,
    evidenceRefs: stored.evidenceRefs,
    expiresAt: "2027-12-31T00:00:00.000Z",
  });
  approveEvolutionGrant({
    machine,
    commandId: `cmd-a9-grant-approve-${input.baselineSucceeded ? "up" : "down"}`,
    trusted: { tenantId: TENANT },
    approver: enterprise,
    grantId,
  });
  const adapter = createWorkingDnaAdapter(seeded.cfg, {
    persistDir: path.join(persistDir, "adapters"),
  });
  let plane!: EvolutionControlPlane;
  plane = createEvolutionControlPlane({
    inspector: createDelegationEvolutionInspector(machine),
    workingDnaAdapter: adapter,
    persistDir,
    ...withWorkingDnaExternal(seeded.cfg),
    observationProvider: createAdapterObservationProvider({
      persistDir,
      resolveAdapter: () => adapter,
    }),
    diagnosisRecheckPort: createLiveDiagnosisRecheckPort({
      cfg: seeded.cfg,
      resolveExpectation: (request) => expectationFromControlPlane(plane, request),
    }),
  });
  const walFile = path.join(persistDir, "diagnosis-ingest-wal.json");
  const confirmed = await confirmDiagnosisCandidatePreview({
    commandId: `cmd-a9-confirm-${input.baselineSucceeded ? "up" : "down"}`,
    grantId,
    candidateVersion: stored.candidateVersion,
    tenantId: TENANT,
    principalRef: ADMIN_USER_ID,
    confirmedByUser: true,
    configDir: seeded.skillDir,
    nowMs,
    deps: {
      ports: createControlPlaneDiagnosisSubmitPorts(plane, walFile),
      inspectGrant: (id) => diagnosisGrantViewFromAuthorization(machine.getGrant(id), nowMs),
      readSnapshot: defaultSnapshotReader(seeded.skillDir, nowMs),
      readBaseline: () => ({
        style: DEFAULT_WORKING_STYLE,
        hash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      }),
      now: () => new Date(nowMs).toISOString(),
    },
  });
  expect(confirmed.ok).toBe(true);
  if (!confirmed.ok) {
    throw new Error("proposal confirm failed");
  }
  setEvolutionApplyAuthPortsForTests(authPorts());
  setEvolutionControlPlaneForTests(plane);
  const handlers = createEvolutionControlHandlers();
  const rpc: EvolutionRpc =
    input.rpc ??
    (async (method, params) => {
      const handler = handlers[method];
      if (!handler) {
        return { ok: false, error: { message: `missing handler ${method}` } };
      }
      return invoke(handler, params);
    });
  const created = await rpc("evolution.experiments.create", {
    commandId: `cmd-a9-exp-${input.baselineSucceeded ? "up" : "down"}`,
    proposalId: confirmed.receipt.proposalId,
  });
  expect(created.ok, created.error?.message).toBe(true);
  const experiment = created.payload?.experiment as {
    experimentId: string;
    baselineCapture?: { status?: string };
  };
  expect(experiment.baselineCapture?.status).toBe("frozen");
  const canary = await rpc("evolution.applications.apply", {
    commandId: `cmd-a9-canary-a-${input.baselineSucceeded ? "up" : "down"}`,
    proposalId: confirmed.receipt.proposalId,
    experimentId: experiment.experimentId,
    scope: "canary",
  });
  expect(canary.ok, canary.error?.message).toBe(true);
  const applicationA = canary.payload?.application as {
    applicationId: string;
    scope: string;
    status: string;
    appliedAt?: string;
  };
  expect(applicationA.scope).toBe("canary");
  expect(applicationA.status).toBe("applied");
  return {
    cfg: seeded.cfg,
    persistDir,
    walFile,
    plane,
    handlers,
    proposalId: confirmed.receipt.proposalId,
    experimentId: experiment.experimentId,
    applicationA,
    candidateVersion: stored.candidateVersion,
    liveBefore,
    liveRoot,
    rpc,
  };
}

describe("A9 001 M1 canary", () => {
  it("does not treat the rehearsal as an E5.2 receipt or an automatic apply", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/applyWorkingDna\s*\(/);
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    const classified = classifyA9M1Event({
      kind: "a9-m1",
      cutoverReady: true,
      e52SwitchAllowed: true,
      executedConsumer: true,
      directMutatorsRetired: true,
    });
    expect(classified.isE52CutoverReceipt).toBe(false);
    expect(classified.executedConsumer).toBe(false);
    expect(classified.directMutatorsRetired).toBe(false);
    expect(isE52CutoverReceipt({ kind: "a9-m1" })).toBe(false);
  });

  it("rejects a regressed cohort and an undrilled canary before active apply", async () => {
    const held = await prepare({ baselineSucceeded: true });
    await recordCohort(held.cfg, held.persistDir, {
      count: SAMPLE_SIZE,
      succeeded: false,
      prefix: "run-treat-early",
      occurredAt: Date.parse(held.applicationA.appliedAt ?? ""),
    });
    const early = await held.rpc("evolution.experiments.evaluate", {
      commandId: "cmd-a9-eval-early",
      experimentId: held.experimentId,
    });
    expect(early.ok, early.error?.message).toBe(true);
    const earlyDecision = early.payload?.decision as { result?: string; reasons?: string[] };
    expect(earlyDecision.result).toBe("inconclusive");
    expect(earlyDecision.reasons).toContain("rollback_drill_not_run");
    expect(
      (early.payload?.experiment as { applyApproval?: string } | undefined)?.applyApproval,
    ).toBeUndefined();
    const blocked = await held.rpc("evolution.applications.apply", {
      commandId: "cmd-a9-active-blocked",
      proposalId: held.proposalId,
      experimentId: held.experimentId,
      scope: "active",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.message).toMatch(/awaiting operator approval/);
    expect(held.plane.listApplications().some((row) => row.scope === "active")).toBe(false);

    const drill = await held.plane.runRollbackDrill({
      commandId: "cmd-a9-drill-down",
      applicationId: held.applicationA.applicationId,
      principalRef: ADMIN_USER_ID,
      trustedTenantId: TENANT,
      verifiedBy: ADMIN_USER_ID,
      evidenceRefs: held.plane.getProposal(held.proposalId)?.sourceEvidenceRefs ?? [],
    });
    expect(drill.result).toBe("passed");
    const canaryB = await held.rpc("evolution.applications.apply", {
      commandId: "cmd-a9-canary-b-down",
      proposalId: held.proposalId,
      experimentId: held.experimentId,
      scope: "canary",
    });
    expect(canaryB.ok, canaryB.error?.message).toBe(true);
    const applicationB = canaryB.payload?.application as {
      applicationId: string;
      appliedAt?: string;
    };
    await recordCohort(held.cfg, held.persistDir, {
      count: SAMPLE_SIZE,
      succeeded: false,
      prefix: "run-treat-down",
      occurredAt: Date.parse(applicationB.appliedAt ?? ""),
    });
    const bound = readEvolutionTaskOutcomes(held.cfg, AGENT).filter((row) =>
      row.runId?.startsWith("run-treat-down-"),
    );
    expect(bound).toHaveLength(SAMPLE_SIZE);
    expect(
      bound.every(
        (row) =>
          row.experimentId === held.experimentId &&
          row.applicationId === applicationB.applicationId,
      ),
    ).toBe(true);
    const evaluated = await held.rpc("evolution.experiments.evaluate", {
      commandId: "cmd-a9-eval-down",
      experimentId: held.experimentId,
    });
    expect(evaluated.ok, evaluated.error?.message).toBe(true);
    const decision = evaluated.payload?.decision as { result?: string; reasons?: string[] };
    expect(decision.result).toBe("regressed");
    expect(
      (evaluated.payload?.experiment as { applyApproval?: string } | undefined)?.applyApproval,
    ).toBeUndefined();
    const active = await held.rpc("evolution.applications.apply", {
      commandId: "cmd-a9-active-down",
      proposalId: held.proposalId,
      experimentId: held.experimentId,
      scope: "active",
    });
    expect(active.ok).toBe(false);
    expect(active.error?.message).toMatch(/awaiting operator approval/);
    expect(held.plane.listApplications().some((row) => row.scope === "active")).toBe(false);
    expect(
      held.plane.ledger.list().some((event) => event.type === "application.approval_pending"),
    ).toBe(false);
  });

  async function proveImproved(ready: Awaited<ReturnType<typeof prepare>>) {
    const drill = await ready.plane.runRollbackDrill({
      commandId: "cmd-a9-drill-up",
      applicationId: ready.applicationA.applicationId,
      principalRef: ADMIN_USER_ID,
      trustedTenantId: TENANT,
      verifiedBy: ADMIN_USER_ID,
      evidenceRefs: ready.plane.getProposal(ready.proposalId)?.sourceEvidenceRefs ?? [],
    });
    expect(drill.result).toBe("passed");
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );
    const canaryB = await ready.rpc("evolution.applications.apply", {
      commandId: "cmd-a9-canary-b-up",
      proposalId: ready.proposalId,
      experimentId: ready.experimentId,
      scope: "canary",
    });
    expect(canaryB.ok, canaryB.error?.message).toBe(true);
    const applicationB = canaryB.payload?.application as {
      applicationId: string;
      appliedAt?: string;
    };
    await recordCohort(ready.cfg, ready.persistDir, {
      count: SAMPLE_SIZE,
      succeeded: true,
      prefix: "run-treat-up",
      occurredAt: Date.parse(applicationB.appliedAt ?? ""),
    });
    const bound = readEvolutionTaskOutcomes(ready.cfg, AGENT).filter((row) =>
      row.runId?.startsWith("run-treat-up-"),
    );
    expect(
      bound.every(
        (row) =>
          row.experimentId === ready.experimentId &&
          row.applicationId === applicationB.applicationId,
      ),
    ).toBe(true);
    const evaluated = await ready.rpc("evolution.experiments.evaluate", {
      commandId: "cmd-a9-eval-up",
      experimentId: ready.experimentId,
    });
    expect(evaluated.ok, evaluated.error?.message).toBe(true);
    const decision = evaluated.payload?.decision as {
      result?: string;
      reasons?: string[];
      assessment?: { method?: string };
    };
    expect(decision.assessment?.method).toBe("two-proportion-z");
    expect(decision.result).toBe("improved");
    expect(decision.reasons).toContain("primary_met");
    expect(
      (evaluated.payload?.experiment as { applyApproval?: string } | undefined)?.applyApproval,
    ).toBe("pending_apply_approval");
    const active = await ready.rpc("evolution.applications.apply", {
      commandId: "cmd-a9-active-up",
      proposalId: ready.proposalId,
      experimentId: ready.experimentId,
      scope: "active",
    });
    expect(active.ok, active.error?.message).toBe(true);
    const application = active.payload?.application as {
      applicationId: string;
      scope: string;
      targetVersionAfter: string;
      appliedAt?: string;
    };
    expect(application.scope).toBe("active");
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "milestone",
    );
    const readBack = await createLiveDiagnosisRecheckPort({
      cfg: ready.cfg,
      resolveExpectation: (request) => expectationFromControlPlane(ready.plane, request),
    }).recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: ready.proposalId,
        experimentId: ready.experimentId,
        applicationId: applicationB.applicationId,
        verificationId: "recheck-before-verify",
      },
      target: { domain: "agent", agentId: AGENT },
      findingRefs: [ready.candidateVersion],
      surfaceId: "agent.working-dna",
      tenantScope: TENANT,
    });
    expect(readBack.outcome).toBe("RESOLVED");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: readBack.outcome })).toBe("promote");
    expect(ready.plane.getProposal(ready.proposalId)?.status).not.toBe("PROMOTED");

    await updateRobotWorkingStyle(ready.cfg, AGENT, (current) => ({
      ...current,
      reportingCadence: "periodic",
    }));
    const mismatch = await ready.rpc("evolution.applications.verify", {
      commandId: "cmd-a9-verify-mismatch",
      applicationId: applicationB.applicationId,
    });
    expect(mismatch.ok, mismatch.error?.message).toBe(true);
    expect(ready.plane.getExternalEffectResult(applicationB.applicationId)?.outcome).toBe(
      "contradicted",
    );
    expect(ready.plane.getProposal(ready.proposalId)?.status).not.toBe("VERIFIED");
    const mismatchVerification = mismatch.payload?.verification as { verificationId: string };
    const regressed = await createLiveDiagnosisRecheckPort({
      cfg: ready.cfg,
      resolveExpectation: (request) => expectationFromControlPlane(ready.plane, request),
    }).recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: ready.proposalId,
        experimentId: ready.experimentId,
        applicationId: applicationB.applicationId,
        verificationId: mismatchVerification.verificationId,
      },
      target: { domain: "agent", agentId: AGENT },
      findingRefs: [ready.candidateVersion],
      surfaceId: "agent.working-dna",
      tenantScope: TENANT,
    });
    expect(regressed.outcome).toBe("REGRESSED");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: regressed.outcome })).toBe("rollback");

    await updateRobotWorkingStyle(ready.cfg, AGENT, (current) => ({
      ...current,
      reportingCadence: "milestone",
    }));
    await recordCohort(ready.cfg, ready.persistDir, {
      count: SAMPLE_SIZE,
      succeeded: true,
      prefix: "run-treat-active",
      occurredAt: Date.parse(application.appliedAt ?? ""),
    });
    const verified = await ready.rpc("evolution.applications.verify", {
      commandId: "cmd-a9-verify-ok",
      applicationId: application.applicationId,
    });
    expect(verified.ok, verified.error?.message).toBe(true);
    expect(ready.plane.getExternalEffectResult(application.applicationId)?.outcome).toBe(
      "verified",
    );
    expect(ready.plane.getProposal(ready.proposalId)?.status).toBe("VERIFIED");
    const verification = verified.payload?.verification as {
      verificationId: string;
      outcome: string;
    };
    expect(verification.outcome).toBe("improved");
    const resolved = await createLiveDiagnosisRecheckPort({
      cfg: ready.cfg,
      resolveExpectation: (request) => expectationFromControlPlane(ready.plane, request),
    }).recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: ready.proposalId,
        experimentId: ready.experimentId,
        applicationId: application.applicationId,
        verificationId: verification.verificationId,
      },
      target: { domain: "agent", agentId: AGENT },
      findingRefs: [ready.candidateVersion],
      surfaceId: "agent.working-dna",
      tenantScope: TENANT,
    });
    expect(resolved.outcome).toBe("STILL_OPEN");
    expect(resolved.reasonCode).toBe("sot_unchanged");
    const buildSha = "a12-build-info";
    setDiagnosisReceiptBuildInfoForTests(() => ({ commit: buildSha }));
    const regressedReceipt = persistDiagnosisRecheckReceipt(
      ready.persistDir,
      {
        receiptId: `recheck:${applicationB.applicationId}:regressed`,
        proposalId: ready.proposalId,
        experimentId: ready.experimentId,
        applicationId: applicationB.applicationId,
        verificationId: mismatchVerification.verificationId,
        tenantId: TENANT,
        target: `agent:${AGENT}`,
        operatorId: ADMIN_USER_ID,
        commandId: "cmd-a9-verify-mismatch",
        candidateVersion: ready.candidateVersion,
        result: regressed,
      },
      { ledger: ready.plane.ledger },
    );
    expect(regressedReceipt.closure.recommendation).toBe("rollback");
    expect(regressedReceipt.closure.promotionEligible).toBe(false);
    const stillOpenReceipt = persistDiagnosisRecheckReceipt(
      ready.persistDir,
      {
        receiptId: `recheck:${application.applicationId}`,
        proposalId: ready.proposalId,
        experimentId: ready.experimentId,
        applicationId: application.applicationId,
        verificationId: verification.verificationId,
        tenantId: TENANT,
        target: `agent:${AGENT}`,
        operatorId: ADMIN_USER_ID,
        commandId: "cmd-a9-verify-ok",
        candidateVersion: ready.candidateVersion,
        result: resolved,
      },
      { ledger: ready.plane.ledger },
    );
    const stillOpen = stillOpenReceipt.closure;
    expect(stillOpen.applicationVerified).toBe(true);
    expect(stillOpen.diagnosisRecheckOutcome).toBe("STILL_OPEN");
    expect(stillOpen.promotionEligible).toBe(false);
    expect(stillOpen.promotionStatus).toBe("ineligible");
    expect(stillOpen.recommendation).toBe("hold");
    expect(stillOpen.recordsPromotionCompleted).toBe(false);
    expect(stillOpen.userVisibleStatus).toBe("已验证，进化未完成");
    expect(stillOpen.userVisibleStatus).not.toContain("进化完成");
    expect(
      recommendDiagnosisApplyFollowUp({ recheckOutcome: resolved.outcome, sotReadable: true }),
    ).toBe("hold");
    expect(ready.plane.getProposal(ready.proposalId)?.status).not.toBe("PROMOTED");
    expect(ready.plane.ledger.list().some((event) => event.type === "promotion.completed")).toBe(
      false,
    );
    const types = ready.plane.ledger.list().map((event) => event.type);
    for (const type of [
      "proposal.created",
      "experiment.started",
      "application.applied",
      "rollback_drill.completed",
      "application.approval_pending",
      "external_effect.recorded",
      "verification.completed",
    ]) {
      expect(types).toContain(type);
    }
    expect(fingerprint(ready.liveRoot)).toEqual(ready.liveBefore);
    const replayRoot = "/tmp/openbot-a10-001-m1";
    mkdirSync(replayRoot, { recursive: true });
    for (const name of [
      "proposals.json",
      "experiments.json",
      "applications.json",
      "verifications.json",
      "ledger.jsonl",
      "diagnosis-ingest-wal.json",
      "diagnosis-recheck-receipts.json",
    ]) {
      copyFileSync(path.join(ready.persistDir, name), path.join(replayRoot, name));
    }
    resetDiagnosisM1ReceiptsForTests();
    const reloaded = loadDiagnosisRecheckReceipt(replayRoot, {
      tenantId: TENANT,
      proposalId: ready.proposalId,
      receiptId: stillOpenReceipt.receiptId,
      applicationId: application.applicationId,
      verificationId: verification.verificationId,
    });
    expect(reloaded?.result.outcome).toBe("STILL_OPEN");
    expect(reloaded?.closure.promotionEligible).toBe(false);
    expect(reloaded?.closure.recommendation).toBe("hold");
    expect(reloaded?.closure.recordsPromotionCompleted).toBe(false);
    expect(reloaded?.tenantId).toBe(TENANT);
    expect(reloaded?.operatorId).toBe(ADMIN_USER_ID);
    expect(reloaded?.candidateVersion).toBe(ready.candidateVersion);
    expect(reloaded?.buildSha).toBe(buildSha);
    const proposals = JSON.parse(
      readFileSync(path.join(replayRoot, "proposals.json"), "utf8"),
    ) as Record<string, { status?: string }>;
    expect(proposals[ready.proposalId]?.status).toBe("VERIFIED");
    const experiments = JSON.parse(
      readFileSync(path.join(replayRoot, "experiments.json"), "utf8"),
    ) as Record<string, { experimentId?: string }>;
    expect(experiments[ready.experimentId]?.experimentId).toBe(ready.experimentId);
    const applications = JSON.parse(
      readFileSync(path.join(replayRoot, "applications.json"), "utf8"),
    ) as Record<string, { scope?: string; applicationId?: string }>;
    expect(applications[application.applicationId]?.scope).toBe("active");
    expect(applications[applicationB.applicationId]?.scope).toBe("canary");
    const verifications = JSON.parse(
      readFileSync(path.join(replayRoot, "verifications.json"), "utf8"),
    ) as Record<string, { verificationId?: string }>;
    expect(verifications[verification.verificationId]?.verificationId).toBe(
      verification.verificationId,
    );
    expect(verifications[mismatchVerification.verificationId]?.verificationId).toBe(
      mismatchVerification.verificationId,
    );
    const ledger = readFileSync(path.join(replayRoot, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { type?: string; proposalId?: string });
    expect(ledger.some((event) => event.type === "promotion.completed")).toBe(false);
    expect(ledger.some((event) => event.type === "proposal.created")).toBe(true);
    const wal = JSON.parse(
      readFileSync(path.join(replayRoot, "diagnosis-ingest-wal.json"), "utf8"),
    ) as Record<string, { proposalId?: string }>;
    expect(Object.values(wal).some((row) => row.proposalId === ready.proposalId)).toBe(true);
    const evidence = {
      tenantId: TENANT,
      target: `agent:${AGENT}`,
      operatorId: ADMIN_USER_ID,
      buildSha,
      candidateVersion: ready.candidateVersion,
      proposalId: ready.proposalId,
      experimentId: ready.experimentId,
      canaryApplicationId: applicationB.applicationId,
      activeApplicationId: application.applicationId,
      mismatchVerificationId: mismatchVerification.verificationId,
      verificationId: verification.verificationId,
      recheckReceiptId: stillOpenReceipt.receiptId,
      commandIds: ["cmd-a9-verify-mismatch", "cmd-a9-verify-ok"],
      replayRoot,
      applicationVerified: reloaded?.closure.applicationVerified,
      diagnosisRecheckOutcome: reloaded?.closure.diagnosisRecheckOutcome,
      promotionEligible: reloaded?.closure.promotionEligible,
      promotionStatus: reloaded?.closure.promotionStatus,
      recommendation: reloaded?.closure.recommendation,
      userVisibleStatus: reloaded?.closure.userVisibleStatus,
      sotMismatch: "contradicted",
      sotMatch: "verified",
      recheckMismatch: regressed.outcome,
      recheckMatch: readBack.outcome,
      recheckActiveIdempotent: resolved.outcome,
      boundary: "A10 completion is not E5.2 and does not open autoApply",
    };
    writeFileSync(path.join(replayRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    expect(evidence.userVisibleStatus).not.toContain("进化完成");
    hydrateDiagnosisM1Receipts(replayRoot);
  }

  it("applies active only after a real improved evaluation and reads SoT both ways", async () => {
    await proveImproved(await prepare({ baselineSucceeded: false }));
  });

  it("runs the improved loop through a live gateway and reads it back by id", async () => {
    const token = `a10-${Date.now()}`;
    const liveSurfaces = path.join(
      process.env.HOME ?? "",
      ".openbot/evolution-control/surfaces.json",
    );
    const surfacesBefore = existsSync(liveSurfaces) ? readFileSync(liveSurfaces) : null;
    setEvolutionRpcTestIdentityForTests({
      user: ADMIN_USER_ID,
      platformUserId: ADMIN_USER_ID,
      sessionKind: "enterprise-admin",
      sessionMembershipId: MEMBERSHIP_ID,
      sessionEnterpriseId: TENANT,
    });
    process.env.OPENCLAW_SKIP_CHANNELS = "1";
    process.env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";
    process.env.OPENCLAW_SKIP_CRON = "1";
    process.env.OPENCLAW_SKIP_CANVAS_HOST = "1";
    process.env.OPENCLAW_SKIP_BROWSER_CONTROL_SERVER = "1";
    const port = await getFreeGatewayPort();
    const server = await startGatewayServer(port, {
      bind: "loopback",
      auth: { mode: "token", token },
      controlUiEnabled: false,
    });
    const client = await connectGatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token,
      role: "operator",
      scopes: ["operator.approvals", "operator.read"],
      clientDisplayName: "a10-m1",
      timeoutMs: 20_000,
    });
    let ready: Awaited<ReturnType<typeof prepare>> | undefined;
    setDiagnosisCandidateStatusPortsForTests({
      listProposals: () => ready?.plane.listProposals() ?? [],
      getProposal: (id) => ready?.plane.getProposal(id),
      listWals: () => {
        if (!ready) {
          return [];
        }
        return Object.values(
          JSON.parse(readFileSync(ready.walFile, "utf8")) as Record<
            string,
            DiagnosisIngestWalRecord
          >,
        );
      },
      getExperiment: (id) => ready?.plane.getExperiment(id),
    });
    const rpc: EvolutionRpc = async (method, params) => {
      try {
        const payload = await client.request(method, params);
        return { ok: true, payload };
      } catch (error) {
        return {
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    };
    try {
      ready = await prepare({ baselineSucceeded: false, rpc });
      await proveImproved(ready);
      const projection = await client.request<{
        projection: {
          found: boolean;
          applicationVerified: boolean;
          diagnosisRecheckOutcome: string | null;
          promotionEligible: boolean;
          promotionStatus: string | null;
          userVisibleStatus: string | null;
          liveStatus: string | null;
        };
      }>("evolution.diagnosis.status", { candidateVersion: ready.candidateVersion });
      expect(projection.projection.found).toBe(true);
      expect(projection.projection.liveStatus).toBe("VERIFIED");
      expect(projection.projection.applicationVerified).toBe(true);
      expect(projection.projection.diagnosisRecheckOutcome).toBe("STILL_OPEN");
      expect(projection.projection.promotionEligible).toBe(false);
      expect(projection.projection.promotionStatus).toBe("ineligible");
      expect(projection.projection.userVisibleStatus).toBe("已验证，进化未完成");
      const proposal = await client.request<{ proposal: { proposalId: string; status: string } }>(
        "evolution.proposals.get",
        { proposalId: ready.proposalId },
      );
      expect(proposal.proposal.proposalId).toBe(ready.proposalId);
      expect(proposal.proposal.status).toBe("VERIFIED");
      const experiment = await client.request<{ experiment: { experimentId: string } }>(
        "evolution.experiments.get",
        { experimentId: ready.experimentId },
      );
      expect(experiment.experiment.experimentId).toBe(ready.experimentId);
    } finally {
      client.stop();
      await server.close({ reason: "a10 m1 rehearsal finished" });
      if (surfacesBefore) {
        writeFileSync(liveSurfaces, surfacesBefore);
      } else if (existsSync(liveSurfaces)) {
        rmSync(liveSurfaces);
      }
    }
  }, 180_000);
});
