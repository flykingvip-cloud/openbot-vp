/**
 * Phase D3 enterprise Decision Surface tests: tenant, delegation, canary, and
 * redaction matrix over the D1 contracts.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuthorityGrantView } from "../contracts.js";
import {
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  EVOLUTION_DECISION_SURFACE_WRITES,
  EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
  buildEvolutionEnterpriseWeekOverWeekSummary,
  captureEvolutionDecisionCommandRecord,
  evolutionEnterpriseDecisionLoadFailView,
  projectEvolutionDecisionSnapshot,
  projectEvolutionEnterpriseDecisionSurface,
  routeEvolutionDecisionSurface,
  submitEvolutionEnterpriseDecisionCommand,
  type EvolutionDecisionAuthorityFacts,
  type EvolutionDecisionCommand,
  type EvolutionDecisionItem,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionRouteInput,
  type EvolutionEnterpriseDecisionFact,
  type EvolutionEnterpriseDecisionRow,
  type EvolutionEnterpriseDecisionSubmitResult,
  type EvolutionEnterpriseDecisionSurfaceView,
  type EvolutionEnterpriseWeekOverWeekSummary,
} from "./index.js";

const CURRENT_AS_OF = "2026-09-28T12:00:00.000Z";
const PRIOR_AS_OF = "2026-09-21T12:00:00.000Z";
const LATER = "2026-10-05T00:00:00.000Z";
const NO_FACTS: EvolutionDecisionAuthorityFacts = {
  enterpriseCanaryAcknowledged: false,
  employeeFinalAuthorization: false,
};

function grant(actions: string[], overrides: Partial<AuthorityGrantView> = {}): AuthorityGrantView {
  return {
    grantId: "grant-enterprise",
    status: "APPROVED",
    tenantScope: "tenant-a",
    allowedEvidence: ["ev-1"],
    allowedActions: actions,
    confidentialityCeiling: "enterprise",
    ...overrides,
  };
}

/** Enterprise knowledge decision by default. */
function item(overrides: Partial<EvolutionDecisionItem> = {}): EvolutionDecisionItem {
  return {
    schemaVersion: 1,
    decisionId: "dec-k",
    decisionVersion: "dv-1",
    tenantScope: "tenant-a",
    target: { domain: "knowledge", assetId: "asset-1" },
    surfaceId: "knowledge.experience-capsule",
    sourceFindingIds: ["finding-1"],
    sourceEvidenceRefs: ["ev-1"],
    proposalId: "prop-k",
    decisionType: "hold_or_resume",
    requiredAuthority: "enterprise",
    allowedActions: ["hold", "reject", "start_experiment"],
    status: "pending",
    expiresAt: LATER,
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    ...overrides,
  };
}

function principal(
  overrides: Partial<EvolutionDecisionPrincipal> = {},
): EvolutionDecisionPrincipal {
  return {
    audience: "enterprise",
    trustedTenantId: "tenant-a",
    platformOperator: false,
    enterpriseAdmin: true,
    ...overrides,
  };
}

function routeInput(
  overrides: Partial<EvolutionDecisionRouteInput> = {},
): EvolutionDecisionRouteInput {
  return {
    target: { domain: "knowledge", assetId: "asset-1" },
    surfaceId: "knowledge.experience-capsule",
    ownership: { kind: "knowledge_enterprise" },
    crossTenantRepeat: false,
    platformFixAffectsEnterprise: false,
    touchesEmployeePersonalAsset: false,
    ...overrides,
  };
}

type FactOverrides = {
  item?: Partial<EvolutionDecisionItem>;
  routeInput?: Partial<EvolutionDecisionRouteInput>;
  authorityFacts?: Partial<EvolutionDecisionAuthorityFacts>;
  grant?: EvolutionEnterpriseDecisionFact["grant"];
};

function fact(overrides: FactOverrides = {}): EvolutionEnterpriseDecisionFact {
  const itemOverrides = overrides.item ?? {};
  return {
    item: item(itemOverrides),
    routeInput: routeInput({
      ...(itemOverrides.target ? { target: itemOverrides.target } : {}),
      ...(itemOverrides.surfaceId ? { surfaceId: itemOverrides.surfaceId } : {}),
      ...overrides.routeInput,
    }),
    authorityFacts: { ...NO_FACTS, ...overrides.authorityFacts },
    grant: overrides.grant ?? grant(["hold", "reject", "experiment"]),
    createdAt: PRIOR_AS_OF,
    updatedAt: CURRENT_AS_OF,
  };
}

