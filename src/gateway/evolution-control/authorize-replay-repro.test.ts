/**
 * P1-E authorize replay matrix (Codex PoC → production test).
 * Positive: same-subject commandId replay → alreadyAuthorized.
 * Negative: cross-tenant / wrong principal / wrong grant / revoked|expired /
 * command rebind — must fail without leaking other-tenant proposal bodies.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  authorizeShadowIntentProposal,
  setAuthorizeShadowIntentInspectorForTests,
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
    CONFIG_DIR: nodePath.join(nodeOs.tmpdir(), `openbot-p1e-authz-replay-${Date.now()}`),
  };
});

vi.mock("../../utils.js", () => ({ CONFIG_DIR }));

const { resetSkillHealthWindowsCacheForTests } = await import("../skill-lifecycle-store.js");
const { createShadowIntentProposalRegistrar } = await import("./shadow-intent-proposal.js");
const { createGatewayEvolutionControlPlane } = await import("./gateway-plane.js");

const missingInspector: EvolutionAuthorizationInspector = {
  inspect: () => ({ status: "missing" }),
};

function revokedInspector(tenantScope: string): EvolutionAuthorizationInspector {
  return testInspector(tenantScope, { revoked: true });
}

function expiredInspector(tenantScope: string): EvolutionAuthorizationInspector {
  return testInspector(tenantScope, { expired: true });
}

describe("P1-E authorize replay binding matrix", () => {
  let persistDir = "";
  let cfg: OpenBotConfig;
  let proposalId = "";
  let plane: ReturnType<typeof createGatewayEvolutionControlPlane>;

  beforeEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    persistDir = path.join(CONFIG_DIR, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: CONFIG_DIR }] },
    } as unknown as OpenBotConfig;

    plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
      observationProvider: testObservation(),
    });
    const registrar = createShadowIntentProposalRegistrar(plane);
    const binding = registrar({
      commandId: "skill-auto-install:cand-replay:skill-replay",
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId: "skill-replay",
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: "audit:skill-replay",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:00:00.000Z",
    });
    proposalId = binding!.proposal!.proposalId;

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
      expect(authorized.alreadyAuthorized).toBe(false);
      expect(authorized.proposal.status).toBe("APPROVED_FOR_EXPERIMENT");
    }
  });

  afterEach(async () => {
    setAuthorizeShadowIntentInspectorForTests();
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  });

  it("positive: same-subject commandId replay returns alreadyAuthorized without re-Apply", () => {
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
      expect(replay.proposal.tenantScope).toBe(TENANT);
      expect(replay.proposal.grantId).toBe("grant-1");
    }
    expect(plane.listApplications()).toEqual([]);
  });

  it("negative: cross-tenant replay fails and does not leak proposal body", () => {
    const wrongTenantReplay = authorizeShadowIntentProposal(plane, missingInspector, {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-missing",
      principalRef: "operator-other",
      trustedTenantId: "tenant-other",
      confirmedByUser: true,
    });
    expect(wrongTenantReplay.ok).toBe(false);
    if (!wrongTenantReplay.ok) {
      expect(["cross_tenant", "command_rebind", "grant_missing", "grant_inactive"]).toContain(
        wrongTenantReplay.code,
      );
      expect(wrongTenantReplay.proposal).toBeUndefined();
      expect(JSON.stringify(wrongTenantReplay)).not.toMatch(/tenant-shadow-authz/);
    }
  });

  it("negative: wrong principal with same commandId is command_rebind (no body leak)", () => {
    const wrongPrincipal = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-other",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(wrongPrincipal).toMatchObject({ ok: false, code: "command_rebind" });
    expect("proposal" in wrongPrincipal ? wrongPrincipal.proposal : undefined).toBeUndefined();
  });

  it("negative: wrong grant with same commandId is command_rebind", () => {
    const wrongGrant = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-other",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(wrongGrant).toMatchObject({ ok: false, code: "command_rebind" });
  });

  it("negative: revoked grant replay is grant_inactive (explicit policy)", () => {
    const revoked = authorizeShadowIntentProposal(plane, revokedInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(revoked).toMatchObject({ ok: false, code: "grant_inactive" });
    expect("proposal" in revoked ? revoked.proposal : undefined).toBeUndefined();
  });

  it("negative: expired grant replay is grant_inactive (explicit policy)", () => {
    const expired = authorizeShadowIntentProposal(plane, expiredInspector(TENANT), {
      commandId: "authz-1",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(expired).toMatchObject({ ok: false, code: "grant_inactive" });
  });

  it("negative: commandId rebound to another proposalId is command_rebind", () => {
    const registrar = createShadowIntentProposalRegistrar(plane);
    const other = registrar({
      commandId: "skill-auto-install:cand-other:skill-other",
      intent: {
        kind: "skill-install",
        surfaceId: "capability.skill-installation",
        adapterId: "skill-installation",
        agentId: AGENT_ID,
        skillId: "skill-other",
        version: "1.0.0",
        approvedAction: "install",
        candidateVersion: "",
        autoInstallIntent: true,
        approvalAuditRef: "audit:skill-other",
        tenantScope: TENANT,
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-30T01:30:00.000Z",
    });
    const otherId = other!.proposal!.proposalId;
    const rebound = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-1",
      proposalId: otherId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(rebound).toMatchObject({ ok: false, code: "command_rebind" });
  });

  it("APPROVED_FOR_EXPERIMENT same-grant early path still checks active grant", () => {
    // New commandId against already-approved proposal (no ledger hit for this commandId).
    const withRevoked = authorizeShadowIntentProposal(plane, revokedInspector(TENANT), {
      commandId: "authz-fresh-cmd",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(withRevoked).toMatchObject({ ok: false, code: "grant_inactive" });

    const sameGrantOk = authorizeShadowIntentProposal(plane, testInspector(TENANT), {
      commandId: "authz-fresh-cmd",
      proposalId,
      grantId: "grant-1",
      principalRef: "operator-1",
      trustedTenantId: TENANT,
      confirmedByUser: true,
    });
    expect(sameGrantOk.ok).toBe(true);
    if (sameGrantOk.ok) {
      expect(sameGrantOk.alreadyAuthorized).toBe(true);
    }
  });
});
