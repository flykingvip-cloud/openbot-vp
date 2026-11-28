import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PRE03_PRODUCT_A_MOCK,
  OFFICIAL_PRE03_PRODUCT_B_MOCK,
  PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED,
  PRE03_PRODUCT_B_MAX_ROWS,
  validatePre03Candidate,
  type Pre03RuleId,
  type Pre03ValidateOptions,
} from "./pre03-zero-pii-validator.js";
import {
  evaluatePre04LeaverPolicy,
  type Pre04LeaverEvent,
  type Pre04ViolationCode,
} from "./pre04-leaver-policy-guard.js";
import {
  FORMAL_T01_T27_ACCEPTED,
  SCHEMA_V7_PROD_MIGRATION_AUTHORIZED,
  addSpaceMember,
  attachKnowledgeBase,
  createEmptyWorld,
  pointerHasForbiddenFields,
  putAgent,
  putAsset,
  putSpace,
  type Actor,
  type FavoritePointer,
  type SpaceFavoritesWorld,
} from "./space-favorites-v7-adapter.js";
import {
  BRIDGE_ZERO_IO,
  OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV,
  SPACE_FAVORITES_V7_ACTIONS,
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV,
  dispatchSpaceFavoritesV7Action,
  isSpaceFavoritesV7GatewayBridgeEnabled,
  readDualSpaceFavoritesV7Switches,
} from "./space-favorites-v7-gateway-bridge.js";
import { projectXv21Headers } from "./w2-interop-harness.js";

/**
 * Wave-V21-7 W7B-2 dual-stack coverage and T-01–T-27 cross-stack ledger.
 *
 * OpenBot-side actually tested: T-01–T-10 and T-18–T-27 (official titles from
 * the frozen W6B-2 matrix). T-11–T-17 are registered as
 * DELEGATED_TO_TEAM_A_CORE_V7; official definition text is not in the frozen
 * pack (F-02 / TEAM_B_HANDOFF_BRIEF §7) and is not invented here.
 *
 * formal_t01_t27_accepted: false — a green runner is not formal acceptance.
 */
export const FORMAL_T01_T27_ACCEPTED_PENDING_FINAL = false as const;

export type CrossStackResponsibility = "OPENBOT_TESTED" | "DELEGATED_TO_TEAM_A_CORE_V7";

// Official titles copied from the frozen W6B-2 OPENBOT_T01_T27_MATRIX.
// This file does not import the matrix test module (avoids re-collecting those tests).
const OPENBOT_SIDE_OFFICIAL_ROWS: Array<{
  id: string;
  officialDefinitionPresent: boolean;
  title: string;
}> = [
  {
    id: "T-01",
    officialDefinitionPresent: true,
    title: "Enterprise A / Enterprise B complete isolation",
  },
  {
    id: "T-02",
    officialDefinitionPresent: true,
    title: "Same-enterprise team knowledge isolation",
  },
  {
    id: "T-03",
    officialDefinitionPresent: true,
    title: "Same-enterprise employee personal-space isolation",
  },
  {
    id: "T-04",
    officialDefinitionPresent: true,
    title: "Independent personal users completely isolated",
  },
  {
    id: "T-05",
    officialDefinitionPresent: true,
    title: "Enterprise admin cannot default-read employee personal space",
  },
  {
    id: "T-06",
    officialDefinitionPresent: true,
    title: "Favorite does not change original asset permissions or copy content",
  },
  {
    id: "T-07",
    officialDefinitionPresent: true,
    title: "After revocation, favorite entry cannot keep reading content",
  },
  {
    id: "T-08",
    officialDefinitionPresent: true,
    title: "Agent-bound KB cannot bypass user permission (User ∩ Agent)",
  },
  {
    id: "T-09",
    officialDefinitionPresent: true,
    title: "Ex-member cannot keep accessing team private knowledge",
  },
  {
    id: "T-10",
    officialDefinitionPresent: true,
    title: "Enterprise identity change must not mis-attribute assets",
  },
  {
    id: "T-11",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-12",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-13",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-14",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-15",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-16",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-17",
    officialDefinitionPresent: false,
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-18",
    officialDefinitionPresent: true,
    title: "Same-tenant collaboration-group product isolation",
  },
  {
    id: "T-19",
    officialDefinitionPresent: true,
    title: "One person in multiple collaboration groups has precise attribution",
  },
  {
    id: "T-20",
    officialDefinitionPresent: true,
    title: "Agent deliverable explicit save is idempotent",
  },
  {
    id: "T-21",
    officialDefinitionPresent: true,
    title: "Save without team write permission is not downgraded to personal space",
  },
  {
    id: "T-22",
    officialDefinitionPresent: true,
    title: "Uncommitted / unindexed deliverable state is honest",
  },
  {
    id: "T-23",
    officialDefinitionPresent: true,
    title: "Existing KB favorites retained; multi-account import must not mix accounts",
  },
  {
    id: "T-24",
    officialDefinitionPresent: true,
    title: "Enterprise seat / source revocation immediately blocks materialized refs",
  },
  {
    id: "T-25",
    officialDefinitionPresent: true,
    title: "Enterprise materialized partial / stale / masked fields stay faithful",
  },
  {
    id: "T-26",
    officialDefinitionPresent: true,
    title: "Source refresh is idempotent single-master; detach must not archive",
  },
  {
    id: "T-27",
    officialDefinitionPresent: true,
    title: "data_capability is not static full-text and must not leak credentials",
  },
];

