import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  createDelegationEvolutionInspector,
  createDiagnosisEvolutionProposalMachine,
} from "./evolution-proposal.js";
import {
  createDiagnosisRemediationMachine,
  createDryRunRemediationExecutor,
  createEvolutionProposalInspector,
  createUnavailableMetricReader,
  createUnavailableRemediationExecutor,
  createUnavailableRemediationStore,
  riskForAction,
} from "./remediation.js";
import type {
  RemediationActionType,
  RemediationExecutor,
  RemediationMetricReader,
} from "./remediation.js";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };
const ACTIONS: RemediationActionType[] = [
  "read_only_check",
  "safe_reversible",
  "configuration_change",
  "doctor_repair",
  "channel_restart",
  "skill_disable",
  "batch_change",
];

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

function target(): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId: TENANT_A,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
  };
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
    allowedActions: ["diagnose", "suggest", ...ACTIONS],
    ...over,
  };
}

function metricReader(
  baseline: number,
  observed: number,
  missing?: string[],
  copiedFindingIds?: string[],
): RemediationMetricReader {
  let reads = 0;
  return {
    read() {
      reads += 1;
      return {
        value: reads === 1 ? baseline : observed,
        evidenceRefs: ["ev-metric"],
        ...(missing ? { missingEvidence: missing } : {}),
        ...(copiedFindingIds ? { copiedFindingIds } : {}),
      };
    },
  };
}

function failingExecutor(reason: "failed" | "unavailable"): RemediationExecutor {
  return {
    ...createDryRunRemediationExecutor(),
    execute: () => ({ ok: false, reason, evidence: [`executor_${reason}`] }),
  };
}

function approvedContext() {
  const grants = createDiagnosisDelegationMachine({
    now: () => Date.parse("2026-09-03T10:00:00.000Z"),
  });
  const enterpriseGrant = grants.dispatch(
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
    grantId: enterpriseGrant.grantId,
  });
  const employeeGrant = grants.dispatch(
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
    grantId: employeeGrant.grantId,
  });
  const grantInspector = createDelegationEvolutionInspector(grants);
  const proposals = createDiagnosisEvolutionProposalMachine({
    now: () => Date.parse("2026-09-03T10:05:00.000Z"),
    grantInspector,
  });
  const suggested = proposals.dispatch({
    commandId: "cmd-p8",
    command: "suggest",
    actor: enterprise,
    trusted: TRUSTED_A,
    grantId: enterpriseGrant.grantId,
    sourceCaseId: "case-open",
    targetDomain: "skill",
    proposedChange: { summary: "candidate only" },
  });
  proposals.dispatch({
    commandId: "cmd-p8-sub",
    command: "submit",
    actor: enterprise,
    trusted: TRUSTED_A,
    proposalId: suggested.proposalId,
  });
  proposals.dispatch({
    commandId: "cmd-p8-apr",
    command: "approve",
    actor: enterprise,
    trusted: TRUSTED_A,
    proposalId: suggested.proposalId,
  });
  const remediations = createDiagnosisRemediationMachine({
    now: () => Date.parse("2026-09-03T10:10:00.000Z"),
    grantInspector,
    proposalInspector: createEvolutionProposalInspector(proposals),
    executor: createDryRunRemediationExecutor(),
    metricReader: metricReader(10, 4),
  });
  return {
    grants,
    grantInspector,
    proposals,
    remediations,
    enterpriseGrantId: enterpriseGrant.grantId!,
    employeeGrantId: employeeGrant.grantId!,
    sourceProposalId: suggested.proposalId,
  };
}

