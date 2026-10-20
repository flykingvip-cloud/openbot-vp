import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildAuthorityResourceId,
  extractAuthorityCandidate,
} from "./memory-workspace-phase1b-authority-extract.mjs";
import { measureStageA } from "./memory-workspace-phase1b-item2-stage-a.mjs";

const DIR = path.dirname(import.meta.filename);

void test("authority extract: no dump yields an empty candidate and does not read inventory", () => {
  const extracted = extractAuthorityCandidate(null);
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json"),
      "utf8",
    ),
  );
  assert.equal(extracted.source, "none");
  assert.equal(extracted.live, false);
  assert.equal(extracted.catalogWrite, false);
  assert.equal(extracted.candidateCount, 0);
  assert.equal(extracted.candidates.length, 0);
  assert.notEqual(extracted.candidateCount, inventory.candidateCount);
});

void test("authority extract: Phase 0 inventory is refused as an authority source", () => {
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json"),
      "utf8",
    ),
  );
  const extracted = extractAuthorityCandidate(inventory);
  assert.equal(extracted.source, "rejected-inventory");
  assert.equal(extracted.candidateCount, 0);
  assert.ok(extracted.rejected.some((row) => row.reason === "phase0_inventory_is_not_authority"));
});

void test("authority extract: exact AgentAsset, group, and steward resourceId; agentId stays rejected", () => {
  const extracted = extractAuthorityCandidate({
    memberships: [
      { userId: "user-1", enterpriseId: "tenant-1" },
      { userId: "user-2", enterpriseId: "tenant-1" },
    ],
    agentAssets: [
      {
        agentAssetId: "asset-1",
        enterpriseId: "tenant-1",
        ownerType: "membership",
        ownerId: "user-1",
        status: "active",
        agentSlug: "panda",
      },
      {
        agentAssetId: "asset-seat",
        enterpriseId: "tenant-1",
        ownerType: "seat",
        ownerId: "seat-1",
        status: "active",
      },
      {
        agentId: "bot-2",
        enterpriseId: "tenant-1",
        ownerType: "membership",
        ownerId: "user-1",
      },
      {
        agentAssetId: "asset-orphan",
        enterpriseId: "tenant-1",
        ownerType: "membership",
        ownerId: "user-missing",
        status: "active",
      },
    ],
    groups: [{ groupId: "group-1", enterpriseId: "tenant-1" }],
  });

  assert.equal(extracted.live, false);
  assert.equal(extracted.catalogWrite, false);
  assert.equal(extracted.candidateCount, 5);
  assert.deepEqual(
    extracted.candidates
      .map((row) => row.resourceId)
      .toSorted((left, right) => left.localeCompare(right)),
    [
      "ws:tenant-1:group:group-1",
      "ws:tenant-1:seat:seat-1:asset:asset-seat",
      "ws:tenant-1:user:user-1:asset:asset-1",
      "ws:tenant-1:user:user-1:steward",
      "ws:tenant-1:user:user-2:steward",
    ],
  );
  assert.ok(!extracted.candidates.some((row) => row.resourceId.includes("panda")));
  assert.ok(!extracted.candidates.some((row) => row.resourceId.includes("bot-2")));
  assert.ok(extracted.rejected.some((row) => row.reason === "agentId_is_not_agentAssetId"));
  assert.ok(extracted.rejected.some((row) => row.reason === "membership_missing"));
  assert.equal(
    extracted.candidates.filter((row) => row.workspaceKind === "employee_private").length,
    2,
  );
  assert.equal(
    extracted.rejected.filter(
      (row) => row.reason === "employee_private_membership_proven_resource_id_unspecified",
    ).length,
    0,
  );
  assert.equal(
    buildAuthorityResourceId({
      workspaceKind: "employee_private",
      tenantId: "tenant-1",
      userId: "user-1",
    }),
    "ws:tenant-1:user:user-1:steward",
  );
  assert.equal(
    buildAuthorityResourceId({
      workspaceKind: "agent_primary",
      tenantId: "tenant-1",
      userId: "user-1",
      agentAssetId: "asset-1",
    }),
    "ws:tenant-1:user:user-1:asset:asset-1",
  );
});

void test("authority extract mints user-owned rows from unique registry-bound occupancy", () => {
  const extracted = extractAuthorityCandidate({
    memberships: [{ userId: "user-1", enterpriseId: "tenant-1" }],
    agentAssets: [
      {
        agentAssetId: "asset-a",
        enterpriseId: "tenant-1",
        ownerType: "seat",
        ownerId: "seat-1",
        status: "active",
      },
      {
        agentAssetId: "asset-b",
        enterpriseId: "tenant-1",
        ownerType: "seat",
        ownerId: "seat-1",
        status: "active",
      },
    ],
    groups: [],
    seatOccupancies: [
      {
        userId: "user-1",
        seatId: "seat-1",
        enterpriseId: "tenant-1",
        registrySeatBound: true,
      },
    ],
  });
  assert.deepEqual(
    extracted.candidates
      .filter((row) => row.ownerType === "occupancy")
      .map((row) => row.resourceId)
      .toSorted((left, right) => String(left).localeCompare(String(right))),
    ["ws:tenant-1:user:user-1:asset:asset-a", "ws:tenant-1:user:user-1:asset:asset-b"],
  );
  assert.ok(
    extracted.candidates.some((row) => row.resourceId === "ws:tenant-1:seat:seat-1:asset:asset-a"),
  );
});

void test("authority extract does not mint unbound occupancy or multi-user seats", () => {
  const extracted = extractAuthorityCandidate({
    memberships: [
      { userId: "user-1", enterpriseId: "tenant-1" },
      { userId: "user-2", enterpriseId: "tenant-1" },
    ],
    agentAssets: [
      {
        agentAssetId: "asset-a",
        enterpriseId: "tenant-1",
        ownerType: "seat",
        ownerId: "seat-shared",
        status: "active",
      },
    ],
    groups: [],
    seatOccupancies: [
      {
        userId: "user-1",
        seatId: "oseat-1",
        enterpriseId: "tenant-1",
        registrySeatBound: false,
      },
      {
        userId: "user-1",
        seatId: "seat-shared",
        enterpriseId: "tenant-1",
        registrySeatBound: true,
      },
      {
        userId: "user-2",
        seatId: "seat-shared",
        enterpriseId: "tenant-1",
        registrySeatBound: true,
      },
    ],
  });
  assert.equal(extracted.candidates.filter((row) => row.ownerType === "occupancy").length, 0);
});

void test("authority extract does not make item 2 met", () => {
  const measured = measureStageA();
  assert.equal(measured.authorityExtract.status, "present");
  assert.equal(measured.authorityExtract.candidateCount, 5);
  assert.equal(measured.shadowCompare.matched, 0);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.unlock, "not-issued");
});
