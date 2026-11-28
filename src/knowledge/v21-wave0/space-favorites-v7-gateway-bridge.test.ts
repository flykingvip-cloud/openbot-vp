import { describe, expect, it } from "vitest";
import { AI_EXECUTION_TRACE_HEADER_KEYS } from "./ai-execution-trace-header-propagator.js";
import {
  FORMAL_T01_T27_ACCEPTED,
  SCHEMA_V7_PROD_MIGRATION_AUTHORIZED,
  SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE,
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT,
  addSpaceMember,
  attachKnowledgeBase,
  createEmptyWorld,
  isSpaceFavoritesV7AdapterEnvEnabled,
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
  OFFICIAL_X_V21_TRACE_HEADER_NAMES,
  OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV,
  SPACE_FAVORITES_V7_ACTIONS,
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV,
  SPACE_FAVORITES_V7_GATEWAY_BRIDGE_ENABLED_DEFAULT,
  dispatchSpaceFavoritesV7Action,
  isKnowledgeSdkV2EnvEnabled,
  isSpaceFavoritesV7GatewayBridgeEnabled,
  readDualSpaceFavoritesV7Switches,
  requireOfficialXv21Headers,
} from "./space-favorites-v7-gateway-bridge.js";
import { X_V21_HEADER_NAMES, projectXv21Headers } from "./w2-interop-harness.js";

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
const adminA: Actor = {
  userId: "syn_user_admin_a",
  tenantId: "syn_tenant_a",
  kind: "enterprise_admin",
  orgRoles: ["admin"],
  publicKbAdmin: true,
  agentId: "syn_agent_admin_a",
};

function officialHeadersFor(actor: Actor): Record<string, string> {
  return projectXv21Headers({
    tenant_id: actor.tenantId,
    user_id: actor.userId,
    agent_id: actor.agentId ?? "syn_agent_none",
    trace_id: "syn_trace_w7b1",
    run_id: "syn_run_w7b1",
    plan_id: "syn_plan_w7b1",
    policy_generation: 1,
  });
}

