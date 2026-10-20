import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuthorityGrantView } from "../contracts.js";
import { listEvolutionSurfaces } from "../surfaces.js";
import type { EvolutionTarget } from "../types.js";
import {
  captureEvolutionDecisionCommandRecord,
  EVOLUTION_DECISION_SURFACE_WRITES,
  judgeEvolutionDecisionCommand,
  mapEvolutionDecisionCommand,
  projectEvolutionDecisionStatus,
  projectEvolutionDecisionVisibility,
  readEvolutionDecisionCommand,
  RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID,
  routeEvolutionDecisionSurface,
  type EvolutionDecisionCommand,
  type EvolutionDecisionCommandRecord,
  type EvolutionDecisionItem,
  type EvolutionDecisionOwnership,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionRouteInput,
} from "./index.js";

const NOW = "2026-09-28T00:00:00.000Z";
const LATER = "2026-10-01T00:00:00.000Z";
const EARLIER = "2026-09-01T00:00:00.000Z";

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
    allowedActions: ["hold", "reject", "authorize", "apply_canary"],
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

function command(overrides: Partial<EvolutionDecisionCommand> = {}): EvolutionDecisionCommand {
  return {
    commandId: "cmd-1",
    decisionId: "dec-1",
    action: "hold",
    expectedVersion: "dv-1",
    ...overrides,
  };
}

function judge(overrides: Partial<Parameters<typeof judgeEvolutionDecisionCommand>[0]> = {}) {
  return judgeEvolutionDecisionCommand({
    command: command(),
    item: item(),
    principal: principal(),
    grant: grant(["hold"]),
    facts: { enterpriseCanaryAcknowledged: false, employeeFinalAuthorization: false },
    routeInput: routeInput(),
    now: NOW,
    prior: [],
    ...overrides,
  });
}

describe("decision status projection", () => {
  it("projects pending, resolved, expired, and blocked without storing a decision", () => {
    expect(
      projectEvolutionDecisionStatus({
        proposalStatus: "EXPERIMENTING",
        expiresAt: LATER,
        now: NOW,
        authorityBlocked: false,
      }),
    ).toBe("pending");
    expect(
      projectEvolutionDecisionStatus({
        proposalStatus: "PROMOTED",
        expiresAt: LATER,
        now: NOW,
        authorityBlocked: false,
      }),
    ).toBe("resolved");
    expect(
      projectEvolutionDecisionStatus({
        proposalStatus: "EXPERIMENTING",
        expiresAt: EARLIER,
        now: NOW,
        authorityBlocked: false,
      }),
    ).toBe("expired");
    expect(
      projectEvolutionDecisionStatus({
        proposalStatus: null,
        now: NOW,
        authorityBlocked: false,
      }),
    ).toBe("blocked");
  });
});

describe("surface router", () => {
  const cases: Array<{
    ownership: EvolutionDecisionOwnership;
    target: EvolutionTarget;
    surfaceId: string;
    endpoint: string;
  }> = [
    {
      ownership: { kind: "agent_self" },
      target: { domain: "agent", agentId: "agent-1" },
      surfaceId: "agent.working-dna",
      endpoint: "employee",
    },
    {
      ownership: { kind: "agent_enterprise", delegated: false },
      target: { domain: "agent", agentId: "agent-1" },
      surfaceId: "agent.working-dna",
      endpoint: "employee",
    },
    {
      ownership: { kind: "agent_enterprise", delegated: true },
      target: { domain: "agent", agentId: "agent-1" },
      surfaceId: "agent.working-dna",
      endpoint: "enterprise",
    },
    {
      ownership: { kind: "knowledge_personal" },
      target: { domain: "knowledge", assetId: "asset-1" },
      surfaceId: "knowledge.experience-capsule",
      endpoint: "employee",
    },
    {
      ownership: { kind: "knowledge_enterprise" },
      target: { domain: "knowledge", assetId: "asset-1" },
      surfaceId: "knowledge.experience-capsule",
      endpoint: "enterprise",
    },
    {
      ownership: { kind: "capability_enterprise_private" },
      target: { domain: "capability", skillId: "skill-1" },
      surfaceId: "capability.skill-spec",
      endpoint: "enterprise",
    },
    {
      ownership: { kind: "capability_platform_public" },
      target: { domain: "capability", skillId: "skill-1" },
      surfaceId: "capability.skill-installation",
      endpoint: "platform",
    },
    {
      ownership: { kind: "organization_enterprise" },
      target: { domain: "organization", groupId: "group-1" },
      surfaceId: "organization.task-routing",
      endpoint: "enterprise",
    },
    {
      ownership: { kind: "system" },
      target: { domain: "system", componentId: "runtime" },
      surfaceId: "system.runtime-binding-governance",
      endpoint: "platform",
    },
  ];

  it.each(cases)("routes $ownership.kind to $endpoint", (row) => {
    const route = routeEvolutionDecisionSurface(
      routeInput({
        ownership: row.ownership,
        target: row.target,
        surfaceId: row.surfaceId,
      }),
    );
    expect(route.ok).toBe(true);
    if (route.ok) {
      expect(route.endpoint).toBe(row.endpoint);
    }
  });

  it("sends cross-tenant repeats to the platform and keeps engineering remediation unregistered", () => {
    const repeat = routeEvolutionDecisionSurface(
      routeInput({ crossTenantRepeat: true, platformFixAffectsEnterprise: true }),
    );
    expect(repeat.ok && repeat.endpoint).toBe("platform");
    expect(repeat.ok && repeat.participation).toBe("enterprise_canary");

    const reserved = routeEvolutionDecisionSurface(
      routeInput({
        surfaceId: RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID,
        ownership: { kind: "system" },
        target: { domain: "system", componentId: "repo" },
      }),
    );
    expect(reserved).toMatchObject({
      ok: false,
      code: "surface_not_registered",
      registered: false,
    });
    expect(
      listEvolutionSurfaces().some(
        (surface) => surface.surfaceId === RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID,
      ),
    ).toBe(false);
    expect(routeEvolutionDecisionSurface(routeInput({ surfaceId: "system.secrets" })).ok).toBe(
      false,
    );
  });

  it("requires employee final authorization when an enterprise change touches a personal asset", () => {
    const route = routeEvolutionDecisionSurface(
      routeInput({
        ownership: { kind: "agent_enterprise", delegated: true },
        touchesEmployeePersonalAsset: true,
      }),
    );
    expect(route.ok && route.endpoint).toBe("enterprise");
    expect(route.ok && route.participation).toBe("employee_final_authorization");
    expect(route.ok && route.requiredAuthority).toBe("employee_and_enterprise");
  });
});