const PERSONAL_SECRETS = [
  "ev-personal-secret",
  "finding-personal-secret",
  "case-personal-secret",
  "prop-personal-secret",
  "app-personal-secret",
  "ver-personal-secret",
  "grant-ref-personal-secret",
  "delegation-ref-personal-secret",
];

/** Delegated enterprise change on an employee's personal agent. */
function personalFact(overrides: FactOverrides = {}): EvolutionEnterpriseDecisionFact {
  return fact({
    ...overrides,
    item: {
      decisionId: "dec-personal",
      target: { domain: "agent", agentId: "agent-7" },
      surfaceId: "agent.working-dna",
      requiredAuthority: "employee_and_enterprise",
      confidentialityScope: "personal",
      sourceEvidenceRefs: ["ev-personal-secret"],
      sourceFindingIds: ["finding-personal-secret"],
      sourceCaseId: "case-personal-secret",
      proposalId: "prop-personal-secret",
      applicationId: "app-personal-secret",
      verificationId: "ver-personal-secret",
      evidenceAccessGrantRef: "grant-ref-personal-secret",
      delegationGrantRef: "delegation-ref-personal-secret",
      allowedActions: [
        "hold",
        "reject",
        "start_experiment",
        "apply_canary",
        "promote",
        "employee_final_authorization",
      ],
      ...overrides.item,
    },
    routeInput: {
      ownership: { kind: "agent_enterprise", delegated: true },
      touchesEmployeePersonalAsset: true,
      ...overrides.routeInput,
    },
    grant:
      overrides.grant ??
      grant(["hold", "reject", "experiment", "apply", "promote"], {
        allowedEvidence: ["ev-personal-secret"],
      }),
  });
}

const PLATFORM_SECRETS = [
  "ev-platform-secret",
  "finding-platform-secret",
  "case-platform-secret",
  "prop-platform-secret",
  "app-platform-secret",
];

/** Platform change that affects this tenant, scoped to this tenant. */
function canaryFact(overrides: FactOverrides = {}): EvolutionEnterpriseDecisionFact {
  return fact({
    ...overrides,
    item: {
      decisionId: "dec-canary",
      target: { domain: "system", componentId: "runtime" },
      surfaceId: "system.runtime-binding-governance",
      requiredAuthority: "platform_and_enterprise",
      confidentialityScope: "platform",
      decisionType: "canary_participation",
      sourceEvidenceRefs: ["ev-platform-secret"],
      sourceFindingIds: ["finding-platform-secret"],
      sourceCaseId: "case-platform-secret",
      proposalId: "prop-platform-secret",
      applicationId: "app-platform-secret",
      allowedActions: ["participate_canary", "apply_canary", "promote"],
      ...overrides.item,
    },
    routeInput: {
      ownership: { kind: "system" },
      platformFixAffectsEnterprise: true,
      ...overrides.routeInput,
    },
    grant: overrides.grant ?? { status: "missing" },
  });
}

function project(
  input: {
    current?: readonly EvolutionEnterpriseDecisionFact[];
    prior?: readonly EvolutionEnterpriseDecisionFact[] | null;
    principal?: EvolutionDecisionPrincipal;
    currentAsOf?: string;
    priorAsOf?: string;
  } = {},
) {
  return projectEvolutionEnterpriseDecisionSurface({
    history: {
      current: { asOf: input.currentAsOf ?? CURRENT_AS_OF, facts: input.current ?? [fact()] },
      prior:
        input.prior === null
          ? null
          : { asOf: input.priorAsOf ?? PRIOR_AS_OF, facts: input.prior ?? [] },
    },
    principal: input.principal ?? principal(),
  });
}

/** Server-side omission codes for the same facts. Never part of the view. */
function hiddenCodes(
  facts: readonly EvolutionEnterpriseDecisionFact[],
): { decisionId: string; code: string }[] {
  return projectEvolutionDecisionSnapshot({ facts, principal: principal() }).omitted;
}

/** The view carries no id, count, or field for hidden decisions. */
function expectNoTrace(
  view: EvolutionEnterpriseDecisionSurfaceView,
  hidden: readonly string[],
): void {
  expect(view).not.toHaveProperty("omitted");
  const json = JSON.stringify(view);
  for (const value of hidden) {
    expect(json).not.toContain(value);
  }
}

