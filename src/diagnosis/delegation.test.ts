import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import {
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
} from "./daibai-delivery.js";
import {
  createDiagnosisDelegationMachine,
  createMemoryDelegationStore,
  createUnavailableDelegationStore,
  FORBIDDEN_EVOLUTION_MUTATIONS,
} from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import type { DiagnosticSignal } from "./signal.js";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

const platform: DelegationActor = {
  role: "platform",
  principal: principal("plat-admin", null),
};
const enterprise: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", TENANT_A),
};
const employee: DelegationActor = {
  role: "employee",
  principal: principal("user-a", TENANT_A),
};

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

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p7:tenant-fixture-a:session:session-a:1",
    kind: "scheduled",
    tenantId: TENANT_A,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p7",
    status: "open",
    target: target(),
    evidenceIds: ["ev-a"],
    findingIds: ["find-a"],
    caseId: "case-open",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-03T02:00:00.000Z",
    lastSeenAt: "2026-09-03T02:00:00.000Z",
    expiresAt: "2026-09-03T04:00:00.000Z",
    ...over,
  };
}

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

function baseRequest(
  over: Partial<DelegationCommandInput> &
    Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
): DelegationCommandInput {
  return {
    command: "request",
    expiresAt: "2026-09-03T04:00:00.000Z",
    targetTenant: TENANT_A,
    allowedEvidence: ["ev-a"],
    allowedActions: ["diagnose"],
    ...over,
  };
}

describe("platform trusted context guard", () => {
  const other: DelegationActor = {
    role: "enterprise",
    principal: principal("ent-other", "tenant-fixture-b"),
  };
  const otherEmployee: DelegationActor = {
    role: "employee",
    principal: principal("user-b", "tenant-fixture-b"),
  };

  function countingStore() {
    const store = createMemoryDelegationStore();
    let writes = 0;
    return {
      writes: () => writes,
      store: new Proxy(store, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") {
            return value;
          }
          if (String(prop).startsWith("put")) {
            return (...args: unknown[]) => {
              writes += 1;
              return Reflect.apply(value, target, args);
            };
          }
          return value.bind(target);
        },
      }),
    };
  }

  it("rejects a raw platform actor in an enterprise trusted context with zero writes", () => {
    const counted = countingStore();
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
      store: counted.store,
    });
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-raw-platform-enterprise",
            actor: platform,
            trusted: TRUSTED_A,
            scenario: "platform_to_enterprise",
            approver: enterprise,
            grantee: enterprise,
          }),
        ),
      "tenant_mismatch",
    );
    expect(counted.writes()).toBe(0);
    expect(machine.getGrant("grant:cmd-raw-platform-enterprise")).toBeUndefined();
    expect(machine.getMission("mission:cmd-raw-platform-enterprise")).toBeUndefined();
  });

  it("accepts a raw platform actor only with platform trusted context", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
    });
    const receipt = machine.dispatch(
      baseRequest({
        commandId: "cmd-raw-platform",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_enterprise",
        approver: enterprise,
        grantee: enterprise,
      }),
    );
    expect(receipt.status).toBe("REQUESTED");
  });

  it("keeps same-tenant enterprise requests and rejects cross-tenant actors", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
    });
    expect(
      machine.dispatch(
        baseRequest({
          commandId: "cmd-same-tenant",
          actor: enterprise,
          trusted: TRUSTED_A,
          scenario: "enterprise_to_employee",
          approver: employee,
          grantee: employee,
          targetPrincipal: employee.principal.principalId,
        }),
      ).status,
    ).toBe("REQUESTED");
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-cross-enterprise",
            actor: other,
            trusted: TRUSTED_A,
            scenario: "enterprise_to_employee",
            approver: employee,
            grantee: employee,
            targetPrincipal: employee.principal.principalId,
          }),
        ),
      "tenant_mismatch",
    );
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-cross-employee",
            actor: otherEmployee,
            trusted: TRUSTED_A,
            scenario: "enterprise_to_employee",
            approver: employee,
            grantee: employee,
            targetPrincipal: employee.principal.principalId,
          }),
        ),
      "tenant_mismatch",
    );
  });

  it("does not let commandId replay skip the trusted-context check", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
    });
    const first = machine.dispatch(
      baseRequest({
        commandId: "cmd-replay-guard",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_enterprise",
        approver: enterprise,
        grantee: enterprise,
      }),
    );
    expect(first.status).toBe("REQUESTED");
    const grantsBefore = machine.getGrant(first.grantId!)?.status;
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-replay-guard",
            actor: platform,
            trusted: TRUSTED_A,
            scenario: "platform_to_enterprise",
            approver: enterprise,
            grantee: enterprise,
          }),
        ),
      "tenant_mismatch",
    );
    expect(machine.getGrant(first.grantId!)?.status).toBe(grantsBefore);
  });
});