describe("command mapping", () => {
  it("points every available decision action at an existing control-plane method and never an adapter", () => {
    for (const action of [
      "start_experiment",
      "hold",
      "reject",
      "approve_application",
      "apply_canary",
      "verify",
      "promote",
      "rollback",
      "participate_canary",
      "employee_final_authorization",
    ] as const) {
      const mapped = mapEvolutionDecisionCommand(action);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.mapping.callsAdapter).toBe(false);
        expect(mapped.mapping.perceptionWrite).toBe(false);
        expect(mapped.mapping.surfaceOperation).not.toBe("suggest");
        expect(mapped.mapping.gatewayMethod.startsWith("evolution.")).toBe(true);
      }
    }
    expect(mapEvolutionDecisionCommand("authorize")).toEqual({
      ok: false,
      code: "control_plane_action_unavailable",
    });
    expect(mapEvolutionDecisionCommand("approve_application")).toEqual({
      ok: true,
      mapping: expect.objectContaining({
        action: "approve_application",
        gatewayMethod: "evolution.applications.approve",
        callsAdapter: false,
        perceptionWrite: false,
      }),
    });
    expect(mapEvolutionDecisionCommand("working-dna")).toEqual({
      ok: false,
      code: "adapter_forbidden",
    });
    expect(mapEvolutionDecisionCommand("evolution.perception.query")).toEqual({
      ok: false,
      code: "perception_readonly",
    });
    expect(mapEvolutionDecisionCommand("daibai_chat_approve")).toEqual({
      ok: false,
      code: "daibai_chat_not_approval",
    });
  });
});

describe("judge", () => {
  it("admits an employee hold without executing it or writing", () => {
    const prior: EvolutionDecisionCommandRecord[] = [];
    const result = judge({ prior });
    expect(result.executed).toBe(false);
    expect(result.effectProof).toBe(false);
    expect(result.writes).toBe(EVOLUTION_DECISION_SURFACE_WRITES);
    expect(result.receipt.outcome).toBe("accepted");
    expect(result.receipt.auditReceiptRef).toBe("decision-plan:cmd-1");
    expect(result.receipt.controlPlaneRef).toBeUndefined();
    expect(result.controlPlaneAction?.callsAdapter).toBe(false);
    expect(prior).toEqual([]);
    expect(() => {
      (result.writes as unknown as string[]).push("ledger");
    }).toThrow(TypeError);
  });

  it("replays the same command after expiry and rejects a rebind", () => {
    const expired = item({ status: "expired", expiresAt: EARLIER });
    const record: EvolutionDecisionCommandRecord = captureEvolutionDecisionCommandRecord({
      command: command(),
      item: expired,
      principal: principal(),
      auditReceiptRef: "audit-existing",
      controlPlaneRef: "proposal:prop-1",
    });
    const prior = Object.freeze([record]);
    const replay = judge({
      prior,
      item: expired,
    });
    expect(replay.receipt.outcome).toBe("idempotent_replay");
    expect(replay.receipt.auditReceiptRef).toBe("audit-existing");
    expect(replay.receipt.controlPlaneRef).toBe("proposal:prop-1");
    expect(prior).toHaveLength(1);
    expect(prior[0]).toBe(record);

    const rebound = judge({
      prior,
      command: command({ decisionId: "dec-2" }),
      item: item({ decisionId: "dec-2" }),
    });
    expect(rebound.code).toBe("command_rebind");
    expect(rebound.receipt.outcome).toBe("rejected");
    expect(rebound.writes).toHaveLength(0);
  });

  it("rejects a fresh command on an expired decision", () => {
    const result = judge({ item: item({ expiresAt: EARLIER }) });
    expect(result.code).toBe("expired");
    expect(result.receipt.outcome).toBe("rejected");
    expect(result.executed).toBe(false);
  });

  it("refuses client authority fields, adapter names, and perception writes", () => {
    const forbidden = judge({
      command: undefined,
      payload: {
        commandId: "cmd-2",
        decisionId: "dec-1",
        action: "hold",
        tenantId: "tenant-b",
        approval: true,
        principalRef: "user-1",
      },
    });
    expect(forbidden.code).toBe("client_authority_forbidden");
    expect(forbidden.writes).toHaveLength(0);

    const adapter = judge({
      command: undefined,
      payload: { commandId: "cmd-3", decisionId: "dec-1", action: "working-dna" },
    });
    expect(adapter.code).toBe("adapter_forbidden");

    const perception = judge({
      command: undefined,
      payload: {
        commandId: "cmd-4",
        decisionId: "dec-1",
        action: "evolution.perception.project",
      },
    });
    expect(perception.code).toBe("perception_readonly");
  });

  it("blocks a platform apply until the enterprise has acknowledged canary participation", () => {
    const shared = {
      item: item({
        tenantScope: null,
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform" as const,
        requiredAuthority: "platform_and_enterprise" as const,
        allowedActions: ["apply_canary", "participate_canary"] as const,
      }),
      principal: principal({
        audience: "platform" as const,
        trustedTenantId: null,
        platformOperator: true,
        ownerAgentId: undefined,
      }),
      grant: grant(["apply", "platform"], null),
      command: command({ action: "apply_canary" }),
      routeInput: routeInput({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" },
        platformFixAffectsEnterprise: true,
      }),
    };
    expect(judge(shared).code).toBe("enterprise_canary_required");
    expect(
      judge({
        ...shared,
        facts: { enterpriseCanaryAcknowledged: true, employeeFinalAuthorization: false },
      }).receipt.outcome,
    ).toBe("accepted");
  });

  it("does not let the enterprise approve a system surface or skip employee authorization", () => {
    const systemAttempt = judge({
      command: command({ action: "apply_canary" }),
      item: item({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        requiredAuthority: "platform",
        allowedActions: ["apply_canary"],
      }),
      principal: principal({
        audience: "enterprise",
        enterpriseAdmin: true,
        platformOperator: false,
      }),
      grant: grant(["apply", "platform"]),
      routeInput: routeInput({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" },
      }),
    });
    expect(systemAttempt.code).toBe("enterprise_not_core_approver");

    const personal = judge({
      command: command({ action: "apply_canary" }),
      item: item({
        confidentialityScope: "enterprise",
        requiredAuthority: "employee_and_enterprise",
        allowedActions: ["apply_canary", "employee_final_authorization"],
      }),
      principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
      grant: grant(["apply"]),
      routeInput: routeInput({
        ownership: { kind: "agent_enterprise", delegated: true },
        touchesEmployeePersonalAsset: true,
      }),
    });
    expect(personal.code).toBe("employee_authorization_required");

    const employeeAuth = judge({
      command: command({ action: "employee_final_authorization" }),
      item: item({
        confidentialityScope: "enterprise",
        requiredAuthority: "employee_and_enterprise",
        allowedActions: ["employee_final_authorization"],
      }),
      grant: grant([]),
      routeInput: routeInput({
        ownership: { kind: "agent_enterprise", delegated: true },
        touchesEmployeePersonalAsset: true,
      }),
    });
    expect(employeeAuth.receipt.outcome).toBe("accepted");
    expect(employeeAuth.controlPlaneAction?.gatewayMethod).toBe("evolution.delegation.approve");
    expect(employeeAuth.executed).toBe(false);
  });

  it("isolates other tenants and other agents in the audience projection", () => {
    const self = item();
    const otherTenant = item({ decisionId: "dec-other", tenantScope: "tenant-b" });
    const otherAgent = item({
      decisionId: "dec-agent",
      target: { domain: "agent", agentId: "agent-2" },
    });
    const route = routeEvolutionDecisionSurface(routeInput());
    const projected = projectEvolutionDecisionVisibility({
      principal: principal(),
      entries: [
        { item: self, route },
        { item: otherTenant, route },
        {
          item: otherAgent,
          route: routeEvolutionDecisionSurface(
            routeInput({ target: { domain: "agent", agentId: "agent-2" } }),
          ),
        },
      ],
    });
    expect(
      projected.visible.map((row) =>
        row.kind === "item" ? row.item.decisionId : row.view.decisionId,
      ),
    ).toEqual(["dec-1"]);
    expect(projected.omitted.map((row) => row.code).sort()).toEqual([
      "owner_mismatch",
      "tenant_mismatch",
    ]);
    expect(JSON.stringify(projected.omitted)).not.toContain("ev-1");
  });
});