function rowById(
  rows: readonly EvolutionEnterpriseDecisionRow[],
  decisionId: string,
): EvolutionEnterpriseDecisionRow {
  const row = rows.find((entry) => entry.decisionId === decisionId);
  if (!row) {
    throw new Error(`row ${decisionId} missing`);
  }
  return row;
}

function available(
  summary: EvolutionEnterpriseWeekOverWeekSummary,
): Extract<EvolutionEnterpriseWeekOverWeekSummary, { availability: "available" }> {
  if (summary.availability !== "available") {
    throw new Error(`expected an available weekly summary, got ${summary.reason}`);
  }
  return summary;
}

function command(overrides: Partial<EvolutionDecisionCommand> = {}): EvolutionDecisionCommand {
  return {
    commandId: "cmd-ent-1",
    decisionId: "dec-k",
    action: "hold",
    expectedVersion: "dv-1",
    ...overrides,
  };
}

function submit(
  overrides: Partial<Parameters<typeof submitEvolutionEnterpriseDecisionCommand>[0]> = {},
): EvolutionEnterpriseDecisionSubmitResult {
  const base = fact();
  return submitEvolutionEnterpriseDecisionCommand({
    command: command(),
    item: base.item,
    principal: principal(),
    grant: base.grant,
    facts: base.authorityFacts,
    routeInput: base.routeInput,
    now: CURRENT_AS_OF,
    prior: [],
    ...overrides,
  });
}

function submitFact(
  source: EvolutionEnterpriseDecisionFact,
  overrides: Partial<Parameters<typeof submitEvolutionEnterpriseDecisionCommand>[0]> = {},
): EvolutionEnterpriseDecisionSubmitResult {
  return submit({
    item: source.item,
    grant: source.grant,
    facts: source.authorityFacts,
    routeInput: source.routeInput,
    ...overrides,
  });
}

function expectZeroWrite(result: EvolutionEnterpriseDecisionSubmitResult): void {
  expect(result.writes).toBe(EVOLUTION_DECISION_SURFACE_WRITES);
  expect(result.writes).toEqual([]);
  expect(result.executed).toBe(false);
  expect(result.effectProof).toBe(false);
  expect(result.judgement.writes).toEqual([]);
  expect(result.judgement.executed).toBe(false);
  expect(result.judgement.effectProof).toBe(false);
}

describe("enterprise decision runtime gate", () => {
  it("stays closed and the projection reports it", () => {
    expect(EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED).toBe(false);
    const view = project();
    expect(view.runtimeEnabled).toBe(false);
    expect(view.productionProven).toBe(false);
    expect(view.e52Open).toBe(false);
    expect(view.claimGrade).toBe("code-present");
  });

  it("cannot be read from browser or client state", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "enterprise-surface.ts"),
      "utf8",
    );
    for (const token of [
      "localStorage",
      "sessionStorage",
      "location.",
      "URLSearchParams",
      "document.",
      "window.",
      "cookie",
      "process.env",
    ]) {
      expect(source).not.toContain(token);
    }
    expect(source).toContain("EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false as const");
  });
});