export const T01_T27_CROSS_STACK_LEDGER = OPENBOT_SIDE_OFFICIAL_ROWS.map((row) => ({
  id: row.id,
  officialDefinitionPresent: row.officialDefinitionPresent,
  title: row.title,
  responsibility: (row.officialDefinitionPresent
    ? "OPENBOT_TESTED"
    : "DELEGATED_TO_TEAM_A_CORE_V7") as CrossStackResponsibility,
}));

const BOTH_ON = {
  [OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV]: "true",
  [SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV]: "true",
} as const;

const alice: Actor = {
  userId: "syn_user_alice",
  tenantId: "syn_tenant_a",
  kind: "employee",
  agentId: "syn_agent_alice",
};

function officialHeadersFor(actor: Actor): Record<string, string> {
  return projectXv21Headers({
    tenant_id: actor.tenantId,
    user_id: actor.userId,
    agent_id: actor.agentId ?? "syn_agent_none",
    trace_id: "syn_trace_w7b2",
    run_id: "syn_run_w7b2",
    plan_id: "syn_plan_w7b2",
    policy_generation: 1,
  });
}

function throwingWorld(): SpaceFavoritesWorld {
  return new Proxy({} as SpaceFavoritesWorld, {
    get(_target, prop) {
      if (prop === "then") {
        return undefined;
      }
      throw new Error("zero-I/O violation: store accessed while switches were unset");
    },
  });
}

function flagUnset(name: string): boolean {
  const value = process.env[name];
  return value === undefined || value === "" || value === "false" || value === "0";
}