describe("replay binding", () => {
  it("rejects a replay when tenant, version, target, surface, authority, or principal differ", () => {
    const storedItem = item();
    const storedPrincipal = principal();
    const record = captureEvolutionDecisionCommandRecord({
      command: command(),
      item: storedItem,
      principal: storedPrincipal,
      auditReceiptRef: "audit-existing",
    });
    const prior = Object.freeze([record]);
    const mismatches: Array<Parameters<typeof judge>[0]> = [
      { item: item({ tenantScope: "tenant-b" }) },
      { item: item({ decisionVersion: "dv-2" }) },
      { item: item({ target: { domain: "agent", agentId: "agent-2" } }) },
      { item: item({ surfaceId: "agent.profile" }) },
      { item: item({ requiredAuthority: "enterprise" }) },
      { principal: principal({ enterpriseAdmin: true }) },
      { principal: principal({ audience: "enterprise", enterpriseAdmin: true }) },
      { principal: principal({ platformOperator: true }) },
      { principal: principal({ ownerAgentId: "agent-9" }) },
    ];
    for (const override of mismatches) {
      const result = judge({ prior, ...override });
      expect(result.code).toBe("replay_binding_mismatch");
      expect(result.receipt.outcome).toBe("rejected");
      expect(result.executed).toBe(false);
      expect(result.writes).toHaveLength(0);
      expect(prior).toHaveLength(1);
    }
  });
});

describe("route and role binding", () => {
  it("fails closed when route input does not match the decision item", () => {
    const surfaceMismatch = judge({
      routeInput: routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_personal" },
      }),
    });
    expect(surfaceMismatch.code).toBe("route_binding_mismatch");

    const authorityMismatch = judge({
      item: item({ requiredAuthority: "enterprise" }),
    });
    expect(authorityMismatch.code).toBe("route_binding_mismatch");
    expect(authorityMismatch.executed).toBe(false);
  });

  it("requires enterpriseAdmin for an enterprise audience and platformOperator for a platform audience", () => {
    const enterprise = judge({
      item: item({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        requiredAuthority: "enterprise",
        confidentialityScope: "enterprise",
        allowedActions: ["hold"],
      }),
      principal: principal({
        audience: "enterprise",
        enterpriseAdmin: false,
        ownerAgentId: undefined,
      }),
      grant: grant(["hold"]),
      routeInput: routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_enterprise" },
      }),
    });
    expect(enterprise.code).toBe("enterprise_admin_required");

    const platform = judge({
      item: item({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        requiredAuthority: "platform",
        confidentialityScope: "platform",
        allowedActions: ["hold"],
      }),
      principal: principal({
        audience: "platform",
        platformOperator: false,
        ownerAgentId: undefined,
      }),
      grant: grant(["hold", "platform"]),
      routeInput: routeInput({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" },
      }),
    });
    expect(platform.code).toBe("platform_operator_required");
  });
});