describe("tenant and identity", () => {
  it("denies a non-admin without rows, ids, or history", () => {
    const view = project({ principal: principal({ enterpriseAdmin: false }) });
    expect(view.phase).toBe("denied");
    expect(view.denial).toBe("enterprise_admin_required");
    expect(view.rows).toEqual([]);
    expect(view).not.toHaveProperty("omitted");
    expect(view.asOf).toBeNull();
    expect(view.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "access_denied",
    });
    expect(JSON.stringify(view)).not.toContain("dec-k");
  });

  it("fails closed without a trusted tenant", () => {
    const view = project({ principal: principal({ trustedTenantId: null }) });
    expect(view.phase).toBe("denied");
    expect(view.denial).toBe("trusted_tenant_required");
    expect(view.rows).toEqual([]);
    const blank = project({ principal: principal({ trustedTenantId: "  " }) });
    expect(blank.denial).toBe("trusted_tenant_required");
  });

  it("shows only the trusted tenant and leaves no trace of other tenants", () => {
    const current = [
      fact(),
      fact({
        item: {
          decisionId: "dec-other-tenant",
          tenantScope: "tenant-b",
          sourceEvidenceRefs: ["ev-b-secret"],
        },
      }),
    ];
    const view = project({ current });
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-k"]);
    expect(hiddenCodes(current)).toEqual([
      { decisionId: "dec-other-tenant", code: "tenant_mismatch" },
    ]);
    expectNoTrace(view, ["dec-other-tenant", "tenant-b", "ev-b-secret"]);
  });

  it("treats the principal as enterprise whatever audience it arrives with", () => {
    const view = project({ principal: principal({ audience: "employee" }) });
    expect(view.phase).toBe("loaded");
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-k"]);
    const result = submit({ principal: principal({ audience: "employee" }) });
    expect(result.judgement.code).toBe("admissible");
    expectZeroWrite(result);
  });

  it("refuses client-declared authority fields and non-admin submits", () => {
    for (const [field, value] of [
      ["enterpriseAdmin", true],
      ["enterpriseId", "tenant-a"],
      ["tenantId", "tenant-a"],
      ["role", "enterprise-admin"],
      ["delegation", { grantId: "grant-enterprise" }],
      ["grant", { grantId: "grant-enterprise" }],
      ["approval", true],
      ["messageText", "同意"],
    ] as const) {
      const result = submit({
        command: undefined,
        payload: {
          commandId: `cmd-${field}`,
          decisionId: "dec-k",
          action: "hold",
          expectedVersion: "dv-1",
          [field]: value,
        },
      });
      expect(result.judgement.code).toBe("client_authority_forbidden");
      expectZeroWrite(result);
    }
    const nonAdmin = submit({ principal: principal({ enterpriseAdmin: false }) });
    expect(nonAdmin.judgement.code).toBe("enterprise_admin_required");
    expectZeroWrite(nonAdmin);
    const noTenant = submit({ principal: principal({ trustedTenantId: null }) });
    expect(noTenant.judgement.code).toBe("tenant_mismatch");
    expectZeroWrite(noTenant);
  });
});

