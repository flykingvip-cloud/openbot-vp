/**
 * Phase D2 employee Decision Surface tests.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuthorityGrantView } from "../contracts.js";
import {
  EVOLUTION_DECISION_ACTIONS,
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  EVOLUTION_DECISION_REQUIRED_AUTHORITIES,
  EVOLUTION_DECISION_SURFACE_WRITES,
  EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED,
  buildEvolutionEmployeeWeekOverWeekSummary,
  captureEvolutionDecisionCommandRecord,
  evolutionEmployeeDecisionLoadFailView,
  projectEvolutionEmployeeDecisionSurface,
  projectEvolutionEmployeeDecisionUiStatus,
  routeEvolutionDecisionSurface,
  submitEvolutionEmployeeDecisionCommand,
  summarizeEvolutionEmployeeEvidence,
  type EvolutionDecisionAuthorityFacts,
  type EvolutionDecisionCommand,
  type EvolutionDecisionItem,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionRouteInput,
  type EvolutionEmployeeDecisionFact,
  type EvolutionEmployeeDecisionHistory,
  type EvolutionEmployeeDecisionSnapshot,
  type EvolutionEmployeeDecisionSubmitResult,
  type EvolutionEmployeeWeekOverWeekSummary,
} from "./index.js";

const CURRENT_AS_OF = "2026-09-28T12:00:00.000Z";
const PRIOR_AS_OF = "2026-09-21T12:00:00.000Z";
const NOW = CURRENT_AS_OF;
const LATER = "2026-10-05T00:00:00.000Z";
const NO_FACTS: EvolutionDecisionAuthorityFacts = {
  enterpriseCanaryAcknowledged: false,
  employeeFinalAuthorization: false,
};

function grant(actions: string[], tenantScope: string | null = "tenant-a"): AuthorityGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope,
    allowedEvidence: ["ev-1"],
    allowedActions: actions,
    confidentialityCeiling: tenantScope === null ? "platform" : "enterprise",
  };
}

function item(overrides: Partial<EvolutionDecisionItem> = {}): EvolutionDecisionItem {
  return {
    schemaVersion: 1,
    decisionId: "dec-1",
    decisionVersion: "dv-1",
    tenantScope: "tenant-a",
    target: { domain: "agent", agentId: "agent-1" },
    surfaceId: "agent.working-dna",
    sourceFindingIds: ["finding-1"],
    sourceEvidenceRefs: ["ev-1"],
    proposalId: "prop-1",
    decisionType: "hold_or_resume",
    requiredAuthority: "employee",
    allowedActions: ["hold", "reject"],
    status: "pending",
    expiresAt: LATER,
    riskLevel: "medium",
    confidentialityScope: "personal",
    ...overrides,
  };
}

function principal(
  overrides: Partial<EvolutionDecisionPrincipal> = {},
): EvolutionDecisionPrincipal {
  return {
    audience: "employee",
    trustedTenantId: "tenant-a",
    platformOperator: false,
    enterpriseAdmin: false,
    ownerAgentId: "agent-1",
    ...overrides,
  };
}

function routeInput(
  overrides: Partial<EvolutionDecisionRouteInput> = {},
): EvolutionDecisionRouteInput {
  return {
    target: { domain: "agent", agentId: "agent-1" },
    surfaceId: "agent.working-dna",
    ownership: { kind: "agent_self" },
    crossTenantRepeat: false,
    platformFixAffectsEnterprise: false,
    touchesEmployeePersonalAsset: false,
    ...overrides,
  };
}

function fact(
  overrides: {
    item?: Partial<EvolutionDecisionItem>;
    routeInput?: Partial<EvolutionDecisionRouteInput>;
    authorityFacts?: Partial<EvolutionDecisionAuthorityFacts>;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): EvolutionEmployeeDecisionFact {
  const itemOverrides = overrides.item ?? {};
  return {
    item: item(itemOverrides),
    routeInput: routeInput({
      ...(itemOverrides.target ? { target: itemOverrides.target } : {}),
      ...(itemOverrides.surfaceId ? { surfaceId: itemOverrides.surfaceId } : {}),
      ...overrides.routeInput,
    }),
    authorityFacts: { ...NO_FACTS, ...overrides.authorityFacts },
    createdAt: overrides.createdAt ?? PRIOR_AS_OF,
    updatedAt: overrides.updatedAt ?? CURRENT_AS_OF,
  };
}

/** Enterprise-decided item that waits on the owner's final authorization. */
function participationFact(
  overrides: Partial<EvolutionDecisionItem> = {},
  authorityFacts: Partial<EvolutionDecisionAuthorityFacts> = {},
): EvolutionEmployeeDecisionFact {
  return fact({
    authorityFacts,
    item: {
      decisionId: "dec-final",
      decisionType: "employee_final_authorization",
      requiredAuthority: "employee_and_enterprise",
      allowedActions: ["hold", "reject", "employee_final_authorization"],
      confidentialityScope: "enterprise",
      sourceEvidenceRefs: ["ev-enterprise-secret"],
      sourceFindingIds: ["finding-enterprise-secret"],
      sourceCaseId: "case-enterprise-secret",
      proposalId: "prop-enterprise-secret",
      applicationId: "app-enterprise-secret",
      ...overrides,
    },
    routeInput: {
      ownership: { kind: "agent_enterprise", delegated: true },
      touchesEmployeePersonalAsset: true,
    },
  });
}