function throwingWorld(): SpaceFavoritesWorld {
  const trap = (): never => {
    throw new Error("zero-I/O violation: store accessed while the bridge must Fail-Closed");
  };
  return new Proxy({} as SpaceFavoritesWorld, {
    get(_target, prop) {
      if (prop === "then") {
        return undefined;
      }
      return trap();
    },
  });
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
        memberUserIds: [alice.userId, adminA.userId],
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_a_alice_personal",
        tenantId: "syn_tenant_a",
        kind: "personal",
        ownerUserId: alice.userId,
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
        allowedSpaceIds: [
          "syn_space_a_enterprise",
          "syn_space_a_alice_personal",
          "syn_space_a_team1",
        ],
        allowedKbIds: ["syn_kb_a_ent", "syn_kb_a_alice_p1", "syn_kb_a_team1"],
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    putAgent(
      world,
      {
        agentId: "syn_agent_admin_a",
        allowedSpaceIds: ["syn_space_a_enterprise"],
        allowedKbIds: ["syn_kb_a_ent"],
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
    attachKnowledgeBase(
      world,
      {
        kbId: "syn_kb_a_alice_p1",
        spaceId: "syn_space_a_alice_personal",
        tenantId: "syn_tenant_a",
      },
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
        chunks: ["syn_chunk_ent"],
        embedding: [0.11],
        evidence: { quote: "syn_evidence_ent" },
        publicationState: "published",
        ingestCommitted: true,
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  expect(
    putAsset(
      world,
      {
        assetId: "syn_asset_alice_personal",
        kbId: "syn_kb_a_alice_p1",
        spaceId: "syn_space_a_alice_personal",
        tenantId: "syn_tenant_a",
        targetType: "asset",
        title: "syn_title_alice_personal_sentinel",
        body: "syn_body_alice_personal_secret",
        publicationState: "published",
        ingestCommitted: true,
      },
      { enabled: true },
    ).ok,
  ).toBe(true);
  return world;
}

function flagUnset(name: string): boolean {
  const value = process.env[name];
  return value === undefined || value === "" || value === "false" || value === "0";
}

describe("Space / Favorites v7 Gateway bridge (W7B-1, default-off)", () => {
  it("stays default-off, requires both env flags, and does not authorize prod migration or formal T-01–T-27", () => {
    expect(SPACE_FAVORITES_V7_GATEWAY_BRIDGE_ENABLED_DEFAULT).toBe(false);
    expect(SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT).toBe(false);
    expect(SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE).toBe(1);
    expect(SCHEMA_V7_PROD_MIGRATION_AUTHORIZED).toBe(false);
    expect(FORMAL_T01_T27_ACCEPTED).toBe(false);
    expect(flagUnset(OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV)).toBe(true);
    expect(flagUnset(SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV)).toBe(true);
    expect(isKnowledgeSdkV2EnvEnabled()).toBe(false);
    expect(isSpaceFavoritesV7AdapterEnvEnabled()).toBe(false);
    expect(isSpaceFavoritesV7GatewayBridgeEnabled()).toBe(false);
    expect(readDualSpaceFavoritesV7Switches().both).toBe(false);
  });

  it("Fail-Closes with zero I/O when either switch is unset or false, without touching the store", () => {
    const world = throwingWorld();
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { [OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV]: "true" },
      { [SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV]: "true" },
      {
        [OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV]: "false",
        [SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV]: "true",
      },
      {
        [OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV]: "true",
        [SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV]: "false",
      },
    ];
    for (const env of cases) {
      const result = dispatchSpaceFavoritesV7Action({
        action: "spaces.list",
        headers: officialHeadersFor(alice),
        actor: alice,
        world,
        env,
      });
      expect(result).toEqual({
        ok: false,
        enabled: false,
        code: "SWITCHES_DISABLED",
        io: BRIDGE_ZERO_IO,
      });
    }
  });

  it("uses the official 7-key X-V21-* names and Fail-Closes with zero I/O when any key is missing", () => {
    expect([...OFFICIAL_X_V21_TRACE_HEADER_NAMES]).toEqual([
      "X-V21-Tenant-Id",
      "X-V21-User-Id",
      "X-V21-Agent-Id",
      "X-V21-Trace-Id",
      "X-V21-Run-Id",
      "X-V21-Plan-Id",
      "X-V21-Policy-Generation",
    ]);
    expect(OFFICIAL_X_V21_TRACE_HEADER_NAMES).toEqual(
      AI_EXECUTION_TRACE_HEADER_KEYS.map((key) => X_V21_HEADER_NAMES[key]),
    );
    const complete = officialHeadersFor(alice);
    const parsed = requireOfficialXv21Headers(complete);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.outgoing)).toEqual([...OFFICIAL_X_V21_TRACE_HEADER_NAMES]);
    }
    const missingKey = "X-V21-Trace-Id";
    const incomplete = { ...complete };
    delete incomplete[missingKey];
    const result = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers: incomplete,
      actor: alice,
      world: throwingWorld(),
      env: BOTH_ON,
    });
    expect(result.ok).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.code).toBe("MISSING_OR_INVALID_HEADER");
    expect(result.io).toEqual(BRIDGE_ZERO_IO);
    expect(result.missingHeaders).toEqual([missingKey]);
    expect(result.outgoingHeaders).toBeUndefined();
  });

  it("force-passes the official 7 X-V21-* headers through on enabled dispatches", () => {
    const headers = officialHeadersFor(alice);
    const result = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: alice,
      world: seedWorld(),
      env: BOTH_ON,
    });
    expect(result.ok).toBe(true);
    expect(result.outgoingHeaders).toEqual(headers);
    expect(Object.keys(result.outgoingHeaders ?? {})).toEqual([
      ...OFFICIAL_X_V21_TRACE_HEADER_NAMES,
    ]);
  });

  it("Fail-Closes when official headers do not bind to the actor (zero I/O)", () => {
    const headers = officialHeadersFor(alice);
    headers["X-V21-User-Id"] = "syn_user_intruder";
    const result = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: alice,
      world: throwingWorld(),
      env: BOTH_ON,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("HEADER_ACTOR_MISMATCH");
    expect(result.io).toEqual(BRIDGE_ZERO_IO);
    expect(result.outgoingHeaders).toEqual(headers);
  });

  it("exercises all eight Space/Favorites actions when both switches are explicitly enabled", () => {
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
    expect(created.code).toBe("OK");
    expect(addSpaceMember(world, "syn_space_a_team1", alice.userId, { enabled: true }).ok).toBe(
      true,
    );

    const listed = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
    });
    expect(listed.ok).toBe(true);
    expect(listed.value?.kind).toBe("spaces");
    const spaceIds =
      listed.value && listed.value.kind === "spaces"
        ? listed.value.spaces.map((space) => space.spaceId)
        : [];
    expect(spaceIds).toEqual(
      expect.arrayContaining([
        "syn_space_a_enterprise",
        "syn_space_a_alice_personal",
        "syn_space_a_team1",
      ]),
    );

    const got = dispatchSpaceFavoritesV7Action({
      action: "spaces.get",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_team1" },
    });
    expect(got.ok).toBe(true);
    expect(got.value?.kind).toBe("space");

    const members = dispatchSpaceFavoritesV7Action({
      action: "spaces.members.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_team1" },
    });
    expect(members.ok).toBe(true);
    if (members.value?.kind === "members") {
      expect(members.value.memberUserIds).toContain(alice.userId);
    }

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
    const stored = world.favorites.find(
      (fav) => fav.userId === alice.userId && fav.assetId === pointer.assetId,
    );
    expect(stored).toEqual(pointer);
    expect(pointerHasForbiddenFields(stored ?? {})).toBe(false);

    const listedFavs = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
    });
    expect(listedFavs.ok).toBe(true);
    expect(listedFavs.io.hydration).toBe(1);
    if (listedFavs.value?.kind === "favorites") {
      expect(listedFavs.value.views).toHaveLength(1);
      const view = listedFavs.value.views[0];
      expect(view).toMatchObject({
        status: "authorized",
        assetId: "syn_asset_ent_doc",
        userId: alice.userId,
      });
      expect(JSON.stringify(view)).not.toContain("syn_body_ent_secret");
      expect(JSON.stringify(view)).not.toContain("syn_chunk_ent");
      expect(JSON.stringify(view)).not.toContain("syn_evidence_ent");
      expect(JSON.stringify(view)).not.toContain("syn_title_ent");
    }

    const removed = dispatchSpaceFavoritesV7Action({
      action: "favorites.remove",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: { pointer },
    });
    expect(removed.ok).toBe(true);
    expect(SPACE_FAVORITES_V7_ACTIONS).toHaveLength(8);
  });

  it("keeps SPACE-C03 phase one: 1 organization_team = 1 Team Space and rejects department auto-mapping", () => {
    const world = seedWorld();
    const headers = officialHeadersFor(alice);
    const first = dispatchSpaceFavoritesV7Action({
      action: "spaces.create",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        teamSource: {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_c03",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_team_c03",
        },
      },
    });
    expect(first.ok).toBe(true);
    const duplicate = dispatchSpaceFavoritesV7Action({
      action: "spaces.create",
      headers,
      actor: alice,
      world,
      env: BOTH_ON,
      payload: {
        teamSource: {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_c03",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_team_c03_dup",
        },
      },
    });
    expect(duplicate.ok).toBe(false);
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
    expect(department.ok).toBe(false);
    expect(department.code).toBe("DEPARTMENT_AUTO_MAPPING_REJECTED");
  });

  it("Fail-Closes when an enterprise admin reads an employee personal space (anti side-channel)", () => {
    const world = seedWorld();
    const headers = officialHeadersFor(adminA);
    const getPersonal = dispatchSpaceFavoritesV7Action({
      action: "spaces.get",
      headers,
      actor: adminA,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_alice_personal" },
    });
    const listMembers = dispatchSpaceFavoritesV7Action({
      action: "spaces.members.list",
      headers,
      actor: adminA,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_alice_personal" },
    });
    const missing = dispatchSpaceFavoritesV7Action({
      action: "spaces.get",
      headers,
      actor: adminA,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_missing" },
    });
    expect(getPersonal).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(listMembers).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(missing).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    const listed = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: adminA,
      world,
      env: BOTH_ON,
    });
    const ids =
      listed.value && listed.value.kind === "spaces"
        ? listed.value.spaces.map((space) => space.spaceId)
        : [];
    expect(ids).not.toContain("syn_space_a_alice_personal");
  });

  it("applies User∩Agent permission intersection on space visibility", () => {
    const world = seedWorld();
    const restricted: Actor = { ...alice, agentId: "syn_agent_alice_restricted" };
    expect(
      putAgent(
        world,
        {
          agentId: "syn_agent_alice_restricted",
          allowedSpaceIds: ["syn_space_a_enterprise"],
          allowedKbIds: ["syn_kb_a_ent"],
        },
        { enabled: true },
      ).ok,
    ).toBe(true);
    const headers = officialHeadersFor(restricted);
    const listed = dispatchSpaceFavoritesV7Action({
      action: "spaces.list",
      headers,
      actor: restricted,
      world,
      env: BOTH_ON,
    });
    const ids =
      listed.value && listed.value.kind === "spaces"
        ? listed.value.spaces.map((space) => space.spaceId)
        : [];
    expect(ids).toEqual(["syn_space_a_enterprise"]);
    const personal = dispatchSpaceFavoritesV7Action({
      action: "spaces.get",
      headers,
      actor: restricted,
      world,
      env: BOTH_ON,
      payload: { spaceId: "syn_space_a_alice_personal" },
    });
    expect(personal).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("Fail-Closes with zero store I/O when a PRE-04 leaver policy is violated", () => {
    const result = dispatchSpaceFavoritesV7Action({
      action: "favorites.list",
      headers: officialHeadersFor(alice),
      actor: alice,
      world: throwingWorld(),
      env: BOTH_ON,
      payload: {
        leaverEvent: {
          event: "leave",
          occurred_at: "2026-11-28T18:00:00.000+08:00",
          freeze_applied_at: "2026-11-28T18:02:00.000+08:00",
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
          controlled_shares: [
            {
              share_id: "syn_share_001",
              expired: true,
              expires_at: "2026-11-28T18:00:00.000+08:00",
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PRE04_POLICY_VIOLATION");
    expect(result.io).toEqual(BRIDGE_ZERO_IO);
    expect(result.pre04?.violations).toContain("FREEZE_DEADLINE_EXCEEDED");
  });
});
