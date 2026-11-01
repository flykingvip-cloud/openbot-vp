import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  authorizeShadowIntentProposal,
  projectShadowIntentOperatorHints,
  setAuthorizeShadowIntentInspectorForTests,
  SHADOW_INTENT_AUTHORIZE_SURFACES,
} from "./authorize-shadow-intent.js";
import { testInspector, testObservation } from "./test-support.js";

const TENANT = "tenant-shadow-authz";
const AGENT_ID = "shadow-authz-bot";

const { CONFIG_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  return {
    CONFIG_DIR: nodePath.join(nodeOs.tmpdir(), `openbot-p1e-shadow-authz-${Date.now()}`),
  };
});

vi.mock("../../utils.js", () => ({ CONFIG_DIR }));

const { saveSkillAsset, listRobotSkillAssets, resetSkillHealthWindowsCacheForTests } =
  await import("../skill-lifecycle-store.js");
const { createShadowIntentProposalRegistrar } = await import("./shadow-intent-proposal.js");
const { createGatewayEvolutionControlPlane } = await import("./gateway-plane.js");
const { createEvolutionControlHandlers } = await import("../server-methods/evolution-control.js");

function clientFor(
  tenantId: string,
  scopes = ["operator.read", "operator.approvals"],
): GatewayClient {
  return {
    user: "operator-1",
    platformUserId: "platform-user-1",
    sessionKind: "enterprise-admin",
    sessionMembershipId: "mem-1",
    sessionEnterpriseId: tenantId,
    sessionTenantId: tenantId,
    connect: { scopes },
  } as GatewayClient;
}

async function invoke(
  handler: ReturnType<typeof createEvolutionControlHandlers>[string],
  params: Record<string, unknown>,
  client: GatewayClient,
) {
  let ok = false;
  let payload: unknown;
  let error: { message?: string } | undefined;
  await handler({
    params,
    client,
    respond: (success: boolean, data: unknown, err?: unknown) => {
      ok = success;
      payload = data;
      error = err as { message?: string } | undefined;
    },
  } as never);
  return { ok, payload, error };
}

const missingInspector: EvolutionAuthorizationInspector = {
  inspect: () => ({ status: "missing" }),
};