function snapshot(
  asOf: string,
  facts: readonly EvolutionEmployeeDecisionFact[],
): EvolutionEmployeeDecisionSnapshot {
  return { asOf, facts };
}

function history(
  current: readonly EvolutionEmployeeDecisionFact[],
  prior: readonly EvolutionEmployeeDecisionFact[] | null = [],
): EvolutionEmployeeDecisionHistory {
  return {
    current: snapshot(CURRENT_AS_OF, current),
    prior: prior === null ? null : snapshot(PRIOR_AS_OF, prior),
  };
}

function project(
  input: {
    current?: readonly EvolutionEmployeeDecisionFact[];
    prior?: readonly EvolutionEmployeeDecisionFact[] | null;
    principal?: EvolutionDecisionPrincipal;
    perceptionFactIdsByControlPlaneRef?: ReadonlyMap<string, readonly string[]>;
  } = {},
) {
  return projectEvolutionEmployeeDecisionSurface({
    history: history(input.current ?? [fact()], input.prior === undefined ? [] : input.prior),
    principal: input.principal ?? principal(),
    perceptionFactIdsByControlPlaneRef: input.perceptionFactIdsByControlPlaneRef,
  });
}

function available(
  summary: EvolutionEmployeeWeekOverWeekSummary,
): Extract<EvolutionEmployeeWeekOverWeekSummary, { availability: "available" }> {
  if (summary.availability !== "available") {
    throw new Error(`expected an available weekly summary, got ${summary.reason}`);
  }
  return summary;
}

function command(overrides: Partial<EvolutionDecisionCommand> = {}): EvolutionDecisionCommand {
  return {
    commandId: "cmd-1",
    decisionId: "dec-1",
    action: "hold",
    expectedVersion: "dv-1",
    ...overrides,
  };
}

function submit(
  overrides: Partial<Parameters<typeof submitEvolutionEmployeeDecisionCommand>[0]> = {},
): EvolutionEmployeeDecisionSubmitResult {
  return submitEvolutionEmployeeDecisionCommand({
    command: command(),
    item: item(),
    principal: principal(),
    grant: grant(["hold", "reject"]),
    facts: NO_FACTS,
    routeInput: routeInput(),
    now: NOW,
    prior: [],
    ...overrides,
  });
}

function expectMachineReceiptZeroWrite(result: EvolutionEmployeeDecisionSubmitResult): void {
  expect(result.writes).toBe(EVOLUTION_DECISION_SURFACE_WRITES);
  expect(result.writes).toEqual([]);
  expect(Object.isFrozen(result.writes)).toBe(true);
  expect(result.executed).toBe(false);
  expect(result.effectProof).toBe(false);
  expect(result.judgement.writes).toEqual([]);
  expect(result.judgement.executed).toBe(false);
  expect(result.judgement.effectProof).toBe(false);
}

