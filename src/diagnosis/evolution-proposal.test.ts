import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDiagnosisDelegationMachine, FORBIDDEN_EVOLUTION_MUTATIONS } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  createDelegationEvolutionInspector,
  createDiagnosisEvolutionProposalMachine,
  createUnavailableEvolutionInspector,
  createUnavailableEvolutionProposalStore,
} from "./evolution-proposal.js";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

const platform: DelegationActor = { role: "platform", principal: principal("plat-admin", null) };
const enterprise: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", TENANT_A),
};
const employee: DelegationActor = { role: "employee", principal: principal("user-a", TENANT_A) };

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(isDiagnosisContractError(err)).toBe(true);
    if (isDiagnosisContractError(err)) {
      expect(err.code).toBe(code);
    }
  }
}

function request(
  over: Partial<DelegationCommandInput> &
    Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
) {
  return {
    command: "request" as const,
    expiresAt: "2026-09-03T12:00:00.000Z",
    targetTenant: TENANT_A,
    allowedEvidence: ["ev-a"],
    allowedActions: ["diagnose", "suggest"],
    ...over,
  };
}

function approveEnterpriseGrant() {
  const grants = createDiagnosisDelegationMachine({
    now: () => Date.parse("2026-09-03T10:00:00.000Z"),
  });
  const requested = grants.dispatch(
    request({
      commandId: "cmd-ent-grant",
      actor: platform,
      trusted: TRUSTED_PLATFORM,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
    }),
  );
  grants.dispatch({
    commandId: "cmd-ent-ok",
    command: "approve",
    actor: enterprise,
    trusted: TRUSTED_A,
    grantId: requested.grantId,
  });
  const employeeReq = grants.dispatch(
    request({
      commandId: "cmd-emp-grant",
      actor: enterprise,
      trusted: TRUSTED_A,
      scenario: "enterprise_to_employee",
      approver: employee,
      grantee: employee,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "cmd-emp-ok",
    command: "approve",
    actor: employee,
    trusted: TRUSTED_A,
    grantId: employeeReq.grantId,
  });
  grants.dispatch({
    commandId: "cmd-emp-share",
    command: "consume",
    actor: employee,
    trusted: TRUSTED_A,
    grantId: employeeReq.grantId,
    shareFindingIds: ["find-a"],
    shareReportIds: ["rep-a"],
    shareEvidenceIds: ["ev-a"],
    outputs: [{ kind: "EvolutionProposal", id: "evo-src", redacted: true }],
  });
  return {
    grants,
    enterpriseGrantId: requested.grantId!,
    employeeGrantId: employeeReq.grantId!,
    employeeMissionId: employeeReq.missionId!,
    inspector: createDelegationEvolutionInspector(grants),
  };
}

function approveEmployeeGrant(nowMs = Date.parse("2026-09-03T10:20:00.000Z")) {
  const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
  const requested = grants.dispatch(
    request({
      commandId: "cmd-emp-live",
      actor: enterprise,
      trusted: TRUSTED_A,
      scenario: "enterprise_to_employee",
      approver: employee,
      grantee: employee,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "cmd-emp-live-ok",
    command: "approve",
    actor: employee,
    trusted: TRUSTED_A,
    grantId: requested.grantId,
  });
  return {
    grants,
    grantId: requested.grantId!,
    inspector: createDelegationEvolutionInspector(grants),
  };
}

describe("Phase 8 — governed evolution proposals", () => {
  it("projects Skill/DNA/Capsule/Fabric/Governance candidates without applying them", () => {
    const { inspector, enterpriseGrantId } = approveEnterpriseGrant();
    const machine = createDiagnosisEvolutionProposalMachine({
      now: () => Date.parse("2026-09-03T10:05:00.000Z"),
      grantInspector: inspector,
    });
    const suggested = machine.dispatch({
      commandId: "cmd-skill",
      command: "suggest",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: enterpriseGrantId,
      sourceCaseId: "case-open",
      targetDomain: "skill",
      proposedChange: { summary: "candidate skill for timeout retry", action: "suggest" },
      expectedEffect: "surface a Pattern Candidate",
      riskLevel: "low",
    });
    expect(suggested.status).toBe("SUGGESTED");
    const proposal = machine.getProposal(suggested.proposalId)!;
    const candidate = machine.getCandidate(suggested.candidateRef!)!;
    expect(proposal.status).toBe("SUGGESTED");
    expect(candidate.kind).toBe("PatternCandidate");
    expect(candidate.status).toBe("candidate");
    expect(candidate.autoApplied).toBe(false);
    expect(candidate).not.toBe(proposal as never);

    expect(
      machine.dispatch({
        commandId: "cmd-dna",
        command: "suggest",
        actor: enterprise,
        trusted: TRUSTED_A,
        grantId: enterpriseGrantId,
        sourceCaseId: "case-open",
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "tighten retry habit" },
      }).candidateRef,
    ).toMatch(/^cand:/);
    expect(
      machine.getCandidate(
        machine.dispatch({
          commandId: "cmd-cap",
          command: "suggest",
          actor: enterprise,
          trusted: TRUSTED_A,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "collaboration_capsule",
          proposedChange: { summary: "capsule candidate from consult" },
        }).candidateRef!,
      )?.kind,
    ).toBe("ExperienceCapsuleCandidate");
    expect(
      machine.getCandidate(
        machine.dispatch({
          commandId: "cmd-fab",
          command: "suggest",
          actor: enterprise,
          trusted: TRUSTED_A,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "fabric_feedback",
          proposedChange: { summary: "tighten sandbox on tool timeout" },
        }).candidateRef!,
      ),
    ).toMatchObject({ kind: "FabricFeedbackSignal", autoApplied: false });
    expect(
      machine.getCandidate(
        machine.dispatch({
          commandId: "cmd-gov",
          command: "suggest",
          actor: enterprise,
          trusted: TRUSTED_A,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "evolution_governance",
          proposedChange: { summary: "link verification receipt only" },
        }).candidateRef!,
      )?.kind,
    ).toBe("EvolutionGovernanceProposal");
  });

  it("keeps suggestion, approval, application, and verification as distinct objects", () => {
    const { inspector, enterpriseGrantId } = approveEnterpriseGrant();
    const machine = createDiagnosisEvolutionProposalMachine({
      now: () => Date.parse("2026-09-03T10:10:00.000Z"),
      grantInspector: inspector,
    });
    const suggested = machine.dispatch({
      commandId: "cmd-life",
      command: "suggest",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: enterpriseGrantId,
      sourceCaseId: "case-open",
      targetDomain: "skill",
      proposedChange: { summary: "governed skill candidate" },
    });
    expect(
      machine.dispatch({
        commandId: "cmd-life",
        command: "suggest",
        actor: enterprise,
        trusted: TRUSTED_A,
        grantId: enterpriseGrantId,
      }).idempotent,
    ).toBe(true);
    expect(
      machine.dispatch({
        commandId: "cmd-life-sub",
        command: "submit",
        actor: enterprise,
        trusted: TRUSTED_A,
        proposalId: suggested.proposalId,
      }).status,
    ).toBe("PENDING_APPROVAL");
    const approved = machine.dispatch({
      commandId: "cmd-life-apr",
      command: "approve",
      actor: enterprise,
      trusted: TRUSTED_A,
      proposalId: suggested.proposalId,
    });
    expect(approved.status).toBe("APPROVED");
    expect(machine.getApproval(approved.approvalRef!)?.kind).toBe("approval");
    const applied = machine.dispatch({
      commandId: "cmd-life-app",
      command: "apply",
      actor: enterprise,
      trusted: TRUSTED_A,
      proposalId: suggested.proposalId,
    });
    expect(machine.getApplication(applied.applicationRef!)?.appliedToRuntime).toBe(false);
    const verified = machine.dispatch({
      commandId: "cmd-life-ver",
      command: "verify",
      actor: enterprise,
      trusted: TRUSTED_A,
      proposalId: suggested.proposalId,
    });
    expect(machine.getVerification(verified.verificationRef!)?.kind).toBe("verification");
    expect(machine.getProposal(suggested.proposalId)?.status).toBe("VERIFIED");
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-life-bad",
          command: "apply",
          actor: enterprise,
          trusted: TRUSTED_A,
          proposalId: suggested.proposalId,
        }),
      "illegal_transition",
    );
  });

  it("requires P7 grants and blocks expired, revoked, suspended, or consumed grants", () => {
    let nowMs = Date.parse("2026-09-03T10:20:00.000Z");
    const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
    const requested = grants.dispatch(
      request({
        commandId: "cmd-live-g",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    grants.dispatch({
      commandId: "cmd-live-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    const machine = createDiagnosisEvolutionProposalMachine({
      now: () => nowMs,
      grantInspector: createDelegationEvolutionInspector(grants),
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-no-grant",
          command: "suggest",
          actor: employee,
          trusted: TRUSTED_A,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "no grant" },
        }),
      "missing_field",
    );
    const live = machine.dispatch({
      commandId: "cmd-from-emp",
      command: "suggest",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
      sourceConversationRunId: "conv-1",
      targetDomain: "skill",
      proposedChange: { summary: "employee scoped candidate" },
      confidentialityScope: "personal",
    });
    expect(machine.exportProposal(live.proposalId).confidentialityScope).toBe("personal");

    grants.dispatch({
      commandId: "cmd-rev-g",
      command: "revoke",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    expectCode(() => machine.exportProposal(live.proposalId), "grant_revoked");

    const expiring = grants.dispatch(
      request({
        commandId: "cmd-exp-g",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
        expiresAt: "2026-09-03T10:21:00.000Z",
      }),
    );
    grants.dispatch({
      commandId: "cmd-exp-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: expiring.grantId,
    });
    nowMs += 120_000;
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-exp-suggest",
          command: "suggest",
          actor: employee,
          trusted: TRUSTED_A,
          grantId: expiring.grantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "expired grant" },
        }),
      "grant_expired",
    );

    const suspended = approveEmployeeGrant();
    suspended.grants.dispatch({
      commandId: "cmd-sus-g",
      command: "suspend",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: suspended.grantId,
    });
    expectCode(
      () =>
        createDiagnosisEvolutionProposalMachine({
          now: () => Date.parse("2026-09-03T10:20:00.000Z"),
          grantInspector: suspended.inspector,
        }).dispatch({
          commandId: "cmd-sus-suggest",
          command: "suggest",
          actor: employee,
          trusted: TRUSTED_A,
          grantId: suspended.grantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "suspended" },
        }),
      "grant_suspended",
    );

    const consumed = approveEmployeeGrant();
    consumed.grants.dispatch({
      commandId: "cmd-con-g",
      command: "consume",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: consumed.grantId,
    });
    expectCode(
      () =>
        createDiagnosisEvolutionProposalMachine({
          now: () => Date.parse("2026-09-03T10:20:00.000Z"),
          grantInspector: consumed.inspector,
        }).dispatch({
          commandId: "cmd-con-suggest",
          command: "suggest",
          actor: employee,
          trusted: TRUSTED_A,
          grantId: consumed.grantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "consumed" },
        }),
      "grant_consumed",
    );
  });

  it("keeps platform proposals on multi-enterprise redacted summaries and rejects raw evidence", () => {
    const { inspector, enterpriseGrantId } = approveEnterpriseGrant();
    const machine = createDiagnosisEvolutionProposalMachine({
      now: () => Date.parse("2026-09-03T10:30:00.000Z"),
      grantInspector: inspector,
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-plat-raw",
          command: "suggest",
          actor: platform,
          trusted: TRUSTED_PLATFORM,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          confidentialityScope: "platform",
          sourceEvidenceRefs: ["ev-a"],
          proposedChange: { summary: "illegal raw aggregate" },
          redactedEnterpriseSummaries: [
            { tenantId: TENANT_A, summary: "timeout redacted" },
            { tenantId: TENANT_B, summary: "retry redacted" },
          ],
        }),
      "raw_evidence_forbidden",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-plat-one",
          command: "suggest",
          actor: platform,
          trusted: TRUSTED_PLATFORM,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          confidentialityScope: "platform",
          proposedChange: { summary: "single tenant" },
          redactedEnterpriseSummaries: [{ tenantId: TENANT_A, summary: "only one" }],
        }),
      "redacted_summaries_required",
    );
    const ok = machine.dispatch({
      commandId: "cmd-plat-ok",
      command: "suggest",
      actor: platform,
      trusted: TRUSTED_PLATFORM,
      grantId: enterpriseGrantId,
      sourceCaseId: "case-open",
      targetDomain: "skill",
      confidentialityScope: "platform",
      proposedChange: { summary: "cross-tenant pattern candidate" },
      redactedEnterpriseSummaries: [
        { tenantId: TENANT_A, summary: "timeout redacted" },
        { tenantId: TENANT_B, summary: "retry redacted" },
      ],
    });
    expect(machine.getProposal(ok.proposalId)?.tenantScope).toBeNull();
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-emp-up",
          command: "suggest",
          actor: employee,
          trusted: TRUSTED_A,
          grantId: enterpriseGrantId,
          sourceCaseId: "case-open",
          targetDomain: "skill",
          confidentialityScope: "enterprise",
          proposedChange: { summary: "employee widening" },
        }),
      "scope_widened",
    );
  });

  it("fail-closes when the store or grant inspector is unavailable", () => {
    const down = createDiagnosisEvolutionProposalMachine({
      store: createUnavailableEvolutionProposalStore(),
      grantInspector: createUnavailableEvolutionInspector(),
    });
    expectCode(
      () =>
        down.dispatch({
          commandId: "cmd-down",
          command: "suggest",
          actor: enterprise,
          trusted: TRUSTED_A,
          grantId: "grant:x",
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "down" },
        }),
      "evolution_store_unavailable",
    );
    expectCode(
      () =>
        down.dispatch({
          commandId: "cmd-session",
          command: "suggest",
          actor: enterprise,
          trusted: TRUSTED_A,
          sessionTenantId: TENANT_A,
          grantId: "grant:x",
          sourceCaseId: "case-open",
          targetDomain: "skill",
          proposedChange: { summary: "untrusted" },
        }),
      "untrusted_tenant_source",
    );
  });

  it("does not write Skill, Working DNA, Capsule, Fabric policy, or runtime actions", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "evolution-proposal.ts"),
      "utf8",
    );
    expect(source).toContain("Does not publish");
    expect(source).not.toContain("publishPatternCandidateAsDraftSkill");
    expect(source).not.toContain("writeRobotWorkingStyle");
    expect(source).not.toContain("applyWorkingStyleDelta");
    expect(source).not.toContain("transitionGroupMemoryCapsule");
    expect(source).not.toContain("applyGovernanceRuntimeAction");
    expect(source).not.toContain("runEvolutionGovernanceTick");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("setInterval");
    expect(FORBIDDEN_EVOLUTION_MUTATIONS).toContain("publish_skill");
  });
});
