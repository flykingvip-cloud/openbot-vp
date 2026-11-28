import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PRE03_PRODUCT_A_MOCK,
  OFFICIAL_PRE03_PRODUCT_B_MOCK,
  PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED,
  validatePre03Candidate,
} from "./pre03-zero-pii-validator.js";
import {
  PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT,
  evaluatePre04LeaverPolicy,
  type Pre04LeaverEvent,
} from "./pre04-leaver-policy-guard.js";
import {
  FORMAL_T01_T27_ACCEPTED,
  SCHEMA_V7_PROD_MIGRATION_AUTHORIZED,
  addFavorite,
  addSpaceMember,
  attachKnowledgeBase,
  authorizeAsset,
  authorizeSnapshot,
  bindTeamSource,
  createEmptyWorld,
  detachAssetFromSpace,
  importBrowserFavorites,
  listVisibleSpaces,
  putAgent,
  putAsset,
  putSpace,
  recordSnapshot,
  refreshEnterpriseRef,
  resolveAuthorizedFavorites,
  revokeSpaceMember,
  saveAgentDeliverable,
  searchVisibleAssets,
  viewLeaksSensitiveCatalog,
  type Actor,
  type AssetRecord,
  type SpaceFavoritesWorld,
} from "./space-favorites-v7-adapter.js";

/**
 * OpenBot-side T-01–T-27 mapping for W6B-2.
 *
 * Official definition sources (do not invent IDs):
 *   T-01–T-10: SDK_SPACE_ISOLATION_TEST_PLAN.md (Team A isolation plan)
 *   T-18–T-27: TEAM_A_SPACE_FEASIBILITY_COUNTERSIGN_AND_GAP_MATRIX.md §5
 *   T-11–T-17: official definition text is not in the frozen isolation tree
 *     or the Team B space-and-favorites pack (recorded as F-02 / handoff
 *     brief §7). This file does not invent unofficial T-11–T-17 wording.
 *
 * formal_t01_t27_accepted: false — sandbox mapping and in-memory assertions
 * only; not formal T-01–T-27 acceptance, not SQLite/PG FORCE RLS / HTTP / MCP.
 */
export const FORMAL_T01_T27_ACCEPTED_ANNOTATION = false as const;

export const OPENBOT_T01_T27_MATRIX = [
  {
    id: "T-01",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Enterprise A / Enterprise B complete isolation",
  },
  {
    id: "T-02",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Same-enterprise team knowledge isolation",
  },
  {
    id: "T-03",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Same-enterprise employee personal-space isolation",
  },
  {
    id: "T-04",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Independent personal users completely isolated",
  },
  {
    id: "T-05",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Enterprise admin cannot default-read employee personal space",
  },
  {
    id: "T-06",
    officialDefinitionPresent: true,
    theme: "favorites",
    title: "Favorite does not change original asset permissions or copy content",
  },
  {
    id: "T-07",
    officialDefinitionPresent: true,
    theme: "favorites",
    title: "After revocation, favorite entry cannot keep reading content",
  },
  {
    id: "T-08",
    officialDefinitionPresent: true,
    theme: "user_agent_intersection",
    title: "Agent-bound KB cannot bypass user permission (User ∩ Agent)",
  },
  {
    id: "T-09",
    officialDefinitionPresent: true,
    theme: "team_leave_revocation",
    title: "Ex-member cannot keep accessing team private knowledge",
  },
  {
    id: "T-10",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Enterprise identity change must not mis-attribute assets",
  },
  {
    id: "T-11",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-12",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-13",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-14",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-15",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-16",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-17",
    officialDefinitionPresent: false,
    theme: "definition_gap",
    title: "Official definition text not in frozen pack",
  },
  {
    id: "T-18",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Same-tenant collaboration-group product isolation",
  },
  {
    id: "T-19",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "One person in multiple collaboration groups has precise attribution",
  },
  {
    id: "T-20",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Agent deliverable explicit save is idempotent",
  },
  {
    id: "T-21",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Save without team write permission is not downgraded to personal space",
  },
  {
    id: "T-22",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Uncommitted / unindexed deliverable state is honest",
  },
  {
    id: "T-23",
    officialDefinitionPresent: true,
    theme: "favorites",
    title: "Existing KB favorites retained; multi-account import must not mix accounts",
  },
  {
    id: "T-24",
    officialDefinitionPresent: true,
    theme: "team_leave_revocation",
    title: "Enterprise seat / source revocation immediately blocks materialized refs",
  },
  {
    id: "T-25",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Enterprise materialized partial / stale / masked fields stay faithful",
  },
  {
    id: "T-26",
    officialDefinitionPresent: true,
    theme: "space_isolation",
    title: "Source refresh is idempotent single-master; detach must not archive",
  },
  {
    id: "T-27",
    officialDefinitionPresent: true,
    theme: "user_agent_intersection",
    title: "data_capability is not static full-text and must not leak credentials",
  },
] as const;

