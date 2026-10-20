import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import {
  assertDumpHasNoSecrets,
  buildProductionAuthorityDump,
  collectLocalAuthorityStores,
} from "./memory-workspace-phase1b-production-authority-dump.mjs";

const DIR = path.dirname(import.meta.filename);

void test("collector redacts local stores and refuses live / secrets", () => {
  const dump = buildProductionAuthorityDump({
    memberships: {
      m1: { userId: "11111111-1111-1111-1111-111111111111", enterpriseId: "acme-corp" },
      m2: { userId: "22222222-2222-2222-2222-222222222222", enterpriseId: "acme-corp" },
      m1dup: { userId: "11111111-1111-1111-1111-111111111111", enterpriseId: "acme-corp" },
    },
    assets: {
      a1: {
        agentAssetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        enterpriseId: "acme-corp",
        status: "active",
        displayName: "secret-bot",
      },
      a2: {
        agentAssetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        enterpriseId: "acme-corp",
        status: "archived",
      },
    },
    ownerBindings: {
      b1: {
        agentAssetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        enterpriseId: "acme-corp",
        ownerType: "seat",
        ownerId: "seat-primary",
        isPrimary: true,
      },
      b2: {
        agentAssetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        enterpriseId: "acme-corp",
        ownerType: "membership",
        ownerId: "11111111-1111-1111-1111-111111111111",
        isPrimary: true,
        endedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    groups: [{ groupId: "standup-team", scope: "user" }],
    seatOccupancies: [
      {
        userId: "11111111-1111-1111-1111-111111111111",
        seatId: "seat-primary",
        enterpriseId: "acme-corp",
      },
      {
        userId: "22222222-2222-2222-2222-222222222222",
        seatId: "seat-unbound",
        enterpriseId: "acme-corp",
      },
    ],
  });

  assert.equal(dump.live, false);
  assert.equal(dump.writable, false);
  assert.equal(dump.source, "local-platform-auth-and-agent-registry");
  assert.notEqual(dump.source, "local-non-live-fixture");
  assert.equal(dump.identifierPolicy, "opaque-redacted");
  assert.equal(dump.memberships.length, 2);
  assert.ok(dump.memberships.every((row) => row.userId.startsWith("user-")));
  assert.ok(dump.memberships.every((row) => row.enterpriseId.startsWith("ent-")));
  assert.equal(
    dump.memberships.some((row) => row.enterpriseId === "acme-corp"),
    false,
  );
  assert.equal(dump.agentAssets.length, 2);
  const active = dump.agentAssets.find((row) => row.status === "active");
  assert.equal(active.ownerType, "seat");
  assert.ok(active.ownerId.startsWith("seat-"));
  const archived = dump.agentAssets.find((row) => row.status === "archived");
  assert.equal(archived.ownerId, undefined);
  assert.equal(dump.counts.userScopedGroupsWithoutTenant, 1);
  assert.equal(dump.counts.seatOccupancies, 2);
  assert.equal(dump.seatOccupancies.length, 2);
  assert.ok(dump.seatOccupancies.every((row) => row.userId.startsWith("user-")));
  const bound = dump.seatOccupancies.find((row) => row.registrySeatBound);
  const unbound = dump.seatOccupancies.find((row) => !row.registrySeatBound);
  assert.ok(bound.seatId.startsWith("seat-"));
  assert.ok(unbound.seatId.startsWith("oseat-"));
  assert.equal(dump.groups.length, 1);
  assert.equal(dump.groups[0].enterpriseId, undefined);
  assertDumpHasNoSecrets(dump);
  assert.throws(() => buildProductionAuthorityDump({ live: true, memberships: [] }), {
    message: "production_authority_dump_must_not_be_live",
  });
});

void test("redacted dump is accepted by Stage A extract without becoming Catalog SoT", () => {
  const dump = buildProductionAuthorityDump({
    memberships: [{ userId: "u-1", enterpriseId: "t-1" }],
    assets: [{ agentAssetId: "a-1", enterpriseId: "t-1", status: "active" }],
    ownerBindings: [
      {
        agentAssetId: "a-1",
        enterpriseId: "t-1",
        ownerType: "seat",
        ownerId: "s-1",
        isPrimary: true,
      },
    ],
    groups: [{ groupId: "g-1", enterpriseId: "t-1" }],
  });
  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
  assert.equal(extracted.live, false);
  assert.equal(extracted.catalogWrite, false);
  assert.ok(extracted.candidates.some((row) => row.workspaceKind === "agent_primary"));
  assert.ok(extracted.candidates.some((row) => row.workspaceKind === "employee_private"));
  assert.ok(extracted.candidates.some((row) => row.workspaceKind === "group_shared"));
  assert.equal(
    extracted.candidates.some(
      (row) => row.resourceId?.includes(":user:") && row.resourceId?.includes(":asset:"),
    ),
    false,
  );
});

void test("collector reads profile tenantId and managed tenants/<tid> groups; conflict stays unbound", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-item2-groups-"));
  const userRoot = path.join(root, "user-groups");
  const tenantsRoot = path.join(root, "tenants");
  const userGroup = path.join(userRoot, "standup");
  const managedGroup = path.join(tenantsRoot, "acme-1", "collaboration", "groups", "ops");
  const conflictGroup = path.join(tenantsRoot, "acme-1", "collaboration", "groups", "other");
  fs.mkdirSync(userGroup, { recursive: true });
  fs.mkdirSync(managedGroup, { recursive: true });
  fs.mkdirSync(conflictGroup, { recursive: true });
  fs.writeFileSync(
    path.join(userGroup, "profile.json"),
    `${JSON.stringify({ groupId: "standup-team", tenantId: "acme-1", scope: "user" })}\n`,
  );
  fs.writeFileSync(
    path.join(managedGroup, "profile.json"),
    `${JSON.stringify({ groupId: "ops-room" })}\n`,
  );
  fs.writeFileSync(
    path.join(conflictGroup, "profile.json"),
    `${JSON.stringify({ groupId: "other-room", tenantId: "other-ent" })}\n`,
  );

  const stores = collectLocalAuthorityStores({
    authPath: path.join(root, "missing-auth.json"),
    registryPath: path.join(root, "missing-registry.json"),
    groupsRoot: userRoot,
    tenantsRoot,
  });
  const dump = buildProductionAuthorityDump(stores);
  assert.equal(dump.counts.groups, 3);
  assert.equal(dump.counts.userScopedGroupsWithoutTenant, 1);
  assert.equal(dump.groups.filter((row) => row.enterpriseId).length, 2);
  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
  assert.equal(
    extracted.candidates.filter((row) => row.workspaceKind === "group_shared").length,
    2,
  );
  assert.ok(extracted.rejected.some((row) => row.reason === "incomplete_group"));
  fs.rmSync(root, { recursive: true, force: true });
});

void test("collector reads occupancy and extract mints unique registry-bound seats", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-item2-seats-"));
  const seatAssetsPath = path.join(root, "openbot-enterprise-seat-assets.json");
  fs.writeFileSync(
    seatAssetsPath,
    `${JSON.stringify({
      seats: {
        s1: {
          seatId: "seat-primary",
          tenantId: "acme-1",
          status: "occupied",
          currentEmployeeId: "11111111-1111-1111-1111-111111111111",
        },
        s2: {
          seatId: "seat-extra",
          tenantId: "acme-1",
          status: "occupied",
          currentEmployeeId: "22222222-2222-2222-2222-222222222222",
        },
        vacant: {
          seatId: "seat-vacant",
          tenantId: "acme-1",
          status: "vacant",
          currentEmployeeId: "33333333-3333-3333-3333-333333333333",
        },
      },
      bindings: {
        b1: {
          seatId: "seat-primary",
          tenantId: "acme-1",
          employeeId: "11111111-1111-1111-1111-111111111111",
          bindingStatus: "active",
        },
      },
    })}\n`,
  );
  const stores = collectLocalAuthorityStores({
    authPath: path.join(root, "missing-auth.json"),
    registryPath: path.join(root, "missing-registry.json"),
    groupsRoot: path.join(root, "missing-groups"),
    tenantsRoot: path.join(root, "missing-tenants"),
    seatAssetsPath,
  });
  const dump = buildProductionAuthorityDump({
    ...stores,
    memberships: [{ userId: "11111111-1111-1111-1111-111111111111", enterpriseId: "acme-1" }],
    assets: [{ agentAssetId: "a-1", enterpriseId: "acme-1", status: "active" }],
    ownerBindings: [
      {
        agentAssetId: "a-1",
        enterpriseId: "acme-1",
        ownerType: "seat",
        ownerId: "seat-primary",
        isPrimary: true,
      },
    ],
  });
  assert.equal(dump.counts.seatOccupancies, 2);
  assert.equal(dump.seatOccupancies.filter((row) => row.registrySeatBound).length, 1);
  assert.equal(dump.seatOccupancies.filter((row) => !row.registrySeatBound).length, 1);
  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
  assert.equal(
    extracted.candidates.filter((row) => /:user:[^:]+:asset:/.test(row.resourceId ?? "")).length,
    1,
  );
  assert.equal(extracted.candidates.filter((row) => row.ownerType === "occupancy").length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

void test("unredacted dump stays in-memory and is never the git snapshot", () => {
  const dump = buildProductionAuthorityDump(
    {
      memberships: [{ userId: "11111111-1111-1111-1111-111111111111", enterpriseId: "acme-corp" }],
      assets: [
        {
          agentAssetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          enterpriseId: "acme-corp",
          status: "active",
        },
      ],
      ownerBindings: [
        {
          agentAssetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          enterpriseId: "acme-corp",
          ownerType: "seat",
          ownerId: "seat-primary",
          isPrimary: true,
        },
      ],
      groups: [],
      seatOccupancies: [
        {
          userId: "11111111-1111-1111-1111-111111111111",
          seatId: "seat-primary",
          enterpriseId: "acme-corp",
        },
      ],
    },
    { opaque: false },
  );
  assert.equal(dump.identifierPolicy, "in-memory-unredacted");
  assert.equal(dump.memberships[0].enterpriseId, "acme-corp");
  assert.equal(dump.memberships[0].userId, "11111111-1111-1111-1111-111111111111");
  assertDumpHasNoSecrets(dump);
  const committed = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json"),
      "utf8",
    ),
  );
  assert.equal(committed.identifierPolicy, "opaque-redacted");
  assert.notEqual(committed.memberships[0]?.enterpriseId, "acme-corp");
});

void test("committed production dump is not the Stage A fixture and still not covering Catalog", () => {
  const dump = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json"),
      "utf8",
    ),
  );
  const fixture = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase1b-authority-dump.json"), "utf8"),
  );
  assert.equal(dump.live, false);
  assert.equal(dump.source, "local-platform-auth-and-agent-registry");
  assert.equal(fixture.source, "local-non-live-fixture");
  assert.notDeepEqual(dump.memberships, fixture.memberships);
  assertDumpHasNoSecrets(dump);
  assert.ok(!JSON.stringify(dump).includes(os.homedir()));
  assert.equal(dump.counts.userScopedGroupsWithoutTenant, 0);
  assert.ok(dump.groups.every((row) => row.enterpriseId));
  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
  assert.equal(extracted.live, false);
  assert.equal(extracted.catalogWrite, false);
  assert.equal(
    extracted.candidates.filter((row) => row.workspaceKind === "group_shared").length,
    dump.groups.length,
  );
  assert.ok(!extracted.rejected.some((row) => row.reason === "incomplete_group"));
  assert.ok(extracted.candidates.some((row) => row.workspaceKind === "agent_primary"));
  assert.ok(extracted.candidates.some((row) => row.workspaceKind === "employee_private"));
  assert.ok(extracted.rejected.some((row) => row.reason === "incomplete_agent_asset"));
  assert.ok(Array.isArray(dump.seatOccupancies));
  const occupancyMinted = extracted.candidates.filter((row) => row.ownerType === "occupancy");
  assert.equal(occupancyMinted.length, 6);
  assert.ok(occupancyMinted.every((row) => /:user:[^:]+:asset:/.test(row.resourceId ?? "")));
  assert.equal(extracted.candidateCount, 22);
});