describe("P1-E authorize shadow intent entry", () => {
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    persistDir = path.join(CONFIG_DIR, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: CONFIG_DIR }] },
    } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    setAuthorizeShadowIntentInspectorForTests();
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  });

  it("labels DISCOVERED skill-install shadow as observe-only with authorize nextAction", () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: "skill-auto-install:cand-a:skill-a",
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId: "skill-a",
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: "audit:skill-a",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    expect(binding?.proposal?.status).toBe("DISCOVERED");
    expect(plane.listApplications()).toEqual([]);
    const hints = projectShadowIntentOperatorHints(binding!.proposal!);
    expect(hints.observeOnly).toBe(true);
    expect(hints.nextAction).toBe("authorize");
    expect(SHADOW_INTENT_AUTHORIZE_SURFACES.has("capability.skill-installation")).toBe(true);
  });

  it("keeps runtime-binding shadow observe-only and refuses authorize", () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: "limit:bot-a:high_skill_latency:2026-10-30",
      intent: {
        kind: "runtime-action",
        surfaceId: "system.runtime-binding-governance",
        adapterId: "runtime-governance",
        runtimeAgentId: "bot-a",
        action: "limit",
        approvedAction: "limit",
        candidateVersion: "",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    const proposal = binding!.proposal!;
    expect(projectShadowIntentOperatorHints(proposal).nextAction).toBe("observe");
    const denied = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-runtime-1",
      proposalId: proposal.proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
      now: "2026-10-30T02:00:00.000Z",
    });
    expect(denied).toMatchObject({ ok: false, code: "observe_only_surface" });
    expect(plane.getProposal(proposal.proposalId)?.status).toBe("DISCOVERED");
  });

  it("fail-before: DISCOVERED cannot start experiment; authorize then Apply/rollback closes loop", async () => {
    const saved = saveSkillAsset({
      sourceAgentId: "author-bot",
      autoInstallEnabled: false,
      lifecycle: "private",
      profile: {
        name: "Shadow authz loop",
        summary: "Skill for P1-E authorize→Apply→rollback",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["stay brief"] },
    });
    const skillId = saved.skillId;
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId)).toBe(false);

    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: `skill-auto-install:cand:${skillId}`,
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId,
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: `audit:${skillId}`,
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    const proposalId = binding!.proposal!.proposalId;
    expect(plane.getProposal(proposalId)?.status).toBe("DISCOVERED");
    expect(plane.getProposal(proposalId)?.grantId).toMatch(/^grant:pending:/);

    await expect(
      plane.startExperiment({
        commandId: "exp-too-early",
        proposalId,
        now: "2026-10-30T02:00:00.000Z",
        freeze: {
          baselineVersion: "skill:private:1.0.0",
          candidateVersion: plane.getProposal(proposalId)!.candidateRef,
          codeSha: "sha-p1e",
          modelRef: "model-p1e",
          providerVersion: "provider-p1e",
          configSnapshotRef: "cfg-p1e",
          datasetOrCohortRef: "cohort-p1e",
          tenantScope: TENANT,
          confidentialityScope: "enterprise",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxResourceBudget: 1,
        },
      }),
    ).rejects.toThrow();
    expect(plane.getProposal(proposalId)?.status).toBe("DISCOVERED");
    expect(plane.listApplications()).toEqual([]);

    expect(
      authorizeShadowIntentProposal(plane, testInspector(TENANT), {
        commandId: "authz-1",
        proposalId,
        grantId: "grant-1",
        principalRef: "operator-1",
        trustedTenantId: TENANT,
        confirmedByUser: false,
      }),
    ).toMatchObject({ ok: false, code: "confirm_required" });
    expect(plane.getProposal(proposalId)?.status).toBe("DISCOVERED");

    expect(
      authorizeShadowIntentProposal(plane, missingInspector, {
        commandId: "authz-missing",
        proposalId,
        grantId: "grant-missing",
        principalRef: "operator-1",
        trustedTenantId: TENANT,
        confirmedByUser: true,
        now: "2026-10-30T02:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, code: "grant_missing" });
    expect(plane.getProposal(proposalId)?.status).toBe("DISCOVERED");

    const authorized = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
      now: "2026-10-30T02:00:00.000Z",
    });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.proposal.status).toBe("APPROVED_FOR_EXPERIMENT");
      expect(authorized.proposal.grantId).toBe("grant-1");
      expect(authorized.alreadyAuthorized).toBe(false);
    }
    expect(plane.getProposal(proposalId)?.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(projectShadowIntentOperatorHints(plane.getProposal(proposalId)!).nextAction).toBe(
      "request_experiment",
    );

    const replay = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
      now: "2026-10-30T02:01:00.000Z",
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.alreadyAuthorized).toBe(true);
    }

    const experiment = await plane.startExperiment({
      commandId: "exp-shadow-1",
      proposalId,
      now: "2026-10-30T03:00:00.000Z",
      freeze: {
        baselineVersion: "skill:private:1.0.0",
        candidateVersion: plane.getProposal(proposalId)!.candidateRef,
        codeSha: "sha-p1e",
        modelRef: "model-p1e",
        providerVersion: "provider-p1e",
        configSnapshotRef: "cfg-p1e",
        datasetOrCohortRef: "cohort-p1e",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });

    const application = await plane.applySkill({
      commandId: "apply-shadow-1",
      proposalId,
      experimentId: experiment.experimentId,
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(application.status).toBe("applied");
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId && row.enabled)).toBe(
      true,
    );

    const rolled = await plane.rollbackApplication({
      commandId: "rollback-shadow-1",
      applicationId: application.applicationId,
      principalRef: "operator-1",
      trustedTenantId: TENANT,
    });
    expect(rolled.application.status).toBe("rolled_back");
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId && row.enabled)).toBe(
      false,
    );
  });

  it("reject leaves no applications and does not Apply", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: "skill-auto-install:reject-me:skill-r",
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId: "skill-r",
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: "audit:skill-r",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    const proposalId = binding!.proposal!.proposalId;
    // Align evidence with test grant so reject authority can run (status quo path).
    const discovered = plane.getProposal(proposalId)!;
    plane.stageDiagnosisProposal({ ...discovered, sourceEvidenceRefs: ["ev-a"] });
    const handlers = createEvolutionControlHandlers(() => plane);
    const rejected = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-reject-shadow", proposalId, command: "reject" },
      clientFor(TENANT),
    );
    expect(rejected.ok).toBe(true);
    expect(plane.getProposal(proposalId)?.status).toBe("REJECTED");
    expect(plane.listApplications()).toEqual([]);
  });

  it("RPC evolution.proposals.authorize is reachable and does not Apply", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: "skill-auto-install:rpc:skill-rpc",
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId: "skill-rpc",
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: "audit:skill-rpc",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    const proposalId = binding!.proposal!.proposalId;
    setAuthorizeShadowIntentInspectorForTests(testInspector(TENANT));
    const handlers = createEvolutionControlHandlers(() => plane);
    expect(Object.hasOwn(handlers, "evolution.proposals.authorize")).toBe(true);

    const listed = await invoke(
      handlers["evolution.proposals.get"],
      { proposalId },
      clientFor(TENANT),
    );
    expect(listed.ok).toBe(true);
    const projected = (listed.payload as { proposal: Record<string, unknown> }).proposal;
    expect(projected.observeOnly).toBe(true);
    expect(projected.nextAction).toBe("authorize");

    const unauthorizedScope = await invoke(
      handlers["evolution.proposals.authorize"],
      { commandId: "rpc-authz-1", proposalId, grantId: "grant-1" },
      clientFor(TENANT, ["operator.read"]),
    );
    expect(unauthorizedScope.ok).toBe(false);

    const authorized = await invoke(
      handlers["evolution.proposals.authorize"],
      { commandId: "rpc-authz-1", proposalId, grantId: "grant-1" },
      clientFor(TENANT),
    );
    expect(authorized.ok).toBe(true);
    expect(plane.getProposal(proposalId)?.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(plane.listApplications()).toEqual([]);
  });
});