describe("enterprise-owned decisions", () => {
  it("routes enterprise agent, knowledge, capability, and organization items to full rows", () => {
    const view = project({
      current: [
        fact({
          item: {
            decisionId: "dec-agent",
            target: { domain: "agent", agentId: "agent-1" },
            surfaceId: "agent.working-dna",
          },
          routeInput: { ownership: { kind: "agent_enterprise", delegated: true } },
        }),
        fact(),
        fact({
          item: {
            decisionId: "dec-capability",
            target: { domain: "capability", skillId: "skill-1" },
            surfaceId: "capability.skill-spec",
          },
          routeInput: { ownership: { kind: "capability_enterprise_private" } },
        }),
        fact({
          item: {
            decisionId: "dec-org",
            target: { domain: "organization", groupId: "group-1" },
            surfaceId: "organization.task-routing",
          },
          routeInput: { ownership: { kind: "organization_enterprise" } },
        }),
      ],
    });
    expect(view.rows.map((row) => row.decisionId)).toEqual([
      "dec-agent",
      "dec-k",
      "dec-capability",
      "dec-org",
    ]);
    for (const row of view.rows) {
      expect(row.view).toBe("item");
      expect(row.participation).toBe("none");
      expect(row.requiredAuthority).toBe("enterprise");
      expect(row.uiStatus).toBe("pending-enterprise-decision");
      expect(row.allowedActions).toEqual(["hold", "reject", "start_experiment"]);
      expect(row.evidence).toEqual({
        availability: "available",
        citationCount: 1,
        findingCount: 1,
        hasCase: false,
      });
      expect(row.impactTarget.key).toBeTruthy();
      expect(row).not.toHaveProperty("requiredPermissions");
    }
    expect(rowById(view.rows, "dec-k").correlation).toEqual({ proposalId: "prop-k" });
  });

  it("offers exactly the actions the judge accepts", () => {
    const view = project({
      current: [
        fact({ grant: grant(["hold"]) }),
        fact({ item: { decisionId: "dec-no-grant" }, grant: { status: "missing" } }),
        fact({
          item: {
            decisionId: "dec-memory",
            target: { domain: "knowledge", assetId: "asset-9" },
            surfaceId: "knowledge.managed-memory",
            allowedActions: ["hold", "apply_canary"],
          },
          grant: grant(["hold", "apply"]),
        }),
      ],
    });
    const limited = rowById(view.rows, "dec-k");
    expect(limited.allowedActions).toEqual(["hold"]);
    expect(limited.actionReasons.reject).toBe("scope_widened");
    expect(limited.actionReasons.start_experiment).toBe("scope_widened");
    expect(limited.actionReasons.promote).toBe("action_not_on_item");

    const noGrant = rowById(view.rows, "dec-no-grant");
    expect(noGrant.allowedActions).toEqual([]);
    expect(noGrant.actionReasons.hold).toBe("authorization_required");
    expect(noGrant.uiStatus).toBe("blocked");

    const memory = rowById(view.rows, "dec-memory");
    expect(memory.allowedActions).toEqual(["hold"]);
    expect(memory.actionReasons.apply_canary).toBe("operation_forbidden");

    for (const row of view.rows) {
      for (const action of row.allowedActions) {
        expect(EVOLUTION_DECISION_ENDPOINT_ACTIONS.enterprise).toContain(action);
      }
      expect(row.allowedActions).not.toContain("employee_final_authorization");
    }
  });

  it("keeps platform and system items out unless the enterprise must join a canary", () => {
    const current = [
      canaryFact({
        item: { decisionId: "dec-system", requiredAuthority: "platform" },
        routeInput: { platformFixAffectsEnterprise: false },
      }),
      fact({
        item: {
          decisionId: "dec-public-skill",
          target: { domain: "capability", skillId: "skill-public" },
          surfaceId: "capability.skill-installation",
          requiredAuthority: "platform",
        },
        routeInput: { ownership: { kind: "capability_platform_public" } },
      }),
    ];
    const view = project({ current });
    expect(view.rows).toEqual([]);
    expect(view.phase).toBe("empty");
    expect(hiddenCodes(current)).toEqual([
      { decisionId: "dec-system", code: "audience_mismatch" },
      { decisionId: "dec-public-skill", code: "audience_mismatch" },
    ]);
    expectNoTrace(view, ["dec-system", "dec-public-skill", ...PLATFORM_SECRETS]);
  });

  it("does not let the enterprise approve core system changes", () => {
    for (const action of ["apply_canary", "promote"] as const) {
      const result = submitFact(canaryFact({ grant: grant(["apply", "promote", "platform"]) }), {
        command: command({ decisionId: "dec-canary", action }),
      });
      expect(result.judgement.code).toBe("enterprise_not_core_approver");
      expectZeroWrite(result);
    }
  });
});

describe("employee personal assets", () => {
  it("keeps an undelegated employee agent out of the enterprise surface", () => {
    const current = [
      personalFact({
        item: { requiredAuthority: "employee" },
        routeInput: {
          ownership: { kind: "agent_enterprise", delegated: false },
          touchesEmployeePersonalAsset: false,
        },
      }),
    ];
    const view = project({ current });
    expect(view.rows).toEqual([]);
    expect(hiddenCodes(current)).toEqual([
      { decisionId: "dec-personal", code: "audience_mismatch" },
    ]);
    expectNoTrace(view, ["dec-personal", "agent-7", ...PERSONAL_SECRETS]);
  });

  it("shows a delegated personal-asset change only as a redacted participation row", () => {
    const view = project({ current: [personalFact()] });
    const row = rowById(view.rows, "dec-personal");
    expect(row.view).toBe("enterprise_participation");
    expect(row.participation).toBe("employee_final_authorization");
    expect(row.requiredAuthority).toBe("employee_and_enterprise");
    expect(row.uiStatus).toBe("waiting-employee-authorization");
    expect(row.evidence).toEqual({
      availability: "withheld",
      citationCount: 0,
      findingCount: 0,
      hasCase: false,
    });
    expect(row.correlation).toEqual({});
    expect(row.allowedActions).toEqual(["hold", "reject"]);
    expect(row.actionReasons.start_experiment).toBe("employee_authorization_required");
    expect(row.actionReasons.apply_canary).toBe("employee_authorization_required");
    expect(row.actionReasons.promote).toBe("employee_authorization_required");
    expect(row.actionReasons).not.toHaveProperty("employee_final_authorization");
    const json = JSON.stringify(view);
    for (const secret of PERSONAL_SECRETS) {
      expect(json).not.toContain(secret);
    }
    expect(view.phase).toBe("loaded");
  });

  it("opens forward actions only after the employee's final authorization", () => {
    const view = project({
      current: [personalFact({ authorityFacts: { employeeFinalAuthorization: true } })],
    });
    const row = rowById(view.rows, "dec-personal");
    expect(row.uiStatus).toBe("pending-enterprise-decision");
    expect(row.allowedActions).toEqual([
      "hold",
      "reject",
      "start_experiment",
      "apply_canary",
      "promote",
    ]);
  });

  it("refuses apply without the employee and never lets the enterprise authorize for them", () => {
    const personal = personalFact();
    const apply = submitFact(personal, {
      command: command({ decisionId: "dec-personal", action: "apply_canary" }),
    });
    expect(apply.judgement.code).toBe("employee_authorization_required");
    expectZeroWrite(apply);

    const onBehalf = submitFact(personal, {
      command: command({ decisionId: "dec-personal", action: "employee_final_authorization" }),
    });
    expect(onBehalf.judgement.code).toBe("endpoint_action_forbidden");
    expectZeroWrite(onBehalf);
  });
});

