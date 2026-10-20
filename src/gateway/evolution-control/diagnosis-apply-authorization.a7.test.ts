import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyleOrDefault } from "../agent-growth/working-style-store.js";
import { createEvolutionControlHandlers } from "../server-methods/evolution-control.js";
import type { GatewayClient, GatewayRequestHandler } from "../server-methods/types.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import {
  decideEvolutionApplyAuthorization,
  setEvolutionApplyAuthPortsForTests,
  type EvolutionApplyActor,
  type EvolutionApplyAuthPorts,
  type EvolutionApplyGrant,
  type EvolutionApplyObject,
} from "./apply-authorization.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { recommendDiagnosisApplyFollowUp } from "./diagnosis-apply-gate.js";
import { workingDnaBaselineHash } from "./submit-diagnosis-candidate.js";
import {
  createPassingObservationProvider,
  testInspector,
  withWorkingDnaExternal,
} from "./test-support.js";

const dirs: string[] = [];
const NOW = "2026-09-19T12:00:00.000Z";
const TENANT = "tenant-a7";
const OTHER = "tenant-a7-other";
const AGENT = "a7-bot";

afterEach(() => {
  setEvolutionApplyAuthPortsForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-a7-"));
  dirs.push(dir);
  return dir;
}

function actor(over: Partial<EvolutionApplyActor> = {}): EvolutionApplyActor {
  return {
    sessionKind: "member",
    membershipRole: "member",
    tenantId: TENANT,
    userId: "user-owner",
    ...over,
  };
}

function object(over: Partial<EvolutionApplyObject> = {}): EvolutionApplyObject {
  return {
    tenantId: TENANT,
    targetId: `agent:${AGENT}`,
    objectKind: "member",
    ownerUserId: "user-owner",
    ...over,
  };
}

function grant(actions: string[] = ["apply", "verify"]): EvolutionApplyGrant {
  return {
    tenantId: TENANT,
    targetId: `agent:${AGENT}`,
    actions,
    expiresAt: "2026-09-20T00:00:00.000Z",
    status: "APPROVED",
    granteeUserId: "user-owner",
  };
}

function ports(input: {
  actor: EvolutionApplyActor;
  object: EvolutionApplyObject;
  grant?: EvolutionApplyGrant | null;
}): EvolutionApplyAuthPorts {
  return {
    resolveActor: async () => input.actor,
    resolveObject: async () => input.object,
    resolveGrant: async () => input.grant ?? null,
  };
}

function client(input: {
  tenantId?: string | null;
  scopes: string[];
  user?: string;
  sessionKind?: GatewayClient["sessionKind"];
  platformUserId?: string;
  membershipId?: string | null;
}): GatewayClient {
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
      scopes: input.scopes,
    },
    user: input.user ?? "user-owner",
    platformUserId: input.platformUserId ?? input.user ?? "user-owner",
    ...(input.sessionKind ? { sessionKind: input.sessionKind } : {}),
    ...(input.tenantId
      ? { sessionEnterpriseId: input.tenantId, sessionTenantId: input.tenantId }
      : {}),
    ...(input.membershipId === null ? {} : { sessionMembershipId: input.membershipId ?? "mem-1" }),
  };
}

function invoke(
  handler: GatewayRequestHandler,
  params: Record<string, unknown>,
  caller: GatewayClient,
) {
  return new Promise<{ ok: boolean; error?: { message?: string } }>((resolve) => {
    void handler({
      req: { id: "1", method: "test", type: "req" },
      params,
      client: caller,
      isWebchatConnect: () => false,
      respond: (ok, _payload, error) => {
        resolve({ ok, error: error as { message?: string } | undefined });
      },
      context: {} as never,
    });
  });
}

async function improvedPlane() {
  const agentDir = tempDir();
  const persistDir = tempDir();
  const cfg = { agents: { list: [{ id: AGENT, agentDir }] } } as unknown as OpenBotConfig;
  const plane = createEvolutionControlPlane({
    inspector: testInspector(TENANT),
    workingDnaAdapter: createWorkingDnaAdapter(cfg),
    observationProvider: createPassingObservationProvider(),
    persistDir,
    now: () => NOW,
    ...withWorkingDnaExternal(cfg),
  });
  plane.registerProposal(
    {
      schemaVersion: 2,
      proposalId: "evo:a7",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
      target: { domain: "agent", agentId: AGENT },
      candidateRef: "cand:a7",
      surfaceId: "agent.working-dna",
      expectedEffects: [
        { metricId: "task_success_rate", improveWhen: "increase", minimumEffect: 0.02 },
      ],
      riskLevel: "medium",
      confidentialityScope: "enterprise",
      tenantScope: TENANT,
      grantId: "grant-1",
      status: "APPROVED_FOR_EXPERIMENT",
      createdAt: "2026-09-19T10:00:00.000Z",
      expiresAt: "2026-09-20T00:00:00.000Z",
    },
    {
      agentId: AGENT,
      delta: { reportingCadence: "milestone" as const },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:a7",
    },
  );
  const experiment = await plane.startExperiment({
    commandId: "exp-a7",
    proposalId: "evo:a7",
    now: NOW,
    freeze: {
      baselineVersion: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      candidateVersion: "cand:a7",
      codeSha: "sha-a7",
      modelRef: "model-a7",
      providerVersion: "provider-a7",
      configSnapshotRef: "cfg-a7",
      datasetOrCohortRef: "cohort-a7",
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-20T00:00:00.000Z",
      maxResourceBudget: 1,
    },
  });
  await plane.evaluateExperiment(experiment.experimentId);
  return { plane, cfg, experiment };
}