describe("employee decision runtime gate", () => {
  it("stays closed and the projection reports it", () => {
    expect(EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED).toBe(false);
    const view = project();
    expect(view.runtimeEnabled).toBe(false);
    expect(view.productionProven).toBe(false);
    expect(view.e52Open).toBe(false);
    expect(view.claimGrade).toBe("code-present");
    expect(evolutionEmployeeDecisionLoadFailView().runtimeEnabled).toBe(false);
  });

  it("cannot be read from browser or client state", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "employee-surface.ts"),
      "utf8",
    );
    for (const token of [
      "localStorage",
      "sessionStorage",
      "location.",
      "URLSearchParams",
      "document.",
      "window.",
      "process.env",
    ]) {
      expect(source).not.toContain(token);
    }
    expect(source).toContain("EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED = false as const");
  });
});

describe("employee decision ui status", () => {
  it("maps resolved / watching / pending / needs-admin", () => {
    const status = (
      overrides: Partial<Parameters<typeof projectEvolutionEmployeeDecisionUiStatus>[0]>,
    ) =>
      projectEvolutionEmployeeDecisionUiStatus({
        status: "pending",
        requiredAuthority: "employee",
        executableActions: ["hold"],
        ...overrides,
      });
    expect(status({ status: "resolved", executableActions: [] })).toBe("system-done");
    expect(status({ executableActions: [] })).toBe("watching");
    expect(status({})).toBe("pending-my-confirm");
    expect(status({ requiredAuthority: "enterprise" })).toBe("needs-admin");
    expect(status({ status: "blocked", executableActions: [] })).toBe("needs-admin");
    expect(status({ status: "expired", executableActions: [] })).toBe("needs-admin");
  });
});

describe("employee decision surface projection", () => {
  it("renders injected facts without any runtime wiring", () => {
    const view = project({ current: [fact()] });
    expect(view.phase).toBe("loaded");
    expect(view.asOf).toBe(CURRENT_AS_OF);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      decisionId: "dec-1",
      view: "item",
      uiStatus: "pending-my-confirm",
      requiredAuthority: "employee",
      allowedActions: ["hold", "reject"],
      impactTarget: { key: "agent:agent-1", domain: "agent", surfaceId: "agent.working-dna" },
    });
  });

  it("shows only current-tenant self-owned items and omits others without Evidence", () => {
    const view = project({
      current: [
        fact(),
        fact({
          item: {
            decisionId: "dec-other-owner",
            target: { domain: "agent", agentId: "agent-9" },
            sourceEvidenceRefs: ["secret-ev"],
          },
        }),
        fact({
          item: {
            decisionId: "dec-cross",
            tenantScope: "tenant-b",
            sourceEvidenceRefs: ["cross-ev"],
          },
        }),
      ],
    });
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-1"]);
    expect(view.omitted.map((row) => row.decisionId).toSorted()).toEqual([
      "dec-cross",
      "dec-other-owner",
    ]);
    expect(JSON.stringify(view.omitted)).not.toContain("secret-ev");
    expect(JSON.stringify(view.omitted)).not.toContain("cross-ev");
    expect(JSON.stringify(view)).not.toMatch(/"payload"|rawEvidence/);
    expect(view.rows[0]?.evidence).toEqual({
      availability: "available",
      citationCount: 1,
      findingCount: 1,
      hasCase: false,
    });
    expect(JSON.stringify(view.rows[0]?.evidence)).not.toContain("ev-1");
  });

  it("omits a decision id that appears twice in one snapshot", () => {
    const view = project({
      current: [fact(), fact({ item: { status: "resolved", allowedActions: [] } })],
    });
    expect(view.rows).toEqual([]);
    expect(view.omitted).toEqual([
      { decisionId: "dec-1", code: "duplicate_decision_id" },
      { decisionId: "dec-1", code: "duplicate_decision_id" },
    ]);
  });

  it("marks empty / load-fail / evidence-unavailable as not healthy", () => {
    const empty = project({ current: [] });
    expect(empty.phase).toBe("empty");
    expect(empty.runtimeEnabled).toBe(false);

    const loadFail = evolutionEmployeeDecisionLoadFailView();
    expect(loadFail.phase).toBe("load-fail");
    expect(loadFail.rows).toEqual([]);
    expect(loadFail.asOf).toBeNull();
    expect(loadFail.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "snapshot_load_failed",
    });

    const noEvidence = project({
      current: [fact({ item: { sourceEvidenceRefs: [], sourceFindingIds: [] } })],
    });
    expect(noEvidence.phase).toBe("evidence-unavailable");
    expect(noEvidence.rows[0]?.evidence.availability).toBe("unavailable");
  });

  it("correlates Perception fact ids without copying Perception facts", () => {
    const view = project({
      perceptionFactIdsByControlPlaneRef: new Map([["prop-1", ["ledger-evt-9"]]]),
    });
    expect(view.rows[0]?.correlation.perceptionFactIds).toEqual(["ledger-evt-9"]);
    expect(JSON.stringify(view.rows[0]?.correlation)).not.toContain("beforeAfter");
    expect(JSON.stringify(view.rows[0]?.correlation)).not.toContain("changeObject");
  });
});

