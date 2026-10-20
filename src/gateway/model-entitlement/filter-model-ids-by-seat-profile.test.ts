// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertOverAllocationState } from "../billing/over-allocation-store.js";
import { upsertSeatEntitlementAssignment } from "../billing/seat-entitlement-assignments-store.js";
import { assignSeat, __resetSeatsForTest } from "../billing/seats-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { filterModelIdsBySeatEntitlementProfile } from "./filter-model-ids-by-seat-profile.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-seat-filter-"));
}

describe("filterModelIdsBySeatEntitlementProfile", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("intersects tenant tiers with seat profile allowedTiers", async () => {
    dir = await tempDir();
    const catalogPath = path.join(dir, "catalog.json");
    const seatsPath = path.join(dir, "seats.json");
    const assignmentsPath = path.join(dir, "assignments.json");

    await __resetSeatsForTest(seatsPath);
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a" },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-openai/gpt-4o", tier: "tier_b" },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-anthropic/claude-opus", tier: "tier_c" },
      catalogPath,
    );

    const seat = await assignSeat(
      { enterpriseId: "ent-1", userId: "u1", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    await upsertSeatEntitlementAssignment(
      { enterpriseId: "ent-1", seatId: seat.id, profileId: "pro_ai" },
      assignmentsPath,
    );

    const filtered = await filterModelIdsBySeatEntitlementProfile({
      tenantId: "ent-1",
      seatId: seat.id,
      modelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "api-proxy-openai/gpt-4o",
        "api-proxy-anthropic/claude-opus",
      ],
      tenantAllowedTiers: ["tier_a", "tier_b"],
      seatEntitlementAssignmentsPath: assignmentsPath,
      seatsStorePath: seatsPath,
      modelCatalogPath: catalogPath,
    });

    expect(filtered).toEqual(["api-proxy-deepseek/deepseek-chat", "api-proxy-openai/gpt-4o"]);
  });

  it("downgrades to lowest profile tier when run_high_tier is blocked", async () => {
    dir = await tempDir();
    const catalogPath = path.join(dir, "catalog.json");
    const seatsPath = path.join(dir, "seats.json");
    const assignmentsPath = path.join(dir, "assignments.json");
    const oaPath = path.join(dir, "oa.json");

    await __resetSeatsForTest(seatsPath);
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a" },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-openai/gpt-4o", tier: "tier_b" },
      catalogPath,
    );

    const seat = await assignSeat(
      { enterpriseId: "ent-2", userId: "u2", role: "creator", botQuota: 0 },
      seatsPath,
    );
    await upsertSeatEntitlementAssignment(
      { enterpriseId: "ent-2", seatId: seat.id, profileId: "pro_ai" },
      assignmentsPath,
    );
    await upsertOverAllocationState(
      {
        enterpriseId: "ent-2",
        subscriptionSnapshotId: "snap-test",
        status: "over_allocated",
        seatsOver: 0,
        botsOver: 0,
        seatProfilesOver: 1,
        privateModelsOver: 0,
        workflowsOver: 0,
        blockedActions: ["run_high_tier", "upgrade_seat_profile"],
        detectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      oaPath,
    );

    const filtered = await filterModelIdsBySeatEntitlementProfile({
      tenantId: "ent-2",
      seatId: seat.id,
      modelIds: ["api-proxy-deepseek/deepseek-chat", "api-proxy-openai/gpt-4o"],
      tenantAllowedTiers: ["tier_a", "tier_b"],
      seatEntitlementAssignmentsPath: assignmentsPath,
      seatsStorePath: seatsPath,
      modelCatalogPath: catalogPath,
      overAllocationPath: oaPath,
    });

    expect(filtered).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("keeps enterprise BYOK ent/* models that have no platform catalog tier", async () => {
    dir = await tempDir();
    const catalogPath = path.join(dir, "catalog.json");
    const seatsPath = path.join(dir, "seats.json");
    const assignmentsPath = path.join(dir, "assignments.json");

    await __resetSeatsForTest(seatsPath);
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a" },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-openai/gpt-4o", tier: "tier_b" },
      catalogPath,
    );

    const seat = await assignSeat(
      { enterpriseId: "ent-3", userId: "u3", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    await upsertSeatEntitlementAssignment(
      { enterpriseId: "ent-3", seatId: seat.id, profileId: "pro_ai" },
      assignmentsPath,
    );

    const filtered = await filterModelIdsBySeatEntitlementProfile({
      tenantId: "ent-3",
      seatId: seat.id,
      modelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "ent/cea43bf898/deepseek-v4-flash",
        "api-proxy-openai/gpt-4o",
        "ent/cea43bf898/qwen3.6-35b-a3b",
      ],
      tenantAllowedTiers: ["tier_a", "tier_b"],
      seatEntitlementAssignmentsPath: assignmentsPath,
      seatsStorePath: seatsPath,
      modelCatalogPath: catalogPath,
    });

    expect(filtered).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ent/cea43bf898/deepseek-v4-flash",
      "api-proxy-openai/gpt-4o",
      "ent/cea43bf898/qwen3.6-35b-a3b",
    ]);
  });
});