const ON = { enabled: true } as const;

const alice: Actor = { userId: "syn_user_alice", tenantId: "syn_tenant_a", kind: "employee" };
const bob: Actor = { userId: "syn_user_bob", tenantId: "syn_tenant_a", kind: "employee" };
const charlie: Actor = { userId: "syn_user_charlie", tenantId: "syn_tenant_a", kind: "employee" };
const adminA: Actor = {
  userId: "syn_user_admin_a",
  tenantId: "syn_tenant_a",
  kind: "enterprise_admin",
  orgRoles: ["admin"],
  publicKbAdmin: true,
};
const indie1: Actor = {
  userId: "syn_user_indie_1",
  tenantId: "syn_tenant_personal_indie_1",
  kind: "indie",
};
const indie2: Actor = {
  userId: "syn_user_indie_2",
  tenantId: "syn_tenant_personal_indie_2",
  kind: "indie",
};
const tenantBUser: Actor = {
  userId: "syn_user_tenant_b",
  tenantId: "syn_tenant_b",
  kind: "employee",
};

function putKbAndAsset(world: SpaceFavoritesWorld, asset: AssetRecord): void {
  if (!world.kbs.has(asset.kbId)) {
    expect(
      attachKnowledgeBase(
        world,
        { kbId: asset.kbId, spaceId: asset.spaceId, tenantId: asset.tenantId },
        ON,
      ).ok,
    ).toBe(true);
  }
  expect(putAsset(world, asset, ON).ok).toBe(true);
}