describe("employee participation view", () => {
  it("does not derive evidence or control-plane ids from the enterprise item", () => {
    const view = project({
      current: [participationFact()],
      perceptionFactIdsByControlPlaneRef: new Map([["prop-enterprise-secret", ["evt-x"]]]),
    });
    expect(view.rows).toHaveLength(1);
    const row = view.rows[0];
    expect(row?.view).toBe("employee_participation");
    expect(row?.evidence).toEqual({
      availability: "withheld",
      citationCount: 0,
      findingCount: 0,
      hasCase: false,
    });
    expect(row?.correlation).toEqual({ perceptionFactIds: [] });
    const json = JSON.stringify(view);
    for (const secret of [
      "ev-enterprise-secret",
      "finding-enterprise-secret",
      "case-enterprise-secret",
      "prop-enterprise-secret",
      "app-enterprise-secret",
    ]) {
      expect(json).not.toContain(secret);
    }
    // Withheld evidence is expected on this view, not a data failure.
    expect(view.phase).toBe("loaded");
  });

  it("offers only final authorization; the enterprise keeps hold and reject", () => {
    const row = project({ current: [participationFact()] }).rows[0];
    expect(row?.requiredAuthority).toBe("employee_and_enterprise");
    expect(row?.allowedActions).toEqual(["employee_final_authorization"]);
    expect(row?.uiStatus).toBe("pending-my-confirm");
    expect(row?.actionReasons).toEqual({
      hold: "wrong_endpoint",
      reject: "wrong_endpoint",
      rollback: "action_not_on_item",
    });
  });
});

describe("authority and action semantics", () => {
  it("keeps who decides separate from what can be done", () => {
    const view = project({
      current: [
        fact(),
        participationFact(),
        fact({ item: { decisionId: "dec-done", status: "resolved" } }),
      ],
    });
    expect(view.rows).toHaveLength(3);
    for (const row of view.rows) {
      expect(row).not.toHaveProperty("requiredPermissions");
      expect(EVOLUTION_DECISION_REQUIRED_AUTHORITIES).toContain(row.requiredAuthority);
      expect(EVOLUTION_DECISION_ACTIONS as readonly string[]).not.toContain(row.requiredAuthority);
      for (const action of row.allowedActions) {
        expect(EVOLUTION_DECISION_ENDPOINT_ACTIONS.employee).toContain(action);
      }
    }
  });

  it("opens no action on decisions that are not pending", () => {
    const view = project({
      current: [
        fact({ item: { decisionId: "dec-done", status: "resolved" } }),
        fact({ item: { decisionId: "dec-exp", status: "expired" } }),
        fact({ item: { decisionId: "dec-blocked", status: "blocked" } }),
      ],
    });
    const byId = new Map(view.rows.map((row) => [row.decisionId, row]));
    expect(byId.get("dec-done")?.allowedActions).toEqual([]);
    expect(byId.get("dec-done")?.actionReasons.hold).toBe("handled");
    expect(byId.get("dec-exp")?.allowedActions).toEqual([]);
    expect(byId.get("dec-exp")?.actionReasons.hold).toBe("expired");
    expect(byId.get("dec-blocked")?.allowedActions).toEqual([]);
    expect(byId.get("dec-blocked")?.actionReasons.hold).toBe("blocked");
  });
});