describe("platform canary participation", () => {
  it("offers only participate_canary on a tenant-scoped platform change", () => {
    const view = project({ current: [canaryFact()] });
    const row = rowById(view.rows, "dec-canary");
    expect(row.view).toBe("enterprise_participation");
    expect(row.participation).toBe("enterprise_canary");
    expect(row.requiredAuthority).toBe("platform_and_enterprise");
    expect(row.uiStatus).toBe("participate-platform-canary");
    expect(row.allowedActions).toEqual(["participate_canary"]);
    expect(row.actionReasons.apply_canary).toBe("action_not_on_item");
    expect(row.actionReasons.promote).toBe("action_not_on_item");
    expect(row.evidence.availability).toBe("withheld");
    expect(row.impactTarget).toEqual({
      domain: "system",
      surfaceId: "system.runtime-binding-governance",
    });
    expect(row.correlation).toEqual({});
    const json = JSON.stringify(view);
    for (const secret of [...PLATFORM_SECRETS, "system:runtime"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("watches once the enterprise has acknowledged and offers no second confirmation", () => {
    const acknowledged = canaryFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } });
    const row = rowById(project({ current: [acknowledged] }).rows, "dec-canary");
    expect(row.uiStatus).toBe("watching");
    expect(row.allowedActions).toEqual([]);
    expect(row.actionReasons.participate_canary).toBe("participation_already_satisfied");

    const participate = command({
      commandId: "cmd-canary",
      decisionId: "dec-canary",
      action: "participate_canary",
    });
    const first = canaryFact();
    const accepted = submitFact(first, { command: participate });
    expect(accepted.judgement.receipt.outcome).toBe("accepted");
    const prior = Object.freeze([
      captureEvolutionDecisionCommandRecord({
        command: participate,
        item: first.item,
        principal: principal(),
        auditReceiptRef: accepted.judgement.receipt.auditReceiptRef,
        route: routeEvolutionDecisionSurface(first.routeInput),
      }),
    ]);

    const repeat = submitFact(acknowledged, {
      command: { ...participate, commandId: "cmd-canary-again" },
      prior,
    });
    expect(repeat.judgement.code).toBe("participation_already_satisfied");
    expect(repeat.judgement.receipt.outcome).toBe("blocked");
    expectZeroWrite(repeat);

    const replay = submitFact(acknowledged, { command: participate, prior });
    expect(replay.judgement.code).toBe("idempotent_replay");
    expect(replay.judgement.receipt.auditReceiptRef).toBe(
      accepted.judgement.receipt.auditReceiptRef,
    );
    expectZeroWrite(replay);
  });

  it("omits platform-wide, other-tenant, and cross-tenant repeat canaries", () => {
    const current = [
      canaryFact({ item: { decisionId: "dec-platform-wide", tenantScope: null } }),
      canaryFact({ item: { decisionId: "dec-other", tenantScope: "tenant-b" } }),
      canaryFact({ item: { decisionId: "dec-repeat" }, routeInput: { crossTenantRepeat: true } }),
    ];
    const view = project({ current });
    expect(view.rows).toEqual([]);
    expect(hiddenCodes(current)).toEqual([
      { decisionId: "dec-platform-wide", code: "tenant_mismatch" },
      { decisionId: "dec-other", code: "tenant_mismatch" },
      { decisionId: "dec-repeat", code: "audience_mismatch" },
    ]);
    expectNoTrace(view, [
      "dec-platform-wide",
      "dec-other",
      "dec-repeat",
      "tenant-b",
      ...PLATFORM_SECRETS,
    ]);
  });

  it("accepts the canary confirmation as a plan without executing it", () => {
    const result = submitFact(canaryFact(), {
      command: command({ decisionId: "dec-canary", action: "participate_canary" }),
    });
    expect(result.judgement.receipt.outcome).toBe("accepted");
    expect(result.judgement.controlPlaneAction?.gatewayMethod).toBe("evolution.delegation.approve");
    expect(result.judgement.controlPlaneAction?.callsAdapter).toBe(false);
    expectZeroWrite(result);
  });
});

describe("enterprise week-over-week history", () => {
  it("compares the same decisions across prior and current snapshots", () => {
    const view = project({
      prior: [fact(), personalFact(), canaryFact(), fact({ item: { decisionId: "dec-gone" } })],
      current: [
        fact({ item: { status: "resolved" } }),
        personalFact({ authorityFacts: { employeeFinalAuthorization: true } }),
        canaryFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } }),
        fact({ item: { decisionId: "dec-new", status: "expired" } }),
      ],
    });
    const wow = available(view.weekOverWeek);
    expect(wow.prior).toMatchObject({
      total: 4,
      "pending-enterprise-decision": 2,
      "waiting-employee-authorization": 1,
      "participate-platform-canary": 1,
      completed: 0,
    });
    expect(wow.current).toMatchObject({
      total: 4,
      "pending-enterprise-decision": 1,
      "waiting-employee-authorization": 0,
      "participate-platform-canary": 0,
      watching: 1,
      completed: 1,
      expired: 1,
    });
    expect(wow.delta).toMatchObject({
      total: 0,
      "pending-enterprise-decision": -1,
      "waiting-employee-authorization": -1,
      "participate-platform-canary": -1,
      watching: 1,
      completed: 1,
      expired: 1,
    });
    expect(wow.transitions).toEqual([
      {
        decisionId: "dec-k",
        decisionType: "hold_or_resume",
        from: "pending-enterprise-decision",
        to: "completed",
      },
      {
        decisionId: "dec-personal",
        decisionType: "hold_or_resume",
        from: "waiting-employee-authorization",
        to: "pending-enterprise-decision",
      },
      {
        decisionId: "dec-canary",
        decisionType: "canary_participation",
        from: "participate-platform-canary",
        to: "watching",
      },
      { decisionId: "dec-new", decisionType: "hold_or_resume", from: null, to: "expired" },
      {
        decisionId: "dec-gone",
        decisionType: "hold_or_resume",
        from: "pending-enterprise-decision",
        to: null,
      },
    ]);
  });

  it("filters the prior snapshot through the same D1 rules", () => {
    const hidden = [
      fact({ item: { decisionId: "dec-other-tenant", tenantScope: "tenant-b" } }),
      personalFact({
        item: { decisionId: "dec-undelegated", requiredAuthority: "employee" },
        routeInput: {
          ownership: { kind: "agent_enterprise", delegated: false },
          touchesEmployeePersonalAsset: false,
        },
      }),
      canaryFact({ item: { decisionId: "dec-platform-wide", tenantScope: null } }),
    ];
    const view = project({ prior: [fact(), ...hidden], current: [fact(), ...hidden] });
    const wow = available(view.weekOverWeek);
    expect(wow.prior.total).toBe(1);
    expect(wow.current.total).toBe(1);
    expect(wow.transitions).toEqual([]);
    expectNoTrace(view, ["dec-other-tenant", "dec-undelegated", "dec-platform-wide"]);
  });

  it("is history-unavailable without a usable prior snapshot", () => {
    expect(project({ prior: null }).weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "prior_snapshot_missing",
    });
    const rows = project().rows;
    const reason = (priorAsOf: string, currentAsOf = CURRENT_AS_OF) => {
      const summary = buildEvolutionEnterpriseWeekOverWeekSummary({
        current: { asOf: currentAsOf, rows },
        prior: { asOf: priorAsOf, rows },
      });
      return summary.availability === "history-unavailable" ? summary.reason : "available";
    };
    expect(reason("not-a-date")).toBe("snapshot_as_of_invalid");
    expect(reason(CURRENT_AS_OF)).toBe("prior_not_before_current");
    expect(reason("2026-09-27T12:00:00.000Z")).toBe("prior_snapshot_not_weekly");
    expect(reason(PRIOR_AS_OF)).toBe("available");
    expect(project({ prior: null }).weekOverWeek).not.toHaveProperty("current");
  });
});