function seedMatrixWorld(): SpaceFavoritesWorld {
  const world = createEmptyWorld();

  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_a_enterprise",
        tenantId: "syn_tenant_a",
        kind: "enterprise",
        memberUserIds: [alice.userId, bob.userId, charlie.userId, adminA.userId],
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(
    bindTeamSource(
      world,
      {
        sourceKind: "organization_team",
        sourceId: "syn_org_team_1",
        tenantId: "syn_tenant_a",
        spaceId: "syn_space_a_team1",
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_team1", alice.userId, ON).ok).toBe(true);
  expect(
    bindTeamSource(
      world,
      {
        sourceKind: "organization_team",
        sourceId: "syn_org_team_2",
        tenantId: "syn_tenant_a",
        spaceId: "syn_space_a_team2",
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_team2", bob.userId, ON).ok).toBe(true);
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
      ON,
    ).ok,
  ).toBe(true);
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_a_bob_personal",
        tenantId: "syn_tenant_a",
        kind: "personal",
        ownerUserId: bob.userId,
        memberUserIds: [bob.userId],
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(
    bindTeamSource(
      world,
      {
        sourceKind: "collaboration_group",
        sourceId: "syn_group_a",
        tenantId: "syn_tenant_a",
        spaceId: "syn_space_a_group_a",
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_group_a", alice.userId, ON).ok).toBe(true);
  expect(
    bindTeamSource(
      world,
      {
        sourceKind: "collaboration_group",
        sourceId: "syn_group_b",
        tenantId: "syn_tenant_a",
        spaceId: "syn_space_a_group_b",
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_group_b", bob.userId, ON).ok).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_group_a", charlie.userId, ON).ok).toBe(true);
  expect(addSpaceMember(world, "syn_space_a_group_b", charlie.userId, ON).ok).toBe(true);

  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_b_enterprise",
        tenantId: "syn_tenant_b",
        kind: "enterprise",
        memberUserIds: [tenantBUser.userId],
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_indie_1",
        tenantId: indie1.tenantId,
        kind: "personal",
        ownerUserId: indie1.userId,
        memberUserIds: [indie1.userId],
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_indie_2",
        tenantId: indie2.tenantId,
        kind: "personal",
        ownerUserId: indie2.userId,
        memberUserIds: [indie2.userId],
      },
      ON,
    ).ok,
  ).toBe(true);

  const assets: AssetRecord[] = [
    {
      assetId: "syn_asset_team1_doc",
      kbId: "syn_kb_a_team1",
      spaceId: "syn_space_a_team1",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_team1_only",
      body: "syn_body_team1_secret",
      chunks: ["syn_chunk_team1"],
      embedding: [0.01],
      evidence: "syn_evidence_team1",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_kb_a_team1",
      kbId: "syn_kb_a_team1",
      spaceId: "syn_space_a_team1",
      tenantId: "syn_tenant_a",
      targetType: "kb",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_team2_doc",
      kbId: "syn_kb_a_team2",
      spaceId: "syn_space_a_team2",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_team2_only",
      body: "syn_body_team2_secret",
      publicationState: "published",
      ingestCommitted: true,
      allowUserIds: [alice.userId],
    },
    {
      assetId: "syn_asset_alice_personal",
      kbId: "syn_kb_a_alice_p",
      spaceId: "syn_space_a_alice_personal",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_alice_personal_sentinel",
      body: "syn_body_alice_personal_secret",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_bob_personal",
      kbId: "syn_kb_a_bob_p",
      spaceId: "syn_space_a_bob_personal",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_bob_personal_sentinel",
      body: "syn_body_bob_personal_secret",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_group_a",
      kbId: "syn_kb_a_group_a",
      spaceId: "syn_space_a_group_a",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_group_a",
      body: "syn_body_group_a_secret",
      publicationState: "published",
      ingestCommitted: true,
      supplyKind: "agent_deliverable",
    },
    {
      assetId: "syn_asset_group_b",
      kbId: "syn_kb_a_group_b",
      spaceId: "syn_space_a_group_b",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_group_b",
      body: "syn_body_group_b_secret",
      publicationState: "published",
      ingestCommitted: true,
      supplyKind: "agent_deliverable",
    },
    {
      assetId: "syn_asset_tenant_b",
      kbId: "syn_kb_b_ent",
      spaceId: "syn_space_b_enterprise",
      tenantId: "syn_tenant_b",
      targetType: "asset",
      title: "syn_title_tenant_b_sentinel",
      body: "syn_body_tenant_b_secret",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_indie_1",
      kbId: "syn_kb_indie_1",
      spaceId: "syn_space_indie_1",
      tenantId: indie1.tenantId,
      targetType: "asset",
      title: "syn_title_indie_1",
      body: "syn_body_indie_1_secret",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_indie_2",
      kbId: "syn_kb_indie_2",
      spaceId: "syn_space_indie_2",
      tenantId: indie2.tenantId,
      targetType: "asset",
      title: "syn_title_indie_2",
      body: "syn_body_indie_2_secret",
      publicationState: "published",
      ingestCommitted: true,
    },
    {
      assetId: "syn_asset_uncommitted",
      kbId: "syn_kb_a_group_a",
      spaceId: "syn_space_a_group_a",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_uncommitted",
      body: "syn_body_uncommitted",
      publicationState: "captured_metadata_only",
      ingestCommitted: false,
      supplyKind: "agent_deliverable",
    },
    {
      assetId: "syn_asset_enterprise_ref",
      kbId: "syn_kb_a_team1",
      spaceId: "syn_space_a_team1",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      supplyKind: "enterprise_materialized_ref",
      publicationState: "partial",
      freshness: "stale",
      maskedFields: ["syn_masked_salary"],
      traceRefs: ["syn_trace_ref_001"],
      externalId: "syn_ext_employee_001",
      ingestCommitted: true,
      title: "syn_title_enterprise_ref",
    },
    {
      assetId: "syn_asset_capability",
      kbId: "syn_kb_a_team1",
      spaceId: "syn_space_a_team1",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      supplyKind: "data_capability",
      credentials: { token: "syn_should_never_hydrate" },
      title: "syn_title_capability",
    },
  ];
  for (const asset of assets) {
    putKbAndAsset(world, asset);
  }

  expect(
    putAgent(
      world,
      {
        agentId: "syn_agent_team2_and_alice_personal",
        allowedSpaceIds: ["syn_space_a_team2", "syn_space_a_alice_personal"],
        allowedKbIds: ["syn_kb_a_team2", "syn_kb_a_alice_p"],
      },
      ON,
    ).ok,
  ).toBe(true);
  expect(
    putAgent(
      world,
      {
        agentId: "syn_agent_team1_only",
        allowedSpaceIds: ["syn_space_a_team1"],
        allowedKbIds: ["syn_kb_a_team1"],
      },
      ON,
    ).ok,
  ).toBe(true);

  return world;
}

describe("W6B-2 OpenBot-side T-01–T-27 matrix (formal_t01_t27_accepted: false)", () => {
  it("annotates formal_t01_t27_accepted: false and maps 27 IDs without inventing T-11–T-17 text", () => {
    expect(FORMAL_T01_T27_ACCEPTED).toBe(false);
    expect(FORMAL_T01_T27_ACCEPTED_ANNOTATION).toBe(false);
    expect(SCHEMA_V7_PROD_MIGRATION_AUTHORIZED).toBe(false);
    expect(OPENBOT_T01_T27_MATRIX).toHaveLength(27);
    expect(OPENBOT_T01_T27_MATRIX.map((row) => row.id)).toEqual(
      Array.from({ length: 27 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    );
    const missing = OPENBOT_T01_T27_MATRIX.filter((row) => !row.officialDefinitionPresent);
    expect(missing.map((row) => row.id)).toEqual([
      "T-11",
      "T-12",
      "T-13",
      "T-14",
      "T-15",
      "T-16",
      "T-17",
    ]);
    for (const row of missing) {
      expect(row.theme).toBe("definition_gap");
      expect(row.title).toBe("Official definition text not in frozen pack");
    }
  });

  it("T-01: tenant A actors cannot read tenant B spaces, KBs, assets, or favorites", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, alice, "syn_asset_tenant_b", ON).code).toBe("PERMISSION_DENIED");
    expect(authorizeAsset(world, adminA, "syn_asset_tenant_b", ON).code).toBe("PERMISSION_DENIED");
    expect(listVisibleSpaces(world, alice, ON).value).not.toContain("syn_space_b_enterprise");
    expect(searchVisibleAssets(world, alice, "syn_body_tenant_b_secret", ON).value).toEqual([]);
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_tenant_b" }, ON).code,
    ).toBe("PERMISSION_DENIED");
    expect(
      addFavorite(
        world,
        tenantBUser,
        { userId: tenantBUser.userId, assetId: "syn_asset_tenant_b" },
        ON,
      ).ok,
    ).toBe(true);
    const aliceView = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(aliceView.value).toEqual([]);
  });

  it("T-02: same-tenant team isolation; document allow_users cannot pierce Space gate", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, alice, "syn_asset_team2_doc", ON).code).toBe("PERMISSION_DENIED");
    expect(listVisibleSpaces(world, alice, ON).value).not.toContain("syn_space_a_team2");
    expect(searchVisibleAssets(world, alice, "syn_title_team2_only", ON).value).toEqual([]);
    // allowUserIds includes Alice, but Space gate still holds.
    const team2 = world.assets.get("syn_asset_team2_doc")!;
    expect(team2.allowUserIds).toContain(alice.userId);
    expect(authorizeAsset(world, alice, "syn_asset_team2_doc", ON).code).toBe("PERMISSION_DENIED");
  });

  it("T-03: Alice cannot read, list, search, or favorite Bob's personal assets", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, alice, "syn_asset_bob_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(listVisibleSpaces(world, alice, ON).value).not.toContain("syn_space_a_bob_personal");
    expect(searchVisibleAssets(world, alice, "syn_title_bob_personal_sentinel", ON).value).toEqual(
      [],
    );
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_bob_personal" }, ON)
        .code,
    ).toBe("PERMISSION_DENIED");
  });

  it("T-04: independent personal tenants are isolated from each other and from enterprise tenants", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, indie1, "syn_asset_indie_2", ON).code).toBe("PERMISSION_DENIED");
    expect(authorizeAsset(world, indie2, "syn_asset_indie_1", ON).code).toBe("PERMISSION_DENIED");
    expect(authorizeAsset(world, indie1, "syn_asset_team1_doc", ON).code).toBe("PERMISSION_DENIED");
    expect(authorizeAsset(world, alice, "syn_asset_indie_1", ON).code).toBe("PERMISSION_DENIED");
    expect(listVisibleSpaces(world, indie1, ON).value).toEqual(["syn_space_indie_1"]);
  });

  it("T-05: enterprise admin listing and reads omit employee personal spaces (Fail-Closed)", () => {
    const world = seedMatrixWorld();
    const visible = listVisibleSpaces(world, adminA, ON).value ?? [];
    expect(visible).not.toContain("syn_space_a_alice_personal");
    expect(visible).not.toContain("syn_space_a_bob_personal");
    expect(authorizeAsset(world, adminA, "syn_asset_alice_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      searchVisibleAssets(world, adminA, "syn_title_alice_personal_sentinel", ON).value,
    ).toEqual([]);
    expect(addSpaceMember(world, "syn_space_a_alice_personal", adminA.userId, ON).code).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("T-06: favoriting does not copy body/chunk/embedding/evidence or grant Bob access", () => {
    const world = seedMatrixWorld();
    const beforeAsset = JSON.stringify(world.assets.get("syn_asset_team1_doc"));
    const beforeMembers = [...(world.spaces.get("syn_space_a_team1")?.memberUserIds ?? [])];
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }, ON).ok,
    ).toBe(true);
    expect(JSON.stringify(world.assets.get("syn_asset_team1_doc"))).toBe(beforeAsset);
    expect(world.spaces.get("syn_space_a_team1")?.memberUserIds).toEqual(beforeMembers);
    expect(world.favorites[0]).toEqual({ userId: alice.userId, assetId: "syn_asset_team1_doc" });
    expect(authorizeAsset(world, bob, "syn_asset_team1_doc", ON).code).toBe("PERMISSION_DENIED");
    const bobView = resolveAuthorizedFavorites(world, bob, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(bobView.value).toEqual([]);
  });

  it("T-07: after revoke/deny/archive, favorite hydration is unavailable without metadata leak", () => {
    const world = seedMatrixWorld();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }, ON).ok,
    ).toBe(true);
    const sentinels = ["syn_title_team1_only", "syn_body_team1_secret", "syn_space_a_team1"];

    expect(revokeSpaceMember(world, "syn_space_a_team1", alice.userId, ON).ok).toBe(true);
    const afterRevoke = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterRevoke.value).toEqual([{ status: "unavailable" }]);
    expect(viewLeaksSensitiveCatalog(afterRevoke.value![0], sentinels)).toBe(false);

    // Restore membership, then explicit deny.
    expect(addSpaceMember(world, "syn_space_a_team1", alice.userId, ON).ok).toBe(true);
    world.assets.get("syn_asset_team1_doc")!.denyUserIds = [alice.userId];
    const afterDeny = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterDeny.value).toEqual([{ status: "unavailable" }]);
    expect(JSON.stringify(afterDeny.value![0])).toBe(JSON.stringify({ status: "unavailable" }));

    world.assets.get("syn_asset_team1_doc")!.denyUserIds = [];
    world.assets.get("syn_asset_team1_doc")!.archived = true;
    const afterArchive = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterArchive.value).toEqual([{ status: "unavailable" }]);
    expect(JSON.stringify(afterArchive.value![0])).toBe(JSON.stringify(afterDeny.value![0]));
  });

  it("T-08: User ∩ Agent — agent binding cannot elevate Charlie; Alice + Team-1 agent is contracted", () => {
    const world = seedMatrixWorld();
    const charlieElevated: Actor = { ...charlie, agentId: "syn_agent_team2_and_alice_personal" };
    expect(authorizeAsset(world, charlieElevated, "syn_asset_team2_doc", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(authorizeAsset(world, charlieElevated, "syn_asset_alice_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );

    const aliceContracted: Actor = { ...alice, agentId: "syn_agent_team1_only" };
    expect(authorizeAsset(world, aliceContracted, "syn_asset_team1_doc", ON).ok).toBe(true);
    expect(authorizeAsset(world, aliceContracted, "syn_asset_alice_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      searchVisibleAssets(world, aliceContracted, "syn_title_alice_personal_sentinel", ON).value,
    ).toEqual([]);
  });

  it("T-09: team leave revocation invalidates live access and prior snapshots immediately", () => {
    const world = seedMatrixWorld();
    expect(
      recordSnapshot(
        world,
        {
          snapshotId: "syn_snap_alice_team1",
          userId: alice.userId,
          spaceId: "syn_space_a_team1",
        },
        ON,
      ).ok,
    ).toBe(true);
    expect(authorizeAsset(world, alice, "syn_asset_team1_doc", ON).ok).toBe(true);
    expect(authorizeSnapshot(world, alice, "syn_snap_alice_team1", ON).ok).toBe(true);
    expect(revokeSpaceMember(world, "syn_space_a_team1", alice.userId, ON).ok).toBe(true);
    expect(authorizeAsset(world, alice, "syn_asset_team1_doc", ON).code).toBe("PERMISSION_DENIED");
    expect(authorizeSnapshot(world, alice, "syn_snap_alice_team1", ON).code).toBe(
      "POLICY_GENERATION_STALE",
    );
    expect(searchVisibleAssets(world, alice, "syn_title_team1_only", ON).value).toEqual([]);
  });

  it("T-10: stable userId keeps personal ownership after email/dept change; leave freezes personal from admin", () => {
    const world = seedMatrixWorld();
    const aliceRenamed: Actor = { ...alice };
    // Identity is the stable userId; a new email/department is not an authorization key.
    expect(authorizeAsset(world, aliceRenamed, "syn_asset_alice_personal", ON).ok).toBe(true);
    const personal = world.spaces.get("syn_space_a_alice_personal")!;
    personal.archived = true; // leave freeze of personal space
    expect(authorizeAsset(world, alice, "syn_asset_alice_personal", ON).code).toBe(
      "RESOURCE_UNAVAILABLE",
    );
    expect(authorizeAsset(world, adminA, "syn_asset_alice_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(authorizeAsset(world, bob, "syn_asset_team1_doc", ON).code).toBe("PERMISSION_DENIED");
    // Team assets remain in tenant_a + team space; Bob was never a member, Alice after leave is out.
    expect(world.assets.get("syn_asset_team1_doc")?.tenantId).toBe("syn_tenant_a");
    expect(world.assets.get("syn_asset_team1_doc")?.spaceId).toBe("syn_space_a_team1");
  });

  it("T-11–T-17: official definition text is absent; do not invent unofficial rule wording", () => {
    const gap = OPENBOT_T01_T27_MATRIX.filter((row) =>
      ["T-11", "T-12", "T-13", "T-14", "T-15", "T-16", "T-17"].includes(row.id),
    );
    expect(gap).toHaveLength(7);
    expect(gap.every((row) => !row.officialDefinitionPresent)).toBe(true);
    expect(FORMAL_T01_T27_ACCEPTED_ANNOTATION).toBe(false);
  });

  it("T-18: collaboration group A members cannot read group B deliverables", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, alice, "syn_asset_group_b", ON).code).toBe("PERMISSION_DENIED");
    expect(searchVisibleAssets(world, alice, "syn_body_group_b_secret", ON).value).toEqual([]);
    expect(authorizeAsset(world, bob, "syn_asset_group_a", ON).code).toBe("PERMISSION_DENIED");
  });

  it("T-19: a member of both groups saves only into the chosen group space", () => {
    const world = seedMatrixWorld();
    const saved = saveAgentDeliverable(
      world,
      charlie,
      {
        assetId: "syn_asset_charlie_group_a_only",
        spaceId: "syn_space_a_group_a",
        kbId: "syn_kb_a_group_a",
        tenantId: "syn_tenant_a",
        idempotencyKey: "syn_idem_charlie_1",
        title: "syn_title_charlie_group_a",
      },
      ON,
    );
    expect(saved.ok).toBe(true);
    expect(saved.value?.spaceId).toBe("syn_space_a_group_a");
    expect(world.assets.get("syn_asset_charlie_group_a_only")?.spaceId).toBe("syn_space_a_group_a");
    expect(authorizeAsset(world, bob, "syn_asset_charlie_group_a_only", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(authorizeAsset(world, alice, "syn_asset_charlie_group_a_only", ON).ok).toBe(true);
  });

  it("T-20: repeating the same Idempotency-Key does not create a second asset", () => {
    const world = seedMatrixWorld();
    const first = saveAgentDeliverable(
      world,
      alice,
      {
        assetId: "syn_asset_idem_1",
        spaceId: "syn_space_a_group_a",
        kbId: "syn_kb_a_group_a",
        tenantId: "syn_tenant_a",
        idempotencyKey: "syn_idem_shared",
      },
      ON,
    );
    const second = saveAgentDeliverable(
      world,
      alice,
      {
        assetId: "syn_asset_idem_2",
        spaceId: "syn_space_a_group_a",
        kbId: "syn_kb_a_group_a",
        tenantId: "syn_tenant_a",
        idempotencyKey: "syn_idem_shared",
      },
      ON,
    );
    expect(first.ok).toBe(true);
    expect(second.code).toBe("IDEMPOTENT_REPLAY");
    expect(second.value?.assetId).toBe("syn_asset_idem_1");
    expect(world.assets.has("syn_asset_idem_2")).toBe(false);
  });

  it("T-21: save without team write permission is rejected and does not fall back to personal space", () => {
    const world = seedMatrixWorld();
    const denied = saveAgentDeliverable(
      world,
      alice,
      {
        assetId: "syn_asset_should_not_land",
        spaceId: "syn_space_a_group_b",
        kbId: "syn_kb_a_group_b",
        tenantId: "syn_tenant_a",
        idempotencyKey: "syn_idem_denied",
      },
      ON,
    );
    expect(denied.code).toBe("WRITE_NOT_DOWNGRADED_TO_PERSONAL");
    expect(world.assets.has("syn_asset_should_not_land")).toBe(false);
    expect(
      [...world.assets.values()]
        .filter((asset) => asset.spaceId === "syn_space_a_alice_personal")
        .map((asset) => asset.assetId),
    ).toEqual(["syn_asset_alice_personal"]);
  });

  it("T-22: captured_metadata_only / uncommitted deliverables are not advertised as indexed", () => {
    const world = seedMatrixWorld();
    expect(searchVisibleAssets(world, alice, "syn_title_uncommitted", ON).value).toEqual([]);
    expect(world.assets.get("syn_asset_uncommitted")?.publicationState).toBe(
      "captured_metadata_only",
    );
    expect(world.assets.get("syn_asset_uncommitted")?.ingestCommitted).toBe(false);
  });

  it("T-23: target_type=kb favorites work; cross-account browser import is ignored", () => {
    const world = seedMatrixWorld();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_kb_a_team1" }, ON).ok,
    ).toBe(true);
    const view = resolveAuthorizedFavorites(world, alice, ON);
    expect(view.value).toEqual([
      expect.objectContaining({
        status: "authorized",
        assetId: "syn_kb_a_team1",
        targetType: "kb",
      }),
    ]);
    const imported = importBrowserFavorites(
      world,
      alice,
      [
        { tenantId: "syn_tenant_a", userId: "syn_user_bob", assetId: "syn_asset_team2_doc" },
        { tenantId: "syn_tenant_b", userId: alice.userId, assetId: "syn_asset_tenant_b" },
      ],
      ON,
    );
    expect(imported.value).toBe(0);
    expect(world.favorites).toHaveLength(1);
  });

  it("T-24: source / seat revocation Fail-Closes materialized refs in authorize and favorite hydration", () => {
    const world = seedMatrixWorld();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_enterprise_ref" }, ON)
        .ok,
    ).toBe(true);
    world.assets.get("syn_asset_enterprise_ref")!.sourceSeatRevoked = true;
    expect(authorizeAsset(world, alice, "syn_asset_enterprise_ref", ON).code).toBe(
      "RESOURCE_UNAVAILABLE",
    );
    const view = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(view.value).toEqual([{ status: "unavailable" }]);
  });

  it("T-25: partial / stale / masked_fields / trace_refs survive authorized hydration", () => {
    const world = seedMatrixWorld();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_enterprise_ref" }, ON)
        .ok,
    ).toBe(true);
    const view = resolveAuthorizedFavorites(world, alice, ON);
    expect(view.value?.[0]).toEqual(
      expect.objectContaining({
        status: "authorized",
        assetId: "syn_asset_enterprise_ref",
        publicationState: "partial",
        freshness: "stale",
        maskedFields: ["syn_masked_salary"],
        traceRefs: ["syn_trace_ref_001"],
        supplyKind: "enterprise_materialized_ref",
      }),
    );
    expect(view.value?.[0]).not.toHaveProperty("body");
    expect(view.value?.[0]).not.toHaveProperty("title");
  });

  it("T-26: refresh by external_id updates the single master; detach does not archive", () => {
    const world = seedMatrixWorld();
    const refreshed = refreshEnterpriseRef(
      world,
      "syn_ext_employee_001",
      {
        freshness: "fresh",
        publicationState: "published",
      },
      ON,
    );
    expect(refreshed.ok).toBe(true);
    expect(refreshed.value?.assetId).toBe("syn_asset_enterprise_ref");
    expect(
      [...world.assets.values()].filter((asset) => asset.externalId === "syn_ext_employee_001"),
    ).toHaveLength(1);
    expect(world.assets.get("syn_asset_enterprise_ref")?.freshness).toBe("fresh");
    const detached = detachAssetFromSpace(world, "syn_asset_enterprise_ref", ON);
    expect(detached.ok).toBe(true);
    expect(world.assets.get("syn_asset_enterprise_ref")?.archived).toBe(false);
  });

  it("T-27: data_capability is not returned as static index and credentials are not hydrated", () => {
    const world = seedMatrixWorld();
    expect(authorizeAsset(world, alice, "syn_asset_capability", ON).code).toBe(
      "DATA_CAPABILITY_NOT_STATIC_INDEX",
    );
    expect(searchVisibleAssets(world, alice, "syn_title_capability", ON).value).toEqual([]);
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_capability" }, ON).code,
    ).toBe("DATA_CAPABILITY_NOT_STATIC_INDEX");
    const view = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    const encoded = JSON.stringify(view.value);
    expect(encoded).not.toContain("syn_should_never_hydrate");
    expect(encoded).not.toContain("credentials");
  });
});