describe("Phase 7 — graded authorization and remote consult", () => {
  it("authorizes platform → enterprise and enterprise → employee", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
    });
    const requested = machine.dispatch(
      baseRequest({
        commandId: "cmd-p2e",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_enterprise",
        approver: enterprise,
        grantee: enterprise,
      }),
    );
    expect(requested.status).toBe("REQUESTED");
    expect(
      machine.dispatch({
        ...requested,
        commandId: "cmd-p2e",
        command: "request",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
      }).idempotent,
    ).toBe(true);
    const approved = machine.dispatch({
      commandId: "cmd-p2e-approve",
      command: "approve",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    expect(approved.status).toBe("APPROVED");
    expect(machine.getGrant(requested.grantId!)?.canSubdelegate).toBe(false);

    const employeeReq = machine.dispatch(
      baseRequest({
        commandId: "cmd-e2u",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    expect(
      machine.dispatch({
        commandId: "cmd-e2u-approve",
        command: "approve",
        actor: employee,
        trusted: TRUSTED_A,
        grantId: employeeReq.grantId,
      }).status,
    ).toBe("APPROVED");
  });

  it("requires dual authorization for platform → employee and rejects bypasses", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:10:00.000Z"),
    });
    const dual = machine.dispatch(
      baseRequest({
        commandId: "cmd-dual",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_employee",
        approver: enterprise,
        grantee: employee,
        targetPrincipal: "user-a",
        missionId: "msn-dual",
      }),
    );
    expect(dual.reason).toBe("dual_authorization_required");
    const mission = machine.getMission("msn-dual");
    expect(mission?.requiredGrantIds).toHaveLength(2);
    expect(mission?.status).toBe("REQUESTED");

    const [enterpriseGrantId, employeeGrantId] = mission?.requiredGrantIds ?? [];
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-plat-approve-emp",
          command: "approve",
          actor: platform,
          trusted: TRUSTED_PLATFORM,
          grantId: employeeGrantId,
        }),
      "unauthorized",
    );
    machine.dispatch({
      commandId: "cmd-dual-ent",
      command: "approve",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: enterpriseGrantId,
      missionId: "msn-dual",
    });
    expect(machine.getMission("msn-dual")?.status).toBe("REQUESTED");
    machine.dispatch({
      commandId: "cmd-dual-emp",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: employeeGrantId,
      missionId: "msn-dual",
    });
    expect(machine.getMission("msn-dual")?.status).toBe("APPROVED");

    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-bypass-ent",
            actor: platform,
            trusted: TRUSTED_PLATFORM,
            scenario: "enterprise_to_employee",
            approver: employee,
            grantee: employee,
            targetPrincipal: "user-a",
          }),
        ),
      "unauthorized",
    );
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-emp-up",
            actor: employee,
            trusted: TRUSTED_A,
            scenario: "platform_to_enterprise",
            approver: enterprise,
            grantee: enterprise,
          }),
        ),
      "unauthorized",
    );
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-ent-skip-emp",
            actor: enterprise,
            trusted: TRUSTED_A,
            scenario: "enterprise_to_employee",
            approver: enterprise,
            grantee: employee,
            targetPrincipal: "user-a",
          }),
        ),
      "unauthorized",
    );
  });

  it("blocks subdelegation, expiry, revoke, suspend, and consumed one-shot grants", () => {
    let nowMs = Date.parse("2026-09-03T03:20:00.000Z");
    const store = createMemoryDelegationStore();
    const machine = createDiagnosisDelegationMachine({ now: () => nowMs, store });
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-sub",
            actor: platform,
            trusted: TRUSTED_PLATFORM,
            scenario: "platform_to_enterprise",
            approver: enterprise,
            grantee: enterprise,
            canSubdelegate: true,
          }),
        ),
      "subdelegate_forbidden",
    );
    const parent = machine.dispatch(
      baseRequest({
        commandId: "cmd-parent",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_enterprise",
        approver: enterprise,
        grantee: enterprise,
      }),
    );
    machine.dispatch({
      commandId: "cmd-parent-ok",
      command: "approve",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId: parent.grantId,
    });
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-child",
            actor: enterprise,
            trusted: TRUSTED_A,
            scenario: "enterprise_to_employee",
            approver: employee,
            grantee: employee,
            targetPrincipal: "user-a",
            parentGrantId: parent.grantId,
          }),
        ),
      "subdelegate_forbidden",
    );

    const expiring = machine.dispatch(
      baseRequest({
        commandId: "cmd-exp",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
        expiresAt: "2026-09-03T03:21:00.000Z",
        oneShot: true,
      }),
    );
    machine.dispatch({
      commandId: "cmd-exp-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: expiring.grantId,
    });
    nowMs += 120_000;
    expect(machine.getGrant(expiring.grantId!)?.status).toBe("EXPIRED");

    const live = machine.dispatch(
      baseRequest({
        commandId: "cmd-live",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
        oneShot: true,
      }),
    );
    machine.dispatch({
      commandId: "cmd-live-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: live.grantId,
    });
    machine.dispatch({
      commandId: "cmd-live-consume",
      command: "consume",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: live.grantId,
      shareFindingIds: ["find-a"],
      shareReportIds: ["rep-a"],
      outputs: [{ kind: "EvolutionProposal", id: "evo-1", redacted: true }],
    });
    expect(machine.getGrant(live.grantId!)?.status).toBe("CONSUMED");
    expect(machine.getReportShare(`rsh:${live.grantId}`)?.findingIds).toEqual(["find-a"]);
    expect(machine.getEvidenceShare(`esh:${live.grantId}`)).toBeUndefined();

    const suspendable = machine.dispatch(
      baseRequest({
        commandId: "cmd-sus",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    machine.dispatch({
      commandId: "cmd-sus-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: suspendable.grantId,
    });
    expect(
      machine.dispatch({
        commandId: "cmd-sus-hold",
        command: "suspend",
        actor: employee,
        trusted: TRUSTED_A,
        grantId: suspendable.grantId,
      }).status,
    ).toBe("SUSPENDED");
    expect(
      machine.dispatch({
        commandId: "cmd-rev",
        command: "revoke",
        actor: enterprise,
        trusted: TRUSTED_A,
        grantId: suspendable.grantId,
      }).status,
    ).toBe("REVOKED");
  });

  it("guards P5 delivery and resumes P6 after grant approval", async () => {
    const nowMs = Date.parse("2026-09-03T03:30:00.000Z");
    const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
    const requested = grants.dispatch(
      baseRequest({
        commandId: "cmd-p5",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    grants.dispatch({
      commandId: "cmd-p5-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    const transport = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => nowMs,
      transport,
      delegationGuard: {
        assertDeliverable: (input) => grants.assertDeliverable(input),
      },
    });
    const missing = await queue.enqueue(signal(), { sessionDomain: "employee" });
    expect(missing.status).toBe("rejected");
    expect(missing.reason).toBe("delegation_required");
    const accepted = await queue.enqueue(signal(), {
      sessionDomain: "employee",
      principalId: employee.principal.principalId,
      delegationGrantId: `dlg:${requested.grantId}`,
    });
    expect(accepted.status).toBe("accepted");

    const conversation = createConversationDiagnosisMachine({
      now: () => nowMs,
      grantInspector: { inspect: (grantId) => grants.inspectGrant(grantId) },
    });
    const started = conversation.dispatch({
      commandId: "cmd-p6-start",
      command: "start",
      signal: signal({ signalId: "sig-p6-grant" }),
      principal: employee.principal,
      trusted: TRUSTED_A,
    });
    const waiting = conversation.dispatch({
      commandId: "cmd-p6-wait",
      command: "ask",
      conversationRunId: started.conversationRunId,
      question: "approve employee consult?",
      authorization: {
        authorizationId: "auth-p7",
        capability: "diagnosis:read",
        expiresAt: "2026-09-03T04:30:00.000Z",
        grantId: requested.grantId,
        missionId: requested.missionId,
      },
      principal: employee.principal,
      trusted: TRUSTED_A,
    });
    expect(waiting.state).toBe("WAITING_AUTHORIZATION");
    expect(conversation.get(started.conversationRunId)?.requiredAuthorization?.grantId).toBe(
      requested.grantId,
    );
    expect(
      conversation.dispatch({
        commandId: "cmd-p6-approve",
        command: "approve",
        conversationRunId: started.conversationRunId,
        principal: employee.principal,
        trusted: TRUSTED_A,
      }).state,
    ).toBe("TRIAGING");

    grants.dispatch({
      commandId: "cmd-p6-revoke",
      command: "revoke",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    expectCode(
      () =>
        conversation.dispatch({
          commandId: "cmd-p6-collect",
          command: "answer",
          conversationRunId: started.conversationRunId,
          principal: employee.principal,
          trusted: TRUSTED_A,
        }),
      "authorization_revoked",
    );
  });

  it("binds P5 delivery to the delegated Da Bai principal", async () => {
    let nowMs = Date.parse("2026-09-03T03:40:00.000Z");
    const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
    const requested = grants.dispatch(
      baseRequest({
        commandId: "cmd-bind",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    grants.dispatch({
      commandId: "cmd-bind-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    const grantId = `dlg:${requested.grantId}`;
    const deliver = (auth: {
      sessionDomain?: "platform" | "enterprise" | "employee";
      principalId?: string;
      delegationGrantId?: string;
    }) =>
      grants.assertDeliverable({
        signal: signal(),
        auth: { ...auth, delegationGrantId: auth.delegationGrantId ?? grantId },
        route: "employee",
      });

    expect(
      deliver({
        sessionDomain: "employee",
        principalId: employee.principal.principalId,
      }),
    ).toEqual({ ok: true });

    const transport = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => nowMs,
      transport,
      delegationGuard: { assertDeliverable: (input) => grants.assertDeliverable(input) },
    });
    expect(
      (
        await queue.enqueue(signal({ signalId: "sig:p7:bind-ok" }), {
          sessionDomain: "employee",
          principalId: employee.principal.principalId,
          delegationGrantId: grantId,
        })
      ).status,
    ).toBe("accepted");

    expect(
      deliver({
        sessionDomain: "employee",
        principalId: "user-b",
      }),
    ).toEqual({ ok: false, reason: "principal_mismatch" });
    expect(
      deliver({
        sessionDomain: "employee",
        principalId: enterprise.principal.principalId,
      }),
    ).toEqual({ ok: false, reason: "principal_mismatch" });
    expect(
      deliver({
        sessionDomain: "platform",
        principalId: platform.principal.principalId,
      }),
    ).toEqual({ ok: false, reason: "principal_mismatch" });
    expect(
      deliver({
        sessionDomain: "enterprise",
        principalId: employee.principal.principalId,
      }),
    ).toEqual({ ok: false, reason: "role_mismatch" });
    expect(deliver({ sessionDomain: "employee" })).toEqual({
      ok: false,
      reason: "principal_required",
    });
    expect(
      deliver({
        sessionDomain: "employee",
        principalId: "   ",
      }),
    ).toEqual({ ok: false, reason: "principal_required" });

    const expiring = grants.dispatch(
      baseRequest({
        commandId: "cmd-bind-exp",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
        expiresAt: "2026-09-03T03:41:00.000Z",
      }),
    );
    grants.dispatch({
      commandId: "cmd-bind-exp-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: expiring.grantId,
    });
    nowMs += 120_000;
    expect(
      deliver({
        sessionDomain: "employee",
        principalId: employee.principal.principalId,
        delegationGrantId: `dlg:${expiring.grantId}`,
      }),
    ).toEqual({ ok: false, reason: "grant_expired" });

    nowMs = Date.parse("2026-09-03T03:40:00.000Z");
    const revoked = grants.dispatch(
      baseRequest({
        commandId: "cmd-bind-rev",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
      }),
    );
    grants.dispatch({
      commandId: "cmd-bind-rev-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: revoked.grantId,
    });
    grants.dispatch({
      commandId: "cmd-bind-rev-do",
      command: "revoke",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: revoked.grantId,
    });
    expect(
      deliver({
        sessionDomain: "employee",
        principalId: employee.principal.principalId,
        delegationGrantId: `dlg:${revoked.grantId}`,
      }),
    ).toEqual({ ok: false, reason: "grant_revoked" });

    const consumed = grants.dispatch(
      baseRequest({
        commandId: "cmd-bind-con",
        actor: enterprise,
        trusted: TRUSTED_A,
        scenario: "enterprise_to_employee",
        approver: employee,
        grantee: employee,
        targetPrincipal: "user-a",
        oneShot: true,
      }),
    );
    grants.dispatch({
      commandId: "cmd-bind-con-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: consumed.grantId,
    });
    grants.dispatch({
      commandId: "cmd-bind-con-do",
      command: "consume",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: consumed.grantId,
      outputs: [{ kind: "EvolutionProposal", id: "evo-bind", redacted: true }],
    });
    expect(
      deliver({
        sessionDomain: "employee",
        principalId: employee.principal.principalId,
        delegationGrantId: `dlg:${consumed.grantId}`,
      }),
    ).toEqual({ ok: false, reason: "grant_consumed" });
  });

  it("fail-closes when the authorization store is unavailable and keeps shares separate", () => {
    const machine = createDiagnosisDelegationMachine({
      store: createUnavailableDelegationStore(),
    });
    expectCode(
      () =>
        machine.dispatch(
          baseRequest({
            commandId: "cmd-down",
            actor: enterprise,
            trusted: TRUSTED_A,
            scenario: "enterprise_to_employee",
            approver: employee,
            grantee: employee,
            targetPrincipal: "user-a",
          }),
        ),
      "delegation_store_unavailable",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-session-tenant",
          command: "request",
          actor: enterprise,
          trusted: TRUSTED_A,
          sessionTenantId: TENANT_A,
          scenario: "enterprise_to_employee",
          approver: employee,
          grantee: employee,
          targetPrincipal: "user-a",
        }),
      "untrusted_tenant_source",
    );
  });

  it("does not write chat, Skill, Working DNA, Capsule, or Fabric policy", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "delegation.ts"),
      "utf8",
    );
    expect(source).toContain("Does not call cross-tenant RPC");
    expect(source).toContain("suggest");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("publishSkill");
    expect(source).not.toContain("applyWorkingStyle");
    expect(source).not.toContain("setInterval");
    expect(FORBIDDEN_EVOLUTION_MUTATIONS).toContain("publish_skill");
    expect(FORBIDDEN_EVOLUTION_MUTATIONS).toContain("modify_working_dna");
  });
});