describe("idempotency and zero-write", () => {
  it("keeps every outcome zero-write", () => {
    const outcomes = [
      submit(),
      submit({ command: command({ expectedVersion: "stale" }) }),
      submit({ routeInput: routeInput({ surfaceId: "knowledge.managed-memory" }) }),
      submit({ item: item({ status: "resolved" }) }),
    ];
    expect(outcomes.map((result) => result.judgement.code)).toEqual([
      "admissible",
      "version_mismatch",
      "route_binding_mismatch",
      "not_pending",
    ]);
    for (const result of outcomes) {
      expectZeroWrite(result);
    }
  });

  it("replays the same command, refuses a rebind, and binds replays to the principal and route", () => {
    const accepted = submit();
    expect(accepted.judgement.receipt.outcome).toBe("accepted");
    const base = fact();
    const record = captureEvolutionDecisionCommandRecord({
      command: command(),
      item: base.item,
      principal: principal(),
      auditReceiptRef: accepted.judgement.receipt.auditReceiptRef,
      route: routeEvolutionDecisionSurface(base.routeInput),
    });
    const prior = Object.freeze([record]);

    const replay = submit({ prior });
    expect(replay.judgement.code).toBe("idempotent_replay");
    expect(replay.judgement.receipt.auditReceiptRef).toBe(
      accepted.judgement.receipt.auditReceiptRef,
    );
    expectZeroWrite(replay);

    const afterExpiry = submit({ prior, now: "2026-10-09T00:00:00.000Z" });
    expect(afterExpiry.judgement.code).toBe("idempotent_replay");
    expectZeroWrite(afterExpiry);

    const rebind = submit({ prior, command: command({ action: "reject" }) });
    expect(rebind.judgement.code).toBe("command_rebind");
    expectZeroWrite(rebind);

    const drifts: Array<Partial<Parameters<typeof submitEvolutionEnterpriseDecisionCommand>[0]>> = [
      { principal: principal({ enterpriseAdmin: false }) },
      { principal: principal({ trustedTenantId: "tenant-b" }) },
      { item: item({ tenantScope: "tenant-b" }) },
      { item: item({ target: { domain: "knowledge", assetId: "asset-2" } }) },
      { item: item({ requiredAuthority: "platform" }) },
      { routeInput: routeInput({ ownership: { kind: "knowledge_personal" } }) },
    ];
    for (const drift of drifts) {
      const result = submit({ prior, ...drift });
      expect(result.judgement.code).toBe("replay_binding_mismatch");
      expectZeroWrite(result);
    }
    expect(prior).toEqual([record]);
  });

  it("repeated clicks with new command ids stay plans, never executions", () => {
    const first = submit({ command: command({ commandId: "cmd-click-1" }) });
    const second = submit({ command: command({ commandId: "cmd-click-2" }) });
    for (const result of [first, second]) {
      expect(result.judgement.receipt.outcome).toBe("accepted");
      expect(result.judgement.receipt.auditReceiptRef).toMatch(/^decision-plan:/);
      expectZeroWrite(result);
    }
  });
});

describe("snapshot hygiene", () => {
  it("omits duplicate decision ids and marks load-fail and missing evidence as unhealthy", () => {
    const current = [fact(), fact({ item: { status: "resolved" } })];
    const duplicated = project({ current });
    expect(duplicated.rows).toEqual([]);
    expect(hiddenCodes(current)).toEqual([
      { decisionId: "dec-k", code: "duplicate_decision_id" },
      { decisionId: "dec-k", code: "duplicate_decision_id" },
    ]);
    expectNoTrace(duplicated, ["dec-k"]);

    const loadFail = evolutionEnterpriseDecisionLoadFailView();
    expect(loadFail.phase).toBe("load-fail");
    expect(loadFail.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "snapshot_load_failed",
    });

    const noEvidence = project({
      current: [fact({ item: { sourceEvidenceRefs: [], sourceFindingIds: [] } })],
    });
    expect(noEvidence.phase).toBe("evidence-unavailable");
    expect(project({ current: [] }).phase).toBe("empty");
  });
});