describe("week-over-week history contract", () => {
  it("compares the same decision across prior and current snapshots", () => {
    const view = project({
      prior: [fact({ item: { status: "pending", allowedActions: ["hold", "reject"] } })],
      current: [fact({ item: { status: "resolved", allowedActions: [] } })],
    });
    const wow = available(view.weekOverWeek);
    expect(wow.priorAsOf).toBe(PRIOR_AS_OF);
    expect(wow.currentAsOf).toBe(CURRENT_AS_OF);
    expect(wow.prior).toEqual({
      total: 1,
      pendingMyConfirm: 1,
      watching: 0,
      systemDone: 0,
      needsAdmin: 0,
    });
    expect(wow.current).toEqual({
      total: 1,
      pendingMyConfirm: 0,
      watching: 0,
      systemDone: 1,
      needsAdmin: 0,
    });
    expect(wow.delta).toEqual({
      total: 0,
      pendingMyConfirm: -1,
      watching: 0,
      systemDone: 1,
      needsAdmin: 0,
    });
    expect(wow.transitions).toEqual([
      {
        decisionId: "dec-1",
        decisionType: "hold_or_resume",
        from: "pending-my-confirm",
        to: "system-done",
      },
    ]);
  });

  it("reports new and no-longer-visible decisions as transitions", () => {
    const wow = available(
      project({
        prior: [fact({ item: { decisionId: "dec-gone" } })],
        current: [fact({ item: { decisionId: "dec-new" } })],
      }).weekOverWeek,
    );
    expect(wow.delta.total).toBe(0);
    expect(wow.transitions).toEqual([
      {
        decisionId: "dec-new",
        decisionType: "hold_or_resume",
        from: null,
        to: "pending-my-confirm",
      },
      {
        decisionId: "dec-gone",
        decisionType: "hold_or_resume",
        from: "pending-my-confirm",
        to: null,
      },
    ]);
  });

  it("does not list decisions whose status did not change", () => {
    const wow = available(project({ prior: [fact()], current: [fact()] }).weekOverWeek);
    expect(wow.transitions).toEqual([]);
    expect(wow.delta.pendingMyConfirm).toBe(0);
  });

  it("is history-unavailable without a prior snapshot, never zero counts", () => {
    const view = project({ prior: null });
    expect(view.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "prior_snapshot_missing",
    });
    expect(view.weekOverWeek).not.toHaveProperty("current");
    expect(view.weekOverWeek).not.toHaveProperty("delta");
    // The current list still renders.
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-1"]);
  });

  it("fails closed when snapshot times cannot support a weekly comparison", () => {
    const rows = project().rows;
    const reason = (priorAsOf: string, currentAsOf = CURRENT_AS_OF) => {
      const summary = buildEvolutionEmployeeWeekOverWeekSummary({
        current: { asOf: currentAsOf, rows },
        prior: { asOf: priorAsOf, rows },
      });
      return summary.availability === "history-unavailable" ? summary.reason : "available";
    };
    expect(reason("not-a-date")).toBe("snapshot_as_of_invalid");
    expect(reason(PRIOR_AS_OF, "not-a-date")).toBe("snapshot_as_of_invalid");
    expect(reason(CURRENT_AS_OF)).toBe("prior_not_before_current");
    expect(reason("2026-09-30T12:00:00.000Z")).toBe("prior_not_before_current");
    expect(reason("2026-09-27T12:00:00.000Z")).toBe("prior_snapshot_not_weekly");
    expect(reason("2026-09-14T12:00:00.000Z")).toBe("prior_snapshot_not_weekly");
    expect(reason("2026-09-21T20:00:00.000Z")).toBe("available");
  });

  it("filters cross-tenant, other-owner, and confidential items in both snapshots", () => {
    const hidden = (status: EvolutionDecisionItem["status"]) => [
      fact({
        item: { decisionId: "dec-cross", tenantScope: "tenant-b", status, allowedActions: [] },
      }),
      fact({
        item: {
          decisionId: "dec-other-owner",
          target: { domain: "agent", agentId: "agent-9" },
          status,
          allowedActions: [],
        },
      }),
      fact({
        item: {
          decisionId: "dec-confidential",
          confidentialityScope: "enterprise",
          status,
          allowedActions: [],
        },
      }),
    ];
    const view = project({
      prior: [fact(), ...hidden("pending")],
      current: [fact({ item: { status: "resolved", allowedActions: [] } }), ...hidden("resolved")],
    });
    const wow = available(view.weekOverWeek);
    expect(wow.prior.total).toBe(1);
    expect(wow.current.total).toBe(1);
    expect(wow.transitions.map((row) => row.decisionId)).toEqual(["dec-1"]);
    const json = JSON.stringify(wow);
    for (const hiddenId of ["dec-cross", "dec-other-owner", "dec-confidential"]) {
      expect(json).not.toContain(hiddenId);
    }
    expect(view.omitted.map((row) => row.code).toSorted()).toEqual([
      "confidentiality",
      "owner_mismatch",
      "tenant_mismatch",
    ]);
  });

  it("filters the prior snapshot with the current principal", () => {
    const view = project({
      prior: [
        fact({
          item: { decisionId: "dec-was-mine", target: { domain: "agent", agentId: "agent-2" } },
        }),
      ],
      current: [],
      principal: principal({ ownerAgentId: "agent-1" }),
    });
    const wow = available(view.weekOverWeek);
    expect(wow.prior.total).toBe(0);
    expect(wow.transitions).toEqual([]);
  });
});