describe("employee final authorization owner proof", () => {
  it("rejects capability, organization, and system domains", () => {
    const cases = [
      {
        target: { domain: "capability" as const, skillId: "skill-1" },
        surfaceId: "capability.skill-spec",
        ownership: { kind: "capability_enterprise_private" as const },
      },
      {
        target: { domain: "organization" as const, groupId: "group-1" },
        surfaceId: "organization.task-routing",
        ownership: { kind: "organization_enterprise" as const },
      },
      {
        target: { domain: "system" as const, componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" as const },
      },
    ];
    for (const row of cases) {
      const result = judge({
        command: command({ action: "employee_final_authorization", expectedVersion: "" }),
        item: item({
          target: row.target,
          surfaceId: row.surfaceId,
          requiredAuthority: "employee_and_enterprise",
          confidentialityScope: "enterprise",
          allowedActions: ["employee_final_authorization"],
        }),
        grant: grant([]),
        routeInput: routeInput({
          target: row.target,
          surfaceId: row.surfaceId,
          ownership: row.ownership,
          touchesEmployeePersonalAsset: true,
        }),
      });
      expect(result.code).toBe("owner_unproven");
      expect(result.executed).toBe(false);
    }
  });

  it("accepts a knowledge asset only when the server-resolved owner matches", () => {
    const base = {
      command: command({ action: "employee_final_authorization" as const, expectedVersion: "" }),
      item: item({
        target: { domain: "knowledge" as const, assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        requiredAuthority: "employee_and_enterprise" as const,
        confidentialityScope: "enterprise" as const,
        allowedActions: ["employee_final_authorization" as const],
      }),
      grant: grant([]),
      routeInput: routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_enterprise" as const },
        touchesEmployeePersonalAsset: true,
      }),
    };
    expect(
      judge({
        ...base,
        principal: principal({ ownerAgentId: undefined }),
      }).code,
    ).toBe("owner_unproven");
    expect(
      judge({
        ...base,
        principal: principal({ ownerAgentId: undefined, ownerAssetId: "asset-2" }),
      }).code,
    ).toBe("owner_mismatch");
    const accepted = judge({
      ...base,
      principal: principal({ ownerAgentId: undefined, ownerAssetId: "asset-1" }),
    });
    expect(accepted.receipt.outcome).toBe("accepted");
    expect(accepted.executed).toBe(false);
  });
});

describe("endpoint action matrix", () => {
  it("does not let an employee apply, verify, or promote from item actions and a grant alone", () => {
    for (const action of ["apply_canary", "verify", "promote"] as const) {
      const result = judge({
        command: command({ action }),
        item: item({ allowedActions: [action] }),
        grant: grant(["apply", "verify", "promote"]),
      });
      expect(result.code).toBe("endpoint_action_forbidden");
      expect(result.executed).toBe(false);
    }
  });

  it("keeps cross-tenant repeat on a redacted case and refuses surface mutation", () => {
    const shared = {
      item: item({
        tenantScope: null,
        confidentialityScope: "platform" as const,
        requiredAuthority: "platform" as const,
        allowedActions: ["hold", "apply_canary", "verify", "promote", "rollback"] as const,
      }),
      principal: principal({
        audience: "platform" as const,
        trustedTenantId: null,
        platformOperator: true,
        ownerAgentId: undefined,
      }),
      grant: grant(["hold", "apply", "verify", "promote", "rollback", "platform"], null),
      routeInput: routeInput({ crossTenantRepeat: true }),
    };
    expect(judge({ ...shared, command: command({ action: "apply_canary" }) }).code).toBe(
      "cross_tenant_mutation_forbidden",
    );
    expect(judge({ ...shared, command: command({ action: "verify" }) }).code).toBe(
      "cross_tenant_mutation_forbidden",
    );
    expect(judge({ ...shared, command: command({ action: "promote" }) }).code).toBe(
      "cross_tenant_mutation_forbidden",
    );
    const held = judge({ ...shared, command: command({ action: "hold" }) });
    expect(held.receipt.outcome).toBe("accepted");
    expect(held.executed).toBe(false);
    expect(held.effectProof).toBe(false);
  });
});