function seedWorld(): SpaceFavoritesWorld {
  const world = createEmptyWorld();
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_a_enterprise",
        tenantId: "syn_tenant_a",
        kind: "enterprise",
        memberUserIds: [alice.userId],
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    putAgent(
      world,
      {
        agentId: "syn_agent_alice",
        allowedSpaceIds: ["syn_space_a_enterprise", "syn_space_a_team1"],
        allowedKbIds: ["syn_kb_a_ent", "syn_kb_a_team1"],
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    attachKnowledgeBase(
      world,
      { kbId: "syn_kb_a_ent", spaceId: "syn_space_a_enterprise", tenantId: "syn_tenant_a" },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    putAsset(
      world,
      {
        assetId: "syn_asset_ent_doc",
        kbId: "syn_kb_a_ent",
        spaceId: "syn_space_a_enterprise",
        tenantId: "syn_tenant_a",
        targetType: "asset",
        title: "syn_title_ent",
        body: "syn_body_ent_secret",
        publicationState: "published",
        ingestCommitted: true,
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  return world;
}

function cloneA(): Record<string, unknown> {
  return structuredClone(OFFICIAL_PRE03_PRODUCT_A_MOCK) as Record<string, unknown>;
}

function cloneB(): Record<string, unknown> {
  return structuredClone(OFFICIAL_PRE03_PRODUCT_B_MOCK) as Record<string, unknown>;
}

function rulesOf(candidate: unknown, options?: Pre03ValidateOptions): Pre03RuleId[] {
  return validatePre03Candidate(candidate, options).issues.map((issue) => issue.rule);
}

const OCCURRED = "2026-11-28T18:00:00.000+08:00";

function compliantLeave(): Pre04LeaverEvent {
  return {
    event: "leave",
    occurred_at: OCCURRED,
    freeze_applied_at: "2026-11-28T18:00:30.000+08:00",
    isolation_retention_days: 90,
    isolation_mode: "read-only",
    handover: {
      approvals: [
        { approver_id: "syn_approver_aaa", approved_at: "2026-11-28T18:05:00.000+08:00" },
        { approver_id: "syn_approver_bbb", approved_at: "2026-11-28T18:06:00.000+08:00" },
      ],
      receipt_id: "syn_handover_receipt_001",
    },
    private_body_inheritance: "none",
    controlled_shares: [{ share_id: "syn_share_001", expired: true, expires_at: OCCURRED }],
  };
}

describe("Space v7 dual-stack coverage (W7B-2)", () => {
  it("does not treat a green runner as formal T-01–T-27 acceptance", () => {
    expect(FORMAL_T01_T27_ACCEPTED).toBe(false);
    expect(FORMAL_T01_T27_ACCEPTED_PENDING_FINAL).toBe(false);
    expect(SCHEMA_V7_PROD_MIGRATION_AUTHORIZED).toBe(false);
    expect(PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED).toBe(false);
  });

  it("registers the complete T-01–T-27 cross-stack ledger and delegates T-11–T-17", () => {
    expect(T01_T27_CROSS_STACK_LEDGER).toHaveLength(27);
    expect(T01_T27_CROSS_STACK_LEDGER.map((row) => row.id)).toEqual(
      Array.from({ length: 27 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    );
    const openbot = T01_T27_CROSS_STACK_LEDGER.filter(
      (row) => row.responsibility === "OPENBOT_TESTED",
    ).map((row) => row.id);
    const delegated = T01_T27_CROSS_STACK_LEDGER.filter(
      (row) => row.responsibility === "DELEGATED_TO_TEAM_A_CORE_V7",
    );
    expect(openbot).toEqual([
      "T-01",
      "T-02",
      "T-03",
      "T-04",
      "T-05",
      "T-06",
      "T-07",
      "T-08",
      "T-09",
      "T-10",
      "T-18",
      "T-19",
      "T-20",
      "T-21",
      "T-22",
      "T-23",
      "T-24",
      "T-25",
      "T-26",
      "T-27",
    ]);
    expect(delegated.map((row) => row.id)).toEqual([
      "T-11",
      "T-12",
      "T-13",
      "T-14",
      "T-15",
      "T-16",
      "T-17",
    ]);
    for (const row of delegated) {
      expect(row.officialDefinitionPresent).toBe(false);
      expect(row.title).toBe("Official definition text not in frozen pack");
    }
  });

  it("proves dual switches unset => zero activation across all eight actions", () => {
    expect(flagUnset(OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV)).toBe(true);
    expect(flagUnset(SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV)).toBe(true);
    expect(isSpaceFavoritesV7GatewayBridgeEnabled()).toBe(false);
    expect(readDualSpaceFavoritesV7Switches().both).toBe(false);
    for (const action of SPACE_FAVORITES_V7_ACTIONS) {
      const result = dispatchSpaceFavoritesV7Action({
        action,
        headers: officialHeadersFor(alice),
        actor: alice,
        world: throwingWorld(),
      });
      expect(result, action).toEqual({
        ok: false,
        enabled: false,
        code: "SWITCHES_DISABLED",
        io: BRIDGE_ZERO_IO,
      });
    }
  });

  it("exercises the eight-action full path, SPACE-C03 1:1, PRE-03 12-rule zero-PII, and PRE-04 5-rule freeze when both switches are explicitly enabled", () => {
    const world = seedWorld();
    const headers = officialHeadersFor(alice);

    const created = dispatchSpaceFavoritesV7Action({
      action: "spaces.create",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        teamSource: {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_1",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_team1",
        },
      },
    });
    expect(created.ok).toBe(true);
    expect(addSpaceMember(world, "syn_space_a_team1", alice.userId, { enabled: true }).ok).toBe(
      true,
    );
    const duplicate = dispatchSpaceFavoritesV7Action({
      action: "spaces.create",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        teamSource: {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_1",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_team1_dup",
        },
      },
    });
    expect(duplicate.code).toBe("ORG_TEAM_SPACE_ALREADY_BOUND");
    const department = dispatchSpaceFavoritesV7Action({
      action: "spaces.create",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        teamSource: {
          sourceKind: "department",
          sourceId: "syn_dept_1",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_dept",
        },
      },
    });
    expect(department.code).toBe("DEPARTMENT_AUTO_MAPPING_REJECTED");

    const listed = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
    });
    expect(listed.ok).toBe(true);
    const got = dispatchSpaceFavoritesV7Action({
      action: "spaces.get",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_team1" },
    });
    expect(got.ok).toBe(true);
    const members = dispatchSpaceFavoritesV7Action({
      action: "spaces.members.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_team1" },
    });
    expect(members.ok).toBe(true);
    const bind = dispatchSpaceFavoritesV7Action({
      action: "spaces.kbs.bind",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        kb: { kbId: "syn_kb_a_team1", spaceId: "syn_space_a_team1", tenantId: "syn_tenant_a" },
      },
    });
    expect(bind.ok).toBe(true);
    const pointer: FavoritePointer = { userId: alice.userId, assetId: "syn_asset_ent_doc" };
    const added = dispatchSpaceFavoritesV7Action({
      action: "favorites.add",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { pointer },
    });
    expect(added.ok).toBe(true);
    expect(
      pointerHasForbiddenFields(
        world.favorites.find(
          (fav) => fav.userId === alice.userId && fav.assetId === pointer.assetId,
        ) ?? {},
      ),
    ).toBe(false);
    const favs = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
    });
    expect(favs.ok).toBe(true);
    const removed = dispatchSpaceFavoritesV7Action({
      action: "favorites.remove",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { pointer },
    });
    expect(removed.ok).toBe(true);

    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_A_MOCK).ok).toBe(true);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_B_MOCK).ok).toBe(true);
    const withBody = cloneA();
    withBody.body = "# markdown document body";
    expect(rulesOf(withBody)).toContain(1);
    const withEmail = cloneA();
    withEmail.scope_description = "contact user@example.com in this label";
    expect(rulesOf(withEmail)).toContain(2);
    const extra = cloneA();
    extra.unexpected_column = 1;
    expect(rulesOf(extra)).toContain(3);
    const badFormat = cloneB();
    badFormat.format = "not-the-official-format";
    expect(rulesOf(badFormat)).toContain(4);
    const raw = cloneB();
    (raw.rows as Record<string, unknown>[])[0].legacy_kb_id = "kb_production_raw";
    expect(rulesOf(raw)).toContain(5);
    const root = cloneB();
    root.extra_root = "syn_nope";
    expect(rulesOf(root)).toContain(6);
    const oversize = cloneB();
    const template = (OFFICIAL_PRE03_PRODUCT_B_MOCK.rows[0] ?? {}) as Record<string, unknown>;
    oversize.rows = Array.from({ length: PRE03_PRODUCT_B_MAX_ROWS + 1 }, (_, index) => ({
      ...template,
      legacy_kb_id: `syn_kb_pad_${index}`,
      name_token: `syn_name_pad_${index}`,
    }));
    expect(rulesOf(oversize)).toContain(7);
    const assigned = cloneB();
    (assigned.rows as Record<string, unknown>[])[0].proposed_space_id = "syn_space_too_early";
    expect(rulesOf(assigned)).toContain(8);
    const salt = cloneA();
    salt.salt = "syn_should_not_be_exported";
    expect(rulesOf(salt)).toContain(9);
    const missing = cloneA();
    delete missing.team_count;
    expect(rulesOf(missing, { readmeClaimsCompleteScan: true })).toContain(10);
    const labeled = cloneA();
    labeled.scope_description = "mock tenant_prod_9876 in this label";
    expect(rulesOf(labeled)).toContain(11);
    const sanitized = cloneB();
    sanitized.provenance = "SANITIZED_CANDIDATE";
    expect(
      validatePre03Candidate(sanitized, { acceptSanitizedCandidate: true }).issues.some(
        (issue) => issue.rule === 12,
      ),
    ).toBe(true);

    const validLeave = compliantLeave();
    expect(evaluatePre04LeaverPolicy(validLeave, { enabled: true }).ok).toBe(true);
    const violations: Array<[Pre04LeaverEvent, Pre04ViolationCode]> = [
      [
        { ...validLeave, freeze_applied_at: "2026-11-28T18:02:00.000+08:00" },
        "FREEZE_DEADLINE_EXCEEDED",
      ],
      [{ ...validLeave, isolation_retention_days: 30 }, "ISOLATION_RETENTION_INVALID"],
      [
        {
          ...validLeave,
          handover: {
            approvals: [validLeave.handover!.approvals![0]],
            receipt_id: "syn_handover_receipt_001",
          },
        },
        "HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING",
      ],
      [
        { ...validLeave, private_body_inheritance: "automatic" },
        "PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN",
      ],
      [
        {
          ...validLeave,
          controlled_shares: [{ share_id: "syn_share_open", expired: false, expires_at: OCCURRED }],
        },
        "CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED",
      ],
    ];
    for (const [event, code] of violations) {
      const result = evaluatePre04LeaverPolicy(event, { enabled: true });
      expect(result.ok, code).toBe(false);
      expect(result.violations, code).toContain(code);
    }

    const leaveOk = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { leaverEvent: validLeave },
    });
    expect(leaveOk.ok).toBe(true);
    const leaveFail = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers,
      actor: alice,
      world: throwingWorld(),
      env: BOTH_ON,
      payload: {
        leaverEvent: { ...validLeave, freeze_applied_at: "2026-11-28T18:02:00.000+08:00" },
      },
    });
    expect(leaveFail).toMatchObject({
      ok: false,
      code: "PRE04_POLICY_VIOLATION",
      io: BRIDGE_ZERO_IO,
    });
  });
});