describe("employee decision submit fail-closed", () => {
  it("accepted receipts are admissible plans, not effects", () => {
    const result = submit();
    expect(result.judgement.receipt.outcome).toBe("accepted");
    expectMachineReceiptZeroWrite(result);
  });

  it("expectedVersion mismatch is zero-write", () => {
    const result = submit({ command: command({ expectedVersion: "stale" }) });
    expect(result.judgement.receipt.outcome).toBe("rejected");
    expect(result.judgement.code).toBe("version_mismatch");
    expectMachineReceiptZeroWrite(result);
  });

  it("route binding mismatch is zero-write", () => {
    const result = submit({
      command: command({ commandId: "cmd-2" }),
      routeInput: routeInput({ surfaceId: "agent.capsule" }),
    });
    expect(result.judgement.code).toBe("route_binding_mismatch");
    expectMachineReceiptZeroWrite(result);
  });

  it("commandId replay returns idempotent_replay and rebind fails closed", () => {
    const replayCommand = command({ commandId: "cmd-replay" });
    const accepted = submit({ command: replayCommand });
    expect(accepted.judgement.receipt.outcome).toBe("accepted");
    expectMachineReceiptZeroWrite(accepted);

    const record = captureEvolutionDecisionCommandRecord({
      command: replayCommand,
      item: item(),
      principal: principal(),
      auditReceiptRef: accepted.judgement.receipt.auditReceiptRef,
    });
    const prior = [record];

    const replay = submit({ command: replayCommand, prior });
    expect(replay.judgement.receipt.outcome).toBe("idempotent_replay");
    expect(replay.judgement.receipt.auditReceiptRef).toBe(
      accepted.judgement.receipt.auditReceiptRef,
    );
    expectMachineReceiptZeroWrite(replay);
    expect(prior).toEqual([record]);

    const rebind = submit({ command: { ...replayCommand, action: "reject" }, prior });
    expect(rebind.judgement.code).toBe("command_rebind");
    expect(rebind.judgement.receipt.outcome).toBe("rejected");
    expectMachineReceiptZeroWrite(rebind);
  });

  it("every outcome keeps writes empty, executed false, and effectProof false", () => {
    const outcomes = [
      submit(),
      submit({ command: command({ expectedVersion: "stale" }) }),
      submit({ item: item({ status: "expired", expiresAt: "2026-09-01T00:00:00.000Z" }) }),
      submit({ item: item({ allowedActions: ["reject"] }), grant: { status: "missing" } }),
      submit({
        command: command({ action: "authorize" }),
        item: item({ allowedActions: ["authorize", "hold"], decisionType: "authorize_experiment" }),
        grant: grant(["authorize"]),
      }),
      submit({ command: command({ action: "apply_canary" }) }),
    ];
    expect(outcomes.map((result) => result.judgement.code)).toEqual([
      "admissible",
      "version_mismatch",
      "expired",
      "action_not_allowed",
      "control_plane_action_unavailable",
      "action_not_allowed",
    ]);
    for (const result of outcomes) {
      expectMachineReceiptZeroWrite(result);
    }
  });
});