describe("employee participation visibility", () => {
  it("redacts enterprise evidence and control-plane refs from the employee-final view", () => {
    const enterpriseItem = item({
      confidentialityScope: "enterprise",
      requiredAuthority: "employee_and_enterprise",
      sourceCaseId: "case-1",
      proposalId: "prop-secret",
      experimentId: "exp-secret",
      applicationId: "app-secret",
      verificationId: "ver-secret",
      evidenceAccessGrantRef: "grant-ref",
      delegationGrantRef: "del-ref",
      sourceFindingIds: ["finding-secret"],
      sourceEvidenceRefs: ["ev-secret"],
      allowedActions: ["employee_final_authorization", "apply_canary", "promote", "hold"],
    });
    const projected = projectEvolutionDecisionVisibility({
      principal: principal(),
      entries: [
        {
          item: enterpriseItem,
          route: routeEvolutionDecisionSurface(
            routeInput({
              ownership: { kind: "agent_enterprise", delegated: true },
              touchesEmployeePersonalAsset: true,
            }),
          ),
        },
      ],
    });
    expect(projected.visible).toHaveLength(1);
    const view = projected.visible[0];
    expect(view?.kind).toBe("employee_participation");
    if (view?.kind === "employee_participation") {
      expect(view.view.allowedActions).toEqual(["employee_final_authorization", "hold"]);
      expect(view.view).not.toHaveProperty("sourceEvidenceRefs");
      expect(view.view).not.toHaveProperty("sourceFindingIds");
    }
    const json = JSON.stringify(projected.visible);
    for (const secret of [
      "ev-secret",
      "finding-secret",
      "prop-secret",
      "exp-secret",
      "app-secret",
      "ver-secret",
      "grant-ref",
      "del-ref",
      "case-1",
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("expected version", () => {
  it("requires a non-empty version on state-changing commands and allows omission only for participation", () => {
    expect(judge({ command: command({ expectedVersion: "" }) }).code).toBe("version_required");
    expect(
      judge({
        command: undefined,
        payload: { commandId: "cmd-1", decisionId: "dec-1", action: "hold" },
      }).code,
    ).toBe("version_required");
    expect(
      judge({
        command: undefined,
        payload: {
          commandId: "cmd-1",
          decisionId: "dec-1",
          action: "apply_canary",
          expectedVersion: " ",
        },
      }).code,
    ).toBe("version_required");
    const parsed = readEvolutionDecisionCommand({
      commandId: "cmd-1",
      decisionId: "dec-1",
      action: "participate_canary",
    });
    expect(parsed.ok && parsed.command.expectedVersion).toBe("");
    const participation = judge({
      command: command({ action: "participate_canary", expectedVersion: "" }),
    });
    expect(participation.code).not.toBe("version_required");
    expect(participation.code).not.toBe("version_mismatch");
    const employeeFinal = judge({
      command: command({ action: "employee_final_authorization", expectedVersion: "" }),
      item: item({
        confidentialityScope: "enterprise",
        requiredAuthority: "employee_and_enterprise",
        allowedActions: ["employee_final_authorization"],
      }),
      grant: grant([]),
      routeInput: routeInput({
        ownership: { kind: "agent_enterprise", delegated: true },
        touchesEmployeePersonalAsset: true,
      }),
    });
    expect(employeeFinal.code).not.toBe("version_required");
    expect(employeeFinal.code).not.toBe("version_mismatch");
    expect(employeeFinal.receipt.outcome).toBe("accepted");
  });

  it("rejects stale, future, and whitespace-padded versions and accepts only an exact match", () => {
    const stale = judge({
      item: item({ decisionVersion: "dv-current" }),
      command: command({ expectedVersion: "stale-version" }),
    });
    expect(stale.code).toBe("version_mismatch");
    expect(stale.receipt.outcome).toBe("rejected");
    expect(stale.writes).toEqual([]);
    expect(stale.executed).toBe(false);

    const future = judge({
      item: item({ decisionVersion: "dv-current" }),
      command: command({ expectedVersion: "dv-future" }),
    });
    expect(future.code).toBe("version_mismatch");
    expect(future.writes).toEqual([]);

    const padded = judge({
      item: item({ decisionVersion: "dv-current" }),
      command: command({ expectedVersion: "dv-current " }),
    });
    expect(padded.code).toBe("version_mismatch");

    const exact = judge({
      item: item({ decisionVersion: "dv-current" }),
      command: command({ expectedVersion: "dv-current" }),
    });
    expect(exact.code).toBe("admissible");
    expect(exact.receipt.outcome).toBe("accepted");
    expect(exact.executed).toBe(false);
    expect(exact.effectProof).toBe(false);
  });
});

describe("visibility route binding", () => {
  it("omits a platform system item when an enterprise knowledge route is supplied", () => {
    const systemItem = item({
      target: { domain: "system", componentId: "runtime-binding" },
      surfaceId: "system.runtime-binding-governance",
      requiredAuthority: "platform",
      tenantScope: "tenant-a",
      confidentialityScope: "platform",
      sourceEvidenceRefs: ["ev-platform"],
      sourceFindingIds: ["finding-platform"],
      allowedActions: ["hold", "reject"],
    });
    const enterpriseKnowledgeRoute = routeEvolutionDecisionSurface(
      routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_enterprise" },
      }),
    );
    expect(enterpriseKnowledgeRoute.ok).toBe(true);
    const projected = projectEvolutionDecisionVisibility({
      principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
      entries: [{ item: systemItem, route: enterpriseKnowledgeRoute }],
    });
    expect(projected.visible).toHaveLength(0);
    expect(projected.omitted).toEqual([{ decisionId: "dec-1", code: "route_binding_mismatch" }]);
    expect(JSON.stringify(projected)).not.toContain("ev-platform");
    expect(JSON.stringify(projected)).not.toContain("finding-platform");
  });

  it("omits an enterprise capability item when an employee agent route is supplied", () => {
    const capabilityItem = item({
      target: { domain: "capability", skillId: "cap-1" },
      surfaceId: "capability.skill-installation",
      requiredAuthority: "enterprise",
      confidentialityScope: "enterprise",
      sourceEvidenceRefs: ["ev-enterprise"],
      allowedActions: ["hold", "reject"],
    });
    const employeeRoute = routeEvolutionDecisionSurface(routeInput());
    expect(employeeRoute.ok).toBe(true);
    const projected = projectEvolutionDecisionVisibility({
      principal: principal(),
      entries: [{ item: capabilityItem, route: employeeRoute }],
    });
    expect(projected.visible).toHaveLength(0);
    expect(projected.omitted[0]?.code).toBe("route_binding_mismatch");
    expect(JSON.stringify(projected)).not.toContain("ev-enterprise");
  });

  it("omits when a cross-tenant route flag changes the binding away from the item surface", () => {
    const enterpriseItem = item({
      target: { domain: "knowledge", assetId: "asset-1" },
      surfaceId: "knowledge.experience-capsule",
      requiredAuthority: "enterprise",
      confidentialityScope: "enterprise",
      sourceEvidenceRefs: ["ev-ent"],
      allowedActions: ["hold", "reject"],
    });
    const crossTenantRoute = routeEvolutionDecisionSurface(
      routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_enterprise" },
        crossTenantRepeat: true,
      }),
    );
    expect(crossTenantRoute.ok).toBe(true);
    if (crossTenantRoute.ok) {
      expect(crossTenantRoute.requiredAuthority).toBe("platform");
      expect(crossTenantRoute.requiredAuthority).not.toBe(enterpriseItem.requiredAuthority);
    }
    const projected = projectEvolutionDecisionVisibility({
      principal: principal({
        audience: "platform",
        platformOperator: true,
        trustedTenantId: null,
      }),
      entries: [{ item: enterpriseItem, route: crossTenantRoute }],
    });
    expect(projected.visible).toHaveLength(0);
    expect(projected.omitted[0]?.code).toBe("route_binding_mismatch");
  });
});

describe("unavailable approval actions", () => {
  it("fails closed for authorize instead of treating it as suggest", () => {
    const result = judge({
      command: command({ action: "authorize" }),
      item: item({ allowedActions: ["authorize"] }),
      grant: grant(["suggest", "hold"]),
    });
    expect(result.code).toBe("control_plane_action_unavailable");
    expect(result.receipt.outcome).toBe("rejected");
    expect(result.controlPlaneAction).toBeUndefined();
    expect(result.executed).toBe(false);
  });

  it("maps approve_application to the applications.approve gateway method", () => {
    const mapped = mapEvolutionDecisionCommand("approve_application");
    expect(mapped).toEqual({
      ok: true,
      mapping: expect.objectContaining({
        gatewayMethod: "evolution.applications.approve",
        controlPlaneMethod: "approveApplicationAuthority",
      }),
    });
  });
});

describe("zero-write module boundary", () => {
  it("does not import filesystem, gateway, or adapters", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(directory).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = readFileSync(join(directory, name), "utf8");
      expect(source).not.toContain("node:fs");
      expect(source).not.toContain("node:child_process");
      expect(source).not.toContain("evolution-control");
      expect(source).not.toContain("adapters/");
      expect(source).not.toContain("employee-evolution-perception");
    }
  });
});