describe("A7 apply authorization", () => {
  it("rejects cross-tenant, unowned, undelegated, and platform-unscoped actors", () => {
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "canary",
        actor: actor({ tenantId: OTHER }),
        object: object(),
        grant: null,
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "canary",
        actor: actor(),
        object: object({ ownerUserId: "someone-else" }),
        grant: null,
        now: NOW,
      }),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/owned digital human/) }),
    );
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "active",
        actor: actor(),
        object: object(),
        grant: null,
        now: NOW,
      }),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/explicit grant/) }),
    );
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "canary",
        actor: actor({
          sessionKind: "enterprise-admin",
          membershipRole: "enterprise-admin",
          userId: "admin-1",
        }),
        object: object({ objectKind: "member", ownerUserId: "user-owner" }),
        grant: null,
        now: NOW,
      }),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/delegation grant/) }),
    );
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "canary",
        actor: actor({
          sessionKind: "platform-admin",
          membershipRole: null,
          tenantId: null,
          userId: "platform-1",
        }),
        object: object(),
        grant: null,
        now: NOW,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        reason: expect.stringMatching(/platform identity requires a delegation grant/),
      }),
    );
    expect(
      decideEvolutionApplyAuthorization({
        action: "apply",
        scope: "active",
        actor: actor(),
        object: object(),
        grant: grant(["active"]),
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("maps recheck facts without promoting", () => {
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "REGRESSED" })).toBe("rollback");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "STILL_OPEN" })).toBe("hold");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "INCONCLUSIVE" })).toBe("observe");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "BLOCKED" })).toBe("fail-closed");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "RESOLVED" })).toBe("promote");
  });

  it("rejects unauthorized gateway apply with zero writes", async () => {
    const ready = await improvedPlane();
    const handlers = createEvolutionControlHandlers(() => ready.plane);
    const base = {
      proposalId: "evo:a7",
      experimentId: ready.experiment.experimentId,
      scope: "canary",
    };
    const cases: Array<{
      name: string;
      params: Record<string, unknown>;
      caller: GatewayClient;
      ports: EvolutionApplyAuthPorts;
      message: RegExp;
    }> = [
      {
        name: "cross-tenant",
        params: { ...base, commandId: "apply-cross" },
        caller: client({
          tenantId: OTHER,
          scopes: ["operator.approvals"],
          sessionKind: "enterprise-admin",
        }),
        ports: ports({
          actor: actor({
            sessionKind: "enterprise-admin",
            membershipRole: "enterprise-admin",
            tenantId: OTHER,
            userId: "admin-other",
          }),
          object: object(),
        }),
        message: /proposal not found|cross-tenant/,
      },
      {
        name: "member-other",
        params: { ...base, commandId: "apply-other" },
        caller: client({ tenantId: TENANT, scopes: ["operator.approvals"], sessionKind: "member" }),
        ports: ports({
          actor: actor(),
          object: object({ ownerUserId: "someone-else" }),
        }),
        message: /owned digital human/,
      },
      {
        name: "admin-no-grant",
        params: { ...base, commandId: "apply-admin" },
        caller: client({
          tenantId: TENANT,
          scopes: ["operator.approvals"],
          sessionKind: "enterprise-admin",
          user: "admin-1",
        }),
        ports: ports({
          actor: actor({
            sessionKind: "enterprise-admin",
            membershipRole: "enterprise-admin",
            userId: "admin-1",
          }),
          object: object({ objectKind: "member", ownerUserId: "user-owner" }),
        }),
        message: /delegation grant/,
      },
      {
        name: "platform",
        params: { ...base, commandId: "apply-platform" },
        caller: client({
          scopes: ["operator.admin", "operator.approvals"],
          sessionKind: "platform-admin",
          user: "platform-1",
          platformUserId: "platform-1",
        }),
        ports: ports({
          actor: actor({
            sessionKind: "platform-admin",
            membershipRole: null,
            tenantId: null,
            userId: "platform-1",
          }),
          object: object(),
        }),
        message: /delegation grant/,
      },
      {
        name: "null-session",
        params: { ...base, commandId: "apply-no-session" },
        caller: client({ tenantId: TENANT, scopes: ["operator.approvals"] }),
        ports: ports({ actor: actor(), object: object() }),
        message: /operator session is required/,
      },
      {
        name: "missing-membership",
        params: { ...base, commandId: "apply-no-membership" },
        caller: client({
          tenantId: TENANT,
          scopes: ["operator.approvals"],
          sessionKind: "enterprise-admin",
          user: "admin-1",
          membershipId: null,
        }),
        ports: ports({
          actor: actor({
            sessionKind: "enterprise-admin",
            membershipRole: "enterprise-admin",
            userId: "admin-1",
          }),
          object: object({ objectKind: "enterprise", ownerUserId: null }),
        }),
        message: /membership is required/,
      },
      {
        name: "missing-platform-user",
        params: { ...base, commandId: "apply-no-platform-user" },
        caller: client({
          tenantId: TENANT,
          scopes: ["operator.approvals"],
          sessionKind: "enterprise-admin",
          user: "admin-1",
          platformUserId: "",
        }),
        ports: ports({
          actor: actor({
            sessionKind: "enterprise-admin",
            membershipRole: "enterprise-admin",
            userId: "admin-1",
          }),
          object: object({ objectKind: "enterprise", ownerUserId: null }),
        }),
        message: /platform user is required/,
      },
      {
        name: "no-ownership",
        params: { ...base, commandId: "apply-no-owner" },
        caller: client({
          tenantId: TENANT,
          scopes: ["operator.approvals"],
          sessionKind: "enterprise-admin",
          user: "admin-1",
        }),
        ports: {
          resolveActor: async () =>
            actor({
              sessionKind: "enterprise-admin",
              membershipRole: "enterprise-admin",
              userId: "admin-1",
            }),
          resolveObject: async () => null,
          resolveGrant: async () => null,
        },
        message: /authorization is unresolved/,
      },
      {
        name: "member-active",
        params: { ...base, commandId: "apply-active", scope: "active" },
        caller: client({ tenantId: TENANT, scopes: ["operator.approvals"], sessionKind: "member" }),
        ports: ports({ actor: actor(), object: object() }),
        message: /explicit grant/,
      },
    ];
    for (const row of cases) {
      setEvolutionApplyAuthPortsForTests(row.ports);
      const result = await invoke(handlers["evolution.applications.apply"], row.params, row.caller);
      expect(result.ok, row.name).toBe(false);
      expect(result.error?.message, row.name).toMatch(row.message);
      expect(ready.plane.listApplications(), row.name).toEqual([]);
      expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
        "on_completion",
      );
    }
    const declared = await invoke(
      handlers["evolution.applications.apply"],
      {
        ...base,
        commandId: "apply-declared",
        role: "enterprise-admin",
        approval: true,
        ownerId: "user-owner",
        grantId: "grant-forged",
      },
      client({ tenantId: TENANT, scopes: ["operator.approvals"], sessionKind: "enterprise-admin" }),
    );
    expect(declared.ok).toBe(false);
    expect(declared.error?.message).toMatch(/cannot declare principalRef or tenantId/);
    expect(ready.plane.listApplications()).toEqual([]);
  });

  it("applies canary after improved and authorization, and active only after that canary", async () => {
    const ready = await improvedPlane();
    const handlers = createEvolutionControlHandlers(() => ready.plane);
    const caller = client({
      tenantId: TENANT,
      scopes: ["operator.approvals"],
      sessionKind: "enterprise-admin",
      user: "admin-1",
    });
    setEvolutionApplyAuthPortsForTests(
      ports({
        actor: actor({
          sessionKind: "enterprise-admin",
          membershipRole: "enterprise-admin",
          userId: "admin-1",
        }),
        object: object({ objectKind: "enterprise", ownerUserId: null }),
      }),
    );
    const early = await invoke(
      handlers["evolution.applications.apply"],
      {
        commandId: "apply-active-early",
        proposalId: "evo:a7",
        experimentId: ready.experiment.experimentId,
        scope: "active",
      },
      caller,
    );
    expect(early.ok).toBe(false);
    expect(early.error?.message).toMatch(/prior canary/);
    expect(ready.plane.listApplications()).toEqual([]);

    const canary = await invoke(
      handlers["evolution.applications.apply"],
      {
        commandId: "apply-canary",
        proposalId: "evo:a7",
        experimentId: ready.experiment.experimentId,
        scope: "canary",
      },
      caller,
    );
    expect(canary.ok).toBe(true);
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "milestone",
    );
    expect(ready.plane.listApplications().some((row) => row.scope === "canary")).toBe(true);
    expect(ready.plane.getProposal("evo:a7")?.status).toBe("CANARY");
  });
});