describe("evidence summary", () => {
  it("never embeds raw evidence refs in the summary", () => {
    const summary = summarizeEvolutionEmployeeEvidence(
      item({ sourceEvidenceRefs: ["ev-raw-secret"], sourceFindingIds: ["f1"] }),
    );
    expect(summary).toEqual({
      availability: "available",
      citationCount: 1,
      findingCount: 1,
      hasCase: false,
    });
    expect(JSON.stringify(summary)).not.toContain("ev-raw-secret");
  });
});

describe("final authorization stays on its participation route", () => {
  it("is not offered on the employee's own decision, matching the judge", () => {
    const listed = item({ allowedActions: ["hold", "employee_final_authorization"] });
    const row = project({ current: [fact({ item: listed })] }).rows[0];
    expect(row?.allowedActions).toEqual(["hold"]);
    expect(row?.actionReasons.employee_final_authorization).toBe("participation_required");

    const result = submit({
      command: command({ action: "employee_final_authorization" }),
      item: listed,
      grant: grant(["observe", "hold"]),
    });
    expect(result.judgement.code).toBe("participation_required");
    expectMachineReceiptZeroWrite(result);
  });
});

describe("final authorization is given once", () => {
  it("stops offering final authorization once it is recorded", () => {
    const row = project({
      current: [participationFact({}, { employeeFinalAuthorization: true })],
    }).rows[0];
    expect(row?.view).toBe("employee_participation");
    expect(row?.allowedActions).toEqual([]);
    expect(row?.actionReasons.employee_final_authorization).toBe("participation_already_satisfied");
    expect(row?.uiStatus).toBe("watching");
  });

  it("refuses a repeat under a new commandId and keeps the original replay", () => {
    const source = participationFact();
    const finalCommand = command({
      commandId: "cmd-final",
      decisionId: "dec-final",
      action: "employee_final_authorization",
    });
    const base = { item: source.item, routeInput: source.routeInput, grant: grant([]) };
    const accepted = submit({ ...base, command: finalCommand });
    expect(accepted.judgement.receipt.outcome).toBe("accepted");
    const prior = Object.freeze([
      captureEvolutionDecisionCommandRecord({
        command: finalCommand,
        item: source.item,
        principal: principal(),
        auditReceiptRef: accepted.judgement.receipt.auditReceiptRef,
        route: routeEvolutionDecisionSurface(source.routeInput),
      }),
    ]);
    const authorized = { ...NO_FACTS, employeeFinalAuthorization: true };

    const repeat = submit({
      ...base,
      command: { ...finalCommand, commandId: "cmd-final-again" },
      facts: authorized,
      prior,
    });
    expect(repeat.judgement.code).toBe("participation_already_satisfied");
    expect(repeat.judgement.receipt.outcome).toBe("blocked");
    expectMachineReceiptZeroWrite(repeat);

    const replay = submit({ ...base, command: finalCommand, facts: authorized, prior });
    expect(replay.judgement.code).toBe("idempotent_replay");
    expect(replay.judgement.receipt.auditReceiptRef).toBe(
      accepted.judgement.receipt.auditReceiptRef,
    );
    expectMachineReceiptZeroWrite(replay);
  });
});