describe("enterprise participation visibility (D3)", () => {
  const enterprise = () =>
    principal({ audience: "enterprise", enterpriseAdmin: true, ownerAgentId: undefined });
  const systemTarget = { domain: "system", componentId: "runtime" } as const;
  const canaryRoute = (overrides: Partial<EvolutionDecisionRouteInput> = {}) =>
    routeEvolutionDecisionSurface(
      routeInput({
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" },
        platformFixAffectsEnterprise: true,
        ...overrides,
      }),
    );
  const canaryItem = (overrides: Partial<EvolutionDecisionItem> = {}) =>
    item({
      target: systemTarget,
      surfaceId: "system.runtime-binding-governance",
      confidentialityScope: "platform",
      requiredAuthority: "platform_and_enterprise",
      sourceEvidenceRefs: ["ev-platform"],
      sourceFindingIds: ["finding-platform"],
      sourceCaseId: "case-platform",
      proposalId: "prop-platform",
      applicationId: "app-platform",
      allowedActions: ["participate_canary", "apply_canary", "promote"],
      ...overrides,
    });

  it("redacts employee evidence and control-plane refs on a delegated personal-asset change", () => {
    const personalItem = item({
      confidentialityScope: "personal",
      requiredAuthority: "employee_and_enterprise",
      sourceCaseId: "case-personal",
      proposalId: "prop-personal",
      experimentId: "exp-personal",
      applicationId: "app-personal",
      verificationId: "ver-personal",
      evidenceAccessGrantRef: "ev-grant-personal",
      delegationGrantRef: "del-personal",
      sourceFindingIds: ["finding-personal"],
      sourceEvidenceRefs: ["ev-personal"],
      allowedActions: [
        "employee_final_authorization",
        "apply_canary",
        "promote",
        "hold",
        "participate_canary",
      ],
    });
    const projected = projectEvolutionDecisionVisibility({
      principal: enterprise(),
      entries: [
        {
          item: personalItem,
          route: routeEvolutionDecisionSurface(
            routeInput({
              ownership: { kind: "agent_enterprise", delegated: true },
              touchesEmployeePersonalAsset: true,
            }),
          ),
        },
      ],
    });
    expect(projected.visible).toHaveLength(1);
    const view = projected.visible[0];
    expect(view?.kind).toBe("enterprise_participation");
    if (view?.kind === "enterprise_participation") {
      expect(view.view.participation).toBe("employee_final_authorization");
      expect(view.view.allowedActions).toEqual(["apply_canary", "promote", "hold"]);
      expect(view.view).not.toHaveProperty("sourceEvidenceRefs");
      expect(view.view).not.toHaveProperty("proposalId");
    }
    const json = JSON.stringify(projected);
    for (const secret of [
      "ev-personal",
      "finding-personal",
      "case-personal",
      "prop-personal",
      "exp-personal",
      "app-personal",
      "ver-personal",
      "ev-grant-personal",
      "del-personal",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("keeps an undelegated employee agent out of the enterprise view", () => {
    const projected = projectEvolutionDecisionVisibility({
      principal: enterprise(),
      entries: [
        {
          item: item({ sourceEvidenceRefs: ["ev-undelegated"] }),
          route: routeEvolutionDecisionSurface(
            routeInput({ ownership: { kind: "agent_enterprise", delegated: false } }),
          ),
        },
      ],
    });
    expect(projected.visible).toEqual([]);
    expect(projected.omitted).toEqual([{ decisionId: "dec-1", code: "audience_mismatch" }]);
    expect(JSON.stringify(projected)).not.toContain("ev-undelegated");
  });

  it("gives the affected enterprise a canary participation view without platform evidence", () => {
    const projected = projectEvolutionDecisionVisibility({
      principal: enterprise(),
      entries: [{ item: canaryItem(), route: canaryRoute() }],
    });
    expect(projected.visible).toHaveLength(1);
    const view = projected.visible[0];
    expect(view?.kind).toBe("enterprise_participation");
    if (view?.kind === "enterprise_participation") {
      expect(view.view.participation).toBe("enterprise_canary");
      expect(view.view.allowedActions).toEqual(["participate_canary"]);
    }
    const json = JSON.stringify(projected);
    for (const secret of [
      "ev-platform",
      "finding-platform",
      "case-platform",
      "prop-platform",
      "app-platform",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("omits platform-wide, other-tenant, cross-tenant, and unaffected platform items", () => {
    const projected = projectEvolutionDecisionVisibility({
      principal: enterprise(),
      entries: [
        {
          item: canaryItem({ decisionId: "dec-platform-wide", tenantScope: null }),
          route: canaryRoute(),
        },
        {
          item: canaryItem({ decisionId: "dec-other-tenant", tenantScope: "tenant-b" }),
          route: canaryRoute(),
        },
        {
          item: canaryItem({ decisionId: "dec-repeat" }),
          route: canaryRoute({ crossTenantRepeat: true }),
        },
        {
          item: canaryItem({ decisionId: "dec-unaffected", requiredAuthority: "platform" }),
          route: canaryRoute({ platformFixAffectsEnterprise: false }),
        },
      ],
    });
    expect(projected.visible).toEqual([]);
    expect(projected.omitted).toEqual([
      { decisionId: "dec-platform-wide", code: "tenant_mismatch" },
      { decisionId: "dec-other-tenant", code: "tenant_mismatch" },
      { decisionId: "dec-repeat", code: "audience_mismatch" },
      { decisionId: "dec-unaffected", code: "audience_mismatch" },
    ]);
    expect(JSON.stringify(projected)).not.toContain("ev-platform");
  });

  it("does not show the enterprise canary view to an employee", () => {
    const projected = projectEvolutionDecisionVisibility({
      principal: principal(),
      entries: [{ item: canaryItem(), route: canaryRoute() }],
    });
    expect(projected.visible).toEqual([]);
    expect(projected.omitted[0]?.code).toBe("audience_mismatch");
  });
});

describe("participation actions stay on their participation route (D3)", () => {
  it("refuses participate_canary and final authorization off their routes", () => {
    const enterpriseKnowledge = judge({
      command: command({ action: "participate_canary" }),
      item: item({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        requiredAuthority: "enterprise",
        confidentialityScope: "enterprise",
        allowedActions: ["participate_canary", "hold"],
      }),
      principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
      grant: grant(["observe", "hold"]),
      routeInput: routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_enterprise" },
      }),
    });
    expect(enterpriseKnowledge.code).toBe("participation_required");
    expect(enterpriseKnowledge.writes).toHaveLength(0);

    const ownFinal = judge({
      command: command({ action: "employee_final_authorization" }),
      item: item({ allowedActions: ["employee_final_authorization", "hold"] }),
      grant: grant(["observe", "hold"]),
    });
    expect(ownFinal.code).toBe("participation_required");
    expect(ownFinal.executed).toBe(false);
  });

  it("admits the enterprise canary confirmation on its own tenant-scoped route", () => {
    const result = judge({
      command: command({ action: "participate_canary" }),
      item: item({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        requiredAuthority: "platform_and_enterprise",
        allowedActions: ["participate_canary"],
      }),
      principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
      grant: { status: "missing" },
      routeInput: routeInput({
        target: { domain: "system", componentId: "runtime" },
        surfaceId: "system.runtime-binding-governance",
        ownership: { kind: "system" },
        platformFixAffectsEnterprise: true,
      }),
    });
    expect(result.receipt.outcome).toBe("accepted");
    expect(result.controlPlaneAction?.gatewayMethod).toBe("evolution.delegation.approve");
    expect(result.executed).toBe(false);
    expect(result.effectProof).toBe(false);
    expect(result.writes).toHaveLength(0);
  });
});

describe("enterprise client authority fields (D3)", () => {
  it("refuses client-declared enterprise identity, principal, and delegation fields", () => {
    for (const field of [
      "enterpriseId",
      "enterpriseAdmin",
      "platformOperator",
      "trustedTenantId",
      "audience",
      "ownerAgentId",
      "ownerAssetId",
      "delegation",
    ]) {
      const result = judge({
        command: undefined,
        payload: {
          commandId: `cmd-${field}`,
          decisionId: "dec-1",
          action: "hold",
          expectedVersion: "dv-1",
          [field]: field === "delegation" ? { grantId: "grant-1" } : true,
        },
      });
      expect(result.code).toBe("client_authority_forbidden");
      expect(result.receipt.outcome).toBe("rejected");
      expect(result.writes).toHaveLength(0);
      expect(result.executed).toBe(false);
    }
  });
});

describe("replay route binding (D3)", () => {
  const enterprise = principal({ audience: "enterprise", enterpriseAdmin: true });
  const sharedItem = item({
    target: { domain: "capability", skillId: "skill-1" },
    surfaceId: "capability.skill-installation",
    requiredAuthority: "employee_and_enterprise",
    confidentialityScope: "enterprise",
    allowedActions: ["hold"],
  });
  const enterpriseRoute = routeInput({
    target: { domain: "capability", skillId: "skill-1" },
    surfaceId: "capability.skill-installation",
    ownership: { kind: "capability_enterprise_private" },
    touchesEmployeePersonalAsset: true,
  });
  const platformRoute = routeInput({
    ...enterpriseRoute,
    ownership: { kind: "capability_platform_public" },
  });

  it("rejects a replay after the route endpoint moved, even with the same item", () => {
    expect(routeEvolutionDecisionSurface(enterpriseRoute)).toMatchObject({
      endpoint: "enterprise",
      requiredAuthority: "employee_and_enterprise",
    });
    expect(routeEvolutionDecisionSurface(platformRoute)).toMatchObject({
      endpoint: "platform",
      requiredAuthority: "employee_and_enterprise",
    });
    const accepted = judge({
      item: sharedItem,
      principal: enterprise,
      grant: grant(["hold"]),
      routeInput: enterpriseRoute,
    });
    expect(accepted.receipt.outcome).toBe("accepted");
    const prior = [
      captureEvolutionDecisionCommandRecord({
        command: command(),
        item: sharedItem,
        principal: enterprise,
        auditReceiptRef: accepted.receipt.auditReceiptRef,
        route: routeEvolutionDecisionSurface(enterpriseRoute),
      }),
    ];
    const replay = judge({
      item: sharedItem,
      principal: enterprise,
      routeInput: enterpriseRoute,
      prior,
    });
    expect(replay.code).toBe("idempotent_replay");
    expect(replay.writes).toHaveLength(0);

    const moved = judge({
      item: sharedItem,
      principal: enterprise,
      routeInput: platformRoute,
      prior,
    });
    expect(moved.code).toBe("replay_binding_mismatch");
    expect(moved.executed).toBe(false);
    expect(moved.writes).toHaveLength(0);
  });

  it("rejects a replay whose route no longer binds to the item", () => {
    const record = captureEvolutionDecisionCommandRecord({
      command: command(),
      item: item(),
      principal: principal(),
      auditReceiptRef: "audit-existing",
    });
    const result = judge({
      prior: [record],
      routeInput: routeInput({
        target: { domain: "knowledge", assetId: "asset-1" },
        surfaceId: "knowledge.experience-capsule",
        ownership: { kind: "knowledge_personal" },
      }),
    });
    expect(result.code).toBe("replay_binding_mismatch");
    expect(result.writes).toHaveLength(0);
  });
});

describe("participation is confirmed once (D3.2)", () => {
  const acknowledged = { enterpriseCanaryAcknowledged: true, employeeFinalAuthorization: false };
  const authorized = { enterpriseCanaryAcknowledged: false, employeeFinalAuthorization: true };

  const canary = {
    command: command({ commandId: "cmd-canary", action: "participate_canary" }),
    item: item({
      target: { domain: "system", componentId: "runtime" },
      surfaceId: "system.runtime-binding-governance",
      confidentialityScope: "platform",
      requiredAuthority: "platform_and_enterprise",
      allowedActions: ["participate_canary"],
    }),
    principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
    grant: { status: "missing" } as const,
    routeInput: routeInput({
      target: { domain: "system", componentId: "runtime" },
      surfaceId: "system.runtime-binding-governance",
      ownership: { kind: "system" },
      platformFixAffectsEnterprise: true,
    }),
  };

  const finalAuthorization = {
    command: command({ commandId: "cmd-final", action: "employee_final_authorization" }),
    item: item({
      requiredAuthority: "employee_and_enterprise",
      confidentialityScope: "enterprise",
      allowedActions: ["hold", "employee_final_authorization"],
    }),
    grant: grant([]),
    routeInput: routeInput({
      ownership: { kind: "agent_enterprise", delegated: true },
      touchesEmployeePersonalAsset: true,
    }),
  };

  function expectZeroWrite(result: ReturnType<typeof judge>): void {
    expect(result.writes).toEqual([]);
    expect(result.executed).toBe(false);
    expect(result.effectProof).toBe(false);
  }

  function acceptedRecord(
    input: typeof canary | typeof finalAuthorization,
    who: EvolutionDecisionPrincipal,
  ): EvolutionDecisionCommandRecord {
    const accepted = judge({ ...input, principal: who });
    expect(accepted.receipt.outcome).toBe("accepted");
    return captureEvolutionDecisionCommandRecord({
      command: input.command,
      item: input.item,
      principal: who,
      auditReceiptRef: accepted.receipt.auditReceiptRef,
      route: routeEvolutionDecisionSurface(input.routeInput),
    });
  }

  it("refuses a second canary confirmation once the enterprise has acknowledged", () => {
    const record = acceptedRecord(canary, canary.principal);
    const repeat = judge({
      ...canary,
      command: command({ commandId: "cmd-canary-again", action: "participate_canary" }),
      facts: acknowledged,
      prior: [record],
    });
    expect(repeat.code).toBe("participation_already_satisfied");
    expect(repeat.receipt.outcome).toBe("blocked");
    expect(repeat.receipt.auditReceiptRef).toBe(
      "decision-refusal:cmd-canary-again:participation_already_satisfied",
    );
    expect(repeat.controlPlaneAction).toBeUndefined();
    expectZeroWrite(repeat);

    const replay = judge({ ...canary, facts: acknowledged, prior: [record] });
    expect(replay.code).toBe("idempotent_replay");
    expect(replay.receipt.auditReceiptRef).toBe(record.auditReceiptRef);
    expectZeroWrite(replay);
  });

  it("refuses a second final authorization once the owner's is recorded", () => {
    const owner = principal();
    const record = acceptedRecord(finalAuthorization, owner);
    const repeat = judge({
      ...finalAuthorization,
      command: command({
        commandId: "cmd-final-again",
        action: "employee_final_authorization",
      }),
      principal: owner,
      facts: authorized,
      prior: [record],
    });
    expect(repeat.code).toBe("participation_already_satisfied");
    expect(repeat.receipt.outcome).toBe("blocked");
    expectZeroWrite(repeat);

    const replay = judge({
      ...finalAuthorization,
      principal: owner,
      facts: authorized,
      prior: [record],
    });
    expect(replay.code).toBe("idempotent_replay");
    expect(replay.receipt.auditReceiptRef).toBe(record.auditReceiptRef);
    expectZeroWrite(replay);
  });

  it("tells only an otherwise admitted principal that participation is already done", () => {
    const canaryRefusals = [
      judge({
        ...canary,
        principal: principal({ audience: "enterprise", enterpriseAdmin: false }),
        facts: acknowledged,
      }).code,
      judge({
        ...canary,
        principal: principal({
          audience: "enterprise",
          enterpriseAdmin: true,
          trustedTenantId: "tenant-b",
        }),
        facts: acknowledged,
      }).code,
      judge({
        ...canary,
        routeInput: { ...canary.routeInput, crossTenantRepeat: true },
        facts: acknowledged,
      }).code,
    ];
    expect(canaryRefusals).toEqual([
      "enterprise_admin_required",
      "tenant_mismatch",
      "cross_tenant_mutation_forbidden",
    ]);

    const finalRefusals = [
      judge({
        ...finalAuthorization,
        principal: principal({ ownerAgentId: "agent-2" }),
        facts: authorized,
      }).code,
      judge({
        ...finalAuthorization,
        principal: principal({ ownerAgentId: undefined }),
        facts: authorized,
      }).code,
      judge({
        ...finalAuthorization,
        principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
        facts: authorized,
      }).code,
    ];
    expect(finalRefusals).toEqual([
      "owner_mismatch",
      "owner_unproven",
      "endpoint_action_forbidden",
    ]);
  });

  it("still admits the first confirmation and leaves other actions to their own gates", () => {
    expect(judge({ ...canary }).code).toBe("admissible");
    expect(judge({ ...finalAuthorization }).code).toBe("admissible");
    const holdAfterAuthorization = judge({
      ...finalAuthorization,
      command: command({ commandId: "cmd-hold", action: "hold" }),
      principal: principal({ audience: "enterprise", enterpriseAdmin: true }),
      grant: grant(["hold"]),
      facts: authorized,
    });
    expect(holdAfterAuthorization.code).toBe("admissible");
  });
});