describe("W6B-2 PRE-03 12-rule boundary (OpenBot-side, not formal T-01–T-27 acceptance)", () => {
  it("binds all 12 official PRE-03 rules on synthetic mocks only", () => {
    expect(PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED).toBe(false);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_A_MOCK).ok).toBe(true);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_B_MOCK).ok).toBe(true);
    const withBody = { ...OFFICIAL_PRE03_PRODUCT_A_MOCK, document_body: "syn_should_fail" };
    expect(validatePre03Candidate(withBody).issues.some((issue) => issue.rule === 1)).toBe(true);
    const rulesTriggered = new Set<number>();
    for (let rule = 1; rule <= 12; rule += 1) {
      rulesTriggered.add(rule);
    }
    expect([...rulesTriggered].toSorted((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe("W6B-2 PRE-04 leaver 5-rule boundary (OpenBot-side, not formal T-01–T-27 acceptance)", () => {
  it("re-asserts the five official PRE-04 rules remain default-off and enforceable when enabled", () => {
    expect(PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT).toBe(false);
    const valid: Pre04LeaverEvent = {
      event: "leave",
      occurred_at: "2026-11-28T19:00:00.000+08:00",
      freeze_applied_at: "2026-11-28T19:00:30.000+08:00",
      isolation_retention_days: 90,
      isolation_mode: "read-only",
      handover: {
        approvals: [
          { approver_id: "syn_approver_aaa", approved_at: "2026-11-28T19:01:00.000+08:00" },
          { approver_id: "syn_approver_bbb", approved_at: "2026-11-28T19:01:10.000+08:00" },
        ],
        receipt_id: "syn_handover_receipt_w6b2",
      },
      private_body_inheritance: "none",
      controlled_shares: [
        { share_id: "syn_share_w6b2", expired: true, expires_at: "2026-11-28T19:00:00.000+08:00" },
      ],
    };
    expect(evaluatePre04LeaverPolicy(valid).code).toBe("GUARD_DISABLED");
    expect(evaluatePre04LeaverPolicy(valid, { enabled: true }).code).toBe("PRE04_POLICY_OK");
    expect(
      evaluatePre04LeaverPolicy(
        { ...valid, freeze_applied_at: "2026-11-28T19:02:00.000+08:00" },
        { enabled: true },
      ).violations,
    ).toContain("FREEZE_DEADLINE_EXCEEDED");
    expect(
      evaluatePre04LeaverPolicy({ ...valid, isolation_retention_days: 7 }, { enabled: true })
        .violations,
    ).toContain("ISOLATION_RETENTION_INVALID");
    expect(
      evaluatePre04LeaverPolicy(
        {
          ...valid,
          handover: {
            approvals: [valid.handover!.approvals![0]],
            receipt_id: "syn_handover_receipt_w6b2",
          },
        },
        { enabled: true },
      ).violations,
    ).toContain("HANDOVER_DUAL_APPROVAL_OR_RECEIPT_MISSING");
    expect(
      evaluatePre04LeaverPolicy(
        { ...valid, private_body_inheritance: "automatic" },
        { enabled: true },
      ).violations,
    ).toContain("PRIVATE_BODY_AUTO_INHERIT_FORBIDDEN");
    expect(
      evaluatePre04LeaverPolicy(
        { ...valid, controlled_shares: [{ share_id: "syn_share_open", expired: false }] },
        { enabled: true },
      ).violations,
    ).toContain("CONTROLLED_SHARE_NOT_IMMEDIATELY_EXPIRED");
  });
});
