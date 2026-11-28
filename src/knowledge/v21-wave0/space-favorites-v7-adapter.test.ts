import { describe, expect, it } from "vitest";
import {
  FORMAL_T01_T27_ACCEPTED,
  FORBIDDEN_FAVORITE_POINTER_KEYS,
  SCHEMA_V7_PROD_MIGRATION_AUTHORIZED,
  SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE,
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT,
  SPACE_FAVORITES_V7_ADAPTER_IO,
  addFavorite,
  addSpaceMember,
  assertFavoritePointerShape,
  attachKnowledgeBase,
  authorizeAsset,
  bindTeamSource,
  createEmptyWorld,
  deleteFavorite,
  listVisibleSpaces,
  pointerHasForbiddenFields,
  putAsset,
  putSpace,
  resolveAuthorizedFavorites,
  revokeSpaceMember,
  viewLeaksSensitiveCatalog,
  type Actor,
  type AssetRecord,
  type FavoritePointer,
  type SpaceFavoritesWorld,
} from "./space-favorites-v7-adapter.js";

const ON = { enabled: true } as const;

const alice: Actor = {
  userId: "syn_user_alice",
  tenantId: "syn_tenant_a",
  kind: "employee",
};
const bob: Actor = {
  userId: "syn_user_bob",
  tenantId: "syn_tenant_a",
  kind: "employee",
};
const adminA: Actor = {
  userId: "syn_user_admin_a",
  tenantId: "syn_tenant_a",
  kind: "enterprise_admin",
  orgRoles: ["admin"],
  publicKbAdmin: true,
};
const eveB: Actor = {
  userId: "syn_user_eve",
  tenantId: "syn_tenant_b",
  kind: "enterprise_admin",
  orgRoles: ["admin"],
  publicKbAdmin: true,
};

function seedTwoTenants(): SpaceFavoritesWorld {
  const world = createEmptyWorld();
  expect(
    putSpace(
      world,
      {
        spaceId: "syn_space_a_enterprise",
        tenantId: "syn_tenant_a",
        kind: "enterprise",
        memberUserIds: [alice.userId, bob.userId, adminA.userId],
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
        spaceId: "syn_space_b_enterprise",
        tenantId: "syn_tenant_b",
        kind: "enterprise",
        memberUserIds: [eveB.userId],
      },
      ON,
    ).ok,
  ).toBe(true);

  const kbs = [
    { kbId: "syn_kb_a_team1_alpha", spaceId: "syn_space_a_team1", tenantId: "syn_tenant_a" },
    { kbId: "syn_kb_a_team1_beta", spaceId: "syn_space_a_team1", tenantId: "syn_tenant_a" },
    { kbId: "syn_kb_a_team2", spaceId: "syn_space_a_team2", tenantId: "syn_tenant_a" },
    { kbId: "syn_kb_a_alice_p1", spaceId: "syn_space_a_alice_personal", tenantId: "syn_tenant_a" },
    { kbId: "syn_kb_b_ent", spaceId: "syn_space_b_enterprise", tenantId: "syn_tenant_b" },
  ];
  for (const kb of kbs) {
    expect(attachKnowledgeBase(world, kb, ON).ok).toBe(true);
  }

  const assets: AssetRecord[] = [
    {
      assetId: "syn_asset_team1_doc",
      kbId: "syn_kb_a_team1_alpha",
      spaceId: "syn_space_a_team1",
      tenantId: "syn_tenant_a",
      targetType: "asset",
      title: "syn_title_team1_only",
      body: "syn_body_team1_secret",
      chunks: ["syn_chunk_team1"],
      embedding: [0.1],
      evidence: { quote: "syn_evidence_team1" },
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
    },
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
  ];
  for (const asset of assets) {
    expect(putAsset(world, asset, ON).ok).toBe(true);
  }
  return world;
}