describe("Phase 9 — governed remediation preview and verification", () => {
  it("gates risk levels, previews without side effects, and blocks production actions", () => {
    const ctx = approvedContext();
    expect(riskForAction("read_only_check")).toBe("low");
    expect(riskForAction("safe_reversible")).toBe("medium");
    expect(riskForAction("doctor_repair")).toBe("high");
    const readOnly = ctx.remediations.dispatch({
      commandId: "cmd-ro",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "read_only_check",
    });
    expect(readOnly.status).toBe("PREVIEWED");
    expect(ctx.remediations.getProposal(readOnly.remediationId)?.dryRunPreview?.dryRun).toBe(true);
    expect(
      ctx.remediations.getProposal(readOnly.remediationId)?.dryRunPreview?.sideEffects,
    ).toEqual([]);

    const safe = ctx.remediations.dispatch({
      commandId: "cmd-safe",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "safe_reversible",
    });
    expect(safe.status).toBe("PROPOSED");
    expect(
      ctx.remediations.dispatch({
        commandId: "cmd-safe-prev",
        command: "preview",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: safe.remediationId,
      }).status,
    ).toBe("PREVIEWED");
    expect(
      ctx.remediations.dispatch({
        commandId: "cmd-safe-run",
        command: "execute",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: safe.remediationId,
        executionId: "rex-safe",
      }).status,
    ).toBe("EXECUTED");
    expect(ctx.remediations.getExecution("rex-safe")?.appliedToRuntime).toBe(false);

    for (const actionType of ["doctor_repair", "channel_restart", "skill_disable"] as const) {
      const proposed = ctx.remediations.dispatch({
        commandId: `cmd-${actionType}`,
        command: "propose",
        actor: enterprise,
        trusted: TRUSTED_A,
        sourceProposalId: ctx.sourceProposalId,
        grantId: ctx.enterpriseGrantId,
        target: target(),
        actionType,
      });
      ctx.remediations.dispatch({
        commandId: `cmd-${actionType}-prev`,
        command: "preview",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
      });
      expectCode(
        () =>
          ctx.remediations.dispatch({
            commandId: `cmd-${actionType}-run`,
            command: "execute",
            actor: enterprise,
            trusted: TRUSTED_A,
            remediationId: proposed.remediationId,
          }),
        "approval_required",
      );
      ctx.remediations.dispatch({
        commandId: `cmd-${actionType}-sub`,
        command: "submit",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
      });
      ctx.remediations.dispatch({
        commandId: `cmd-${actionType}-apr`,
        command: "approve",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
      });
      expect(
        ctx.remediations.dispatch({
          commandId: `cmd-${actionType}-exec`,
          command: "execute",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: proposed.remediationId,
        }).status,
      ).toBe("BLOCKED");
    }
  });

  it("enforces the execution state machine, idempotency, and executor outcomes", () => {
    const ctx = approvedContext();
    const proposed = ctx.remediations.dispatch({
      commandId: "cmd-life",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "safe_reversible",
      remediationId: "rem-life",
    });
    expect(
      ctx.remediations.dispatch({
        commandId: "cmd-life",
        command: "propose",
        actor: enterprise,
        trusted: TRUSTED_A,
        sourceProposalId: ctx.sourceProposalId,
        grantId: ctx.enterpriseGrantId,
        target: target(),
        actionType: "safe_reversible",
        remediationId: "rem-life",
      }).idempotent,
    ).toBe(true);
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-life-run-early",
          command: "execute",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: proposed.remediationId,
        }),
      "preview_required",
    );
    ctx.remediations.dispatch({
      commandId: "cmd-life-prev",
      command: "preview",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: proposed.remediationId,
    });
    const executed = ctx.remediations.dispatch({
      commandId: "cmd-life-run",
      command: "execute",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: proposed.remediationId,
      executionId: "rex-life",
    });
    expect(
      ctx.remediations.dispatch({
        commandId: "cmd-life-run",
        command: "execute",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
        executionId: "rex-life",
      }).idempotent,
    ).toBe(true);
    expect(executed.executionId).toBe("rex-life");
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-life-apr",
          command: "approve",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: proposed.remediationId,
        }),
      "illegal_transition",
    );

    const failedMachine = createDiagnosisRemediationMachine({
      now: () => Date.parse("2026-09-03T10:10:00.000Z"),
      grantInspector: ctx.grantInspector,
      proposalInspector: createEvolutionProposalInspector(ctx.proposals),
      executor: failingExecutor("failed"),
    });
    const failProp = failedMachine.dispatch({
      commandId: "cmd-fail",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "safe_reversible",
    });
    failedMachine.dispatch({
      commandId: "cmd-fail-prev",
      command: "preview",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: failProp.remediationId,
    });
    const failed = failedMachine.dispatch({
      commandId: "cmd-fail-run",
      command: "execute",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: failProp.remediationId,
    });
    expect(failed.status).toBe("FAILED");
    expect(failedMachine.getProposal(failProp.remediationId)?.failureEvidence).toEqual([
      "executor_failed",
    ]);

    const downExec = createDiagnosisRemediationMachine({
      now: () => Date.parse("2026-09-03T10:10:00.000Z"),
      grantInspector: ctx.grantInspector,
      proposalInspector: createEvolutionProposalInspector(ctx.proposals),
      executor: createUnavailableRemediationExecutor(),
    });
    expectCode(
      () =>
        downExec.dispatch({
          commandId: "cmd-unavail",
          command: "propose",
          actor: enterprise,
          trusted: TRUSTED_A,
          sourceProposalId: ctx.sourceProposalId,
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "executor_unavailable",
    );
  });

  it("verifies baseline/observation windows and cannot mark regressions as success", () => {
    const ctx = approvedContext();
    const run = (observed: number, missing?: string[]) => {
      const label = missing ? missing.join("-") : "ok";
      const machine = createDiagnosisRemediationMachine({
        now: () => Date.parse("2026-09-03T10:40:00.000Z"),
        grantInspector: ctx.grantInspector,
        proposalInspector: createEvolutionProposalInspector(ctx.proposals),
        executor: createDryRunRemediationExecutor(),
        metricReader: metricReader(10, observed, missing),
      });
      const proposed = machine.dispatch({
        commandId: `cmd-v-${observed}-${label}`,
        command: "propose",
        actor: enterprise,
        trusted: TRUSTED_A,
        sourceProposalId: ctx.sourceProposalId,
        grantId: ctx.enterpriseGrantId,
        target: target(),
        actionType: "read_only_check",
      });
      machine.dispatch({
        commandId: `cmd-v-run-${observed}-${label}`,
        command: "execute",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
      });
      return machine.dispatch({
        commandId: `cmd-v-ver-${observed}-${label}`,
        command: "verify",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
        expectedOutcome: { metric: "error_rate", direction: "decrease" },
      });
    };
    expect(run(4).status).toBe("VERIFIED");
    expect(run(10).reason).toBe("unchanged");
    expect(run(10).status).toBe("VERIFIED");
    expect(run(18).status).toBe("FAILED");
    expect(run(18).reason).toBe("regressed");
    const inconclusive = run(1, ["metric_gap"]);
    expect(inconclusive.status).toBe("FAILED");
    expect(inconclusive.reason).toBe("inconclusive");
    const copied = createDiagnosisRemediationMachine({
      now: () => Date.parse("2026-09-03T10:40:00.000Z"),
      grantInspector: ctx.grantInspector,
      proposalInspector: createEvolutionProposalInspector(ctx.proposals),
      executor: createDryRunRemediationExecutor(),
      metricReader: metricReader(10, 4, undefined, ["find-a"]),
    });
    const copiedProp = copied.dispatch({
      commandId: "cmd-copy",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "read_only_check",
    });
    copied.dispatch({
      commandId: "cmd-copy-run",
      command: "execute",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: copiedProp.remediationId,
    });
    expectCode(
      () =>
        copied.dispatch({
          commandId: "cmd-copy-ver",
          command: "verify",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: copiedProp.remediationId,
        }),
      "verification_copied_finding",
    );
  });

  it("requires live P7/P8 grants, blocks scope widening, and fail-closes unavailable deps", () => {
    const ctx = approvedContext();
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-p8-skip",
          command: "propose",
          actor: enterprise,
          trusted: TRUSTED_A,
          sourceProposalId: "missing-p8",
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "not_found",
    );
    const pending = ctx.proposals.dispatch({
      commandId: "cmd-p8-pending",
      command: "suggest",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: ctx.enterpriseGrantId,
      sourceCaseId: "case-open",
      targetDomain: "skill",
      proposedChange: { summary: "not approved" },
    });
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-p8-early",
          command: "propose",
          actor: enterprise,
          trusted: TRUSTED_A,
          sourceProposalId: pending.proposalId,
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "p8_approval_required",
    );
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-cross",
          command: "propose",
          actor: platform,
          trusted: TRUSTED_PLATFORM,
          sourceProposalId: ctx.sourceProposalId,
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "dual_authorization_required",
    );
    const cross = ctx.remediations.dispatch({
      commandId: "cmd-cross-ok",
      command: "propose",
      actor: platform,
      trusted: TRUSTED_PLATFORM,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      platformGrantId: ctx.enterpriseGrantId,
      enterpriseGrantId: ctx.enterpriseGrantId,
      employeeGrantId: ctx.employeeGrantId,
      target: target(),
      actionType: "read_only_check",
    });
    expect(cross.status).toBe("PREVIEWED");
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-emp-up",
          command: "propose",
          actor: employee,
          trusted: TRUSTED_A,
          sourceProposalId: ctx.sourceProposalId,
          grantId: ctx.enterpriseGrantId,
          target: { ...target(), tenantId: TENANT_B },
          actionType: "read_only_check",
        }),
      "tenant_mismatch",
    );

    ctx.grants.dispatch({
      commandId: "cmd-rev-g",
      command: "revoke",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: ctx.enterpriseGrantId,
    });
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-after-rev",
          command: "execute",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: cross.remediationId,
        }),
      "grant_revoked",
    );

    const down = createDiagnosisRemediationMachine({
      store: createUnavailableRemediationStore(),
      grantInspector: ctx.grantInspector,
    });
    expectCode(
      () =>
        down.dispatch({
          commandId: "cmd-down",
          command: "propose",
          actor: enterprise,
          trusted: TRUSTED_A,
          sourceProposalId: ctx.sourceProposalId,
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "remediation_store_unavailable",
    );
    expectCode(
      () =>
        down.dispatch({
          commandId: "cmd-session",
          command: "propose",
          actor: enterprise,
          trusted: TRUSTED_A,
          sessionTenantId: TENANT_A,
          sourceProposalId: ctx.sourceProposalId,
          grantId: ctx.enterpriseGrantId,
          target: target(),
          actionType: "read_only_check",
        }),
      "untrusted_tenant_source",
    );
    expect(createUnavailableMetricReader).toBeTypeOf("function");
  });

  it("rolls back only through the governance gate", () => {
    const ctx = approvedContext();
    const proposed = ctx.remediations.dispatch({
      commandId: "cmd-rb",
      command: "propose",
      actor: enterprise,
      trusted: TRUSTED_A,
      sourceProposalId: ctx.sourceProposalId,
      grantId: ctx.enterpriseGrantId,
      target: target(),
      actionType: "safe_reversible",
    });
    expectCode(
      () =>
        ctx.remediations.dispatch({
          commandId: "cmd-rb-early",
          command: "rollback",
          actor: enterprise,
          trusted: TRUSTED_A,
          remediationId: proposed.remediationId,
        }),
      "illegal_transition",
    );
    ctx.remediations.dispatch({
      commandId: "cmd-rb-prev",
      command: "preview",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: proposed.remediationId,
    });
    ctx.remediations.dispatch({
      commandId: "cmd-rb-run",
      command: "execute",
      actor: enterprise,
      trusted: TRUSTED_A,
      remediationId: proposed.remediationId,
    });
    expect(
      ctx.remediations.dispatch({
        commandId: "cmd-rb-do",
        command: "rollback",
        actor: enterprise,
        trusted: TRUSTED_A,
        remediationId: proposed.remediationId,
      }).status,
    ).toBe("ROLLED_BACK");
    expect(
      ctx.remediations.getExecution(
        ctx.remediations.getProposal(proposed.remediationId)!.executionRef!,
      )?.status,
    ).toBe("ROLLED_BACK");
  });

  it("does not call Doctor, Channel, Skill writes, or runtime mutation", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "remediation.ts"),
      "utf8",
    );
    expect(source).toContain("Does not call Doctor --fix");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("publishPatternCandidateAsDraftSkill");
    expect(source).not.toContain("applyGovernanceRuntimeAction");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("setInterval");
  });
});