describe("Space / Favorites v7 adapter (W6B-1, default-off)", () => {
  it("stays default-off, performs no I/O, and does not authorize prod migration or formal T-01–T-27", () => {
    expect(SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT).toBe(false);
    expect(SPACE_FAVORITES_V7_ADAPTER_IO).toEqual({
      database: false,
      network: false,
      diskWrites: false,
    });
    expect(FORMAL_T01_T27_ACCEPTED).toBe(false);
    expect(SCHEMA_V7_PROD_MIGRATION_AUTHORIZED).toBe(false);
    expect(SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE).toBe(1);
    const world = createEmptyWorld();
    expect(
      bindTeamSource(world, {
        sourceKind: "organization_team",
        sourceId: "syn_org_team_1",
        tenantId: "syn_tenant_a",
        spaceId: "syn_space_a_team1",
      }).code,
    ).toBe("ADAPTER_DISABLED");
    expect(world.spaces.size).toBe(0);
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }).code,
    ).toBe("ADAPTER_DISABLED");
    expect(resolveAuthorizedFavorites(world, alice).code).toBe("ADAPTER_DISABLED");
  });

  it("enforces Tenant->Space->KB with 1 Space : N KB and matching org ids", () => {
    const world = seedTwoTenants();
    const team1Kbs = [...world.kbs.values()].filter((kb) => kb.spaceId === "syn_space_a_team1");
    expect(team1Kbs.map((kb) => kb.kbId).toSorted()).toEqual([
      "syn_kb_a_team1_alpha",
      "syn_kb_a_team1_beta",
    ]);
    expect(
      attachKnowledgeBase(
        world,
        { kbId: "syn_kb_cross", spaceId: "syn_space_a_team1", tenantId: "syn_tenant_b" },
        ON,
      ).code,
    ).toBe("SPACE_ORG_KB_ORG_MISMATCH");
  });

  it("SPACE-C03 phase one: 1 organization_team = 1 Team Space; rejects a second bind", () => {
    const world = seedTwoTenants();
    expect(world.orgTeamBindings.get("syn_org_team_1")).toBe("syn_space_a_team1");
    expect(
      bindTeamSource(
        world,
        {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_1",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_a_team1_duplicate",
        },
        ON,
      ).code,
    ).toBe("ORG_TEAM_SPACE_ALREADY_BOUND");
    expect(world.spaces.has("syn_space_a_team1_duplicate")).toBe(false);
  });

  it("rejects department auto-mapping and phase-one parent_space_id nesting", () => {
    const world = createEmptyWorld();
    expect(
      bindTeamSource(
        world,
        {
          sourceKind: "department",
          sourceId: "syn_dept_sales",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_dept",
        },
        ON,
      ).code,
    ).toBe("DEPARTMENT_AUTO_MAPPING_REJECTED");
    expect(world.spaces.size).toBe(0);
    expect(
      bindTeamSource(
        world,
        {
          sourceKind: "organization_team",
          sourceId: "syn_org_team_nested",
          tenantId: "syn_tenant_a",
          spaceId: "syn_space_child",
          parentSpaceId: "syn_space_parent",
        },
        ON,
      ).code,
    ).toBe("PARENT_SPACE_FORBIDDEN_PHASE_ONE");
  });

  it("stores Favorites as zero-copy userId+assetId pointers and rejects body/chunk/embedding/evidence", () => {
    const world = seedTwoTenants();
    const added = addFavorite(
      world,
      alice,
      { userId: alice.userId, assetId: "syn_asset_team1_doc" },
      ON,
    );
    expect(added.ok).toBe(true);
    expect(added.value).toEqual({ userId: alice.userId, assetId: "syn_asset_team1_doc" });
    expect(Object.keys(added.value!)).toEqual(["userId", "assetId"]);
    expect(assertFavoritePointerShape(added.value!)).toBe(true);
    expect(world.favorites).toHaveLength(1);
    expect(JSON.stringify(world.favorites[0])).toBe(
      JSON.stringify({ userId: alice.userId, assetId: "syn_asset_team1_doc" }),
    );
    const dirty = {
      userId: alice.userId,
      assetId: "syn_asset_team1_doc",
      body: "syn_should_never_store",
    };
    expect(pointerHasForbiddenFields(dirty)).toBe(true);
    expect(addFavorite(world, alice, dirty as FavoritePointer, ON).code).toBe(
      "FORBIDDEN_POINTER_FIELD",
    );
    expect(world.favorites).toHaveLength(1);
    for (const key of FORBIDDEN_FAVORITE_POINTER_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(world.favorites[0], key)).toBe(false);
    }
  });

  it("addFavorite is idempotent and refuses to favorite an unauthorized asset", () => {
    const world = seedTwoTenants();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }, ON).code,
    ).toBe("OK");
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }, ON).code,
    ).toBe("IDEMPOTENT_REPLAY");
    expect(world.favorites).toHaveLength(1);
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team2_doc" }, ON).code,
    ).toBe("PERMISSION_DENIED");
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_tenant_b" }, ON).code,
    ).toBe("PERMISSION_DENIED");
    expect(world.favorites).toHaveLength(1);
  });

  it("resolveAuthorizedFavorites Fail-Closes on revoke, delete, cross-tenant, and admin reading personal space", () => {
    const world = seedTwoTenants();
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_team1_doc" }, ON).ok,
    ).toBe(true);
    expect(
      addFavorite(world, alice, { userId: alice.userId, assetId: "syn_asset_alice_personal" }, ON)
        .ok,
    ).toBe(true);

    const sentinels = [
      "syn_body_team1_secret",
      "syn_chunk_team1",
      "syn_evidence_team1",
      "syn_title_alice_personal_sentinel",
      "syn_body_alice_personal_secret",
      "syn_title_tenant_b_sentinel",
      "syn_body_tenant_b_secret",
    ];

    const happy = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(happy.ok).toBe(true);
    expect(
      happy.value?.map((view) => (view.status === "authorized" ? view.assetId : view.status)),
    ).toEqual(["syn_asset_team1_doc", "syn_asset_alice_personal"]);
    for (const view of happy.value ?? []) {
      if (view.status === "authorized") {
        expect(view).not.toHaveProperty("body");
        expect(view).not.toHaveProperty("chunks");
        expect(view).not.toHaveProperty("embedding");
        expect(view).not.toHaveProperty("evidence");
        expect(view).not.toHaveProperty("title");
      }
    }

    // Cross-tenant actor sees nothing; denial is indistinguishable from empty.
    const cross = resolveAuthorizedFavorites(world, eveB, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(cross.ok).toBe(true);
    expect(cross.value).toEqual([]);

    // Enterprise admin cannot read the employee's personal space (T-05).
    expect(authorizeAsset(world, adminA, "syn_asset_alice_personal", ON).code).toBe(
      "PERMISSION_DENIED",
    );
    expect(listVisibleSpaces(world, adminA, ON).value).not.toContain("syn_space_a_alice_personal");
    expect(listVisibleSpaces(world, adminA, ON).value).not.toContain("syn_space_b_enterprise");

    // Revoke Alice from Team 1: pointer remains, hydration Fail-Closes.
    expect(revokeSpaceMember(world, "syn_space_a_team1", alice.userId, ON).ok).toBe(true);
    const afterRevoke = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterRevoke.value).toHaveLength(2);
    expect(afterRevoke.value?.[0]).toEqual({ status: "unavailable" });
    expect(afterRevoke.value?.[1].status).toBe("authorized");
    expect(viewLeaksSensitiveCatalog(afterRevoke.value![0], sentinels)).toBe(false);
    expect(JSON.stringify(afterRevoke.value![0])).toBe(JSON.stringify({ status: "unavailable" }));

    // Delete the personal asset: uniform unavailable, no title leak.
    const personal = world.assets.get("syn_asset_alice_personal")!;
    personal.deleted = true;
    const afterDelete = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterDelete.value).toEqual([{ status: "unavailable" }, { status: "unavailable" }]);
    expect(JSON.stringify(afterDelete.value![0])).toBe(JSON.stringify(afterDelete.value![1]));
    expect(viewLeaksSensitiveCatalog(afterDelete.value![1], sentinels)).toBe(false);

    // Alice may still delete her own stale pointer.
    expect(deleteFavorite(world, alice, "syn_asset_team1_doc", ON).ok).toBe(true);
    const afterClean = resolveAuthorizedFavorites(world, alice, {
      enabled: true,
      includeUnavailable: true,
    });
    expect(afterClean.value).toEqual([{ status: "unavailable" }]);
  });
});
