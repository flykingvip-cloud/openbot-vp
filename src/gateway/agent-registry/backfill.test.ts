// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { applyAgentRegistryBackfill, selectBackfillCandidates } from "./backfill.js";
import { listOpenQuarantineEntries } from "./legacy-resolver.js";
import { findPrimaryOwnerBinding, listOwnerBindingHistory } from "./ownership.js";
import { createAgentAsset, listAgentAssets } from "./registry.js";
import { createEmptyAgentRegistryStore } from "./types.js";

const NOW = "2026-07-31T00:00:00.000Z";
const LATER = "2026-07-31T01:00:00.000Z";

function agents() {
  return [
    { tenantId: "ent-a", legacyAgentId: "sales-bot", seatId: "seat-1", displayName: "Sales Bot" },
  ];
}

describe("agent registry backfill", () => {
  it("creates a canonical asset and binds the owning seat", () => {
    const store = createEmptyAgentRegistryStore();
    const report = applyAgentRegistryBackfill({ store, agents: agents(), nowIso: NOW });

    expect(report.counts.created).toBe(1);
    const [asset] = listAgentAssets(store, "ent-a");
    expect(asset).toMatchObject({
      agentSlug: "sales-bot",
      displayName: "Sales Bot",
      legacyAgentId: "sales-bot",
    });
    expect(
      findPrimaryOwnerBinding(store, { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId }),
    ).toMatchObject({ ownerType: "seat", ownerId: "seat-1" });
  });

  it("is idempotent across re-runs", () => {
    const store = createEmptyAgentRegistryStore();
    applyAgentRegistryBackfill({ store, agents: agents(), nowIso: NOW });
    const second = applyAgentRegistryBackfill({ store, agents: agents(), nowIso: LATER });

    expect(second.counts).toMatchObject({ created: 0, "already-present": 1 });
    expect(listAgentAssets(store, "ent-a")).toHaveLength(1);
    const [asset] = listAgentAssets(store, "ent-a");
    // Re-running must not churn ownership history.
    expect(
      listOwnerBindingHistory(store, { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId }),
    ).toHaveLength(1);
  });

  it("binds a missing owner without recreating an existing asset", () => {
    const store = createEmptyAgentRegistryStore();
    const asset = createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot",
      displayName: "Sales Bot",
      nowIso: NOW,
      legacyAgentId: "sales-bot",
    });
    const report = applyAgentRegistryBackfill({ store, agents: agents(), nowIso: LATER });

    expect(report.counts).toMatchObject({ created: 0, "owner-bound": 1 });
    expect(
      findPrimaryOwnerBinding(store, { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId }),
    ).toMatchObject({ ownerId: "seat-1" });
  });

  it("quarantines a duplicated legacy id instead of picking one", () => {
    const store = createEmptyAgentRegistryStore();
    for (const slug of ["sales-bot", "sales-bot-2"]) {
      createAgentAsset({
        store,
        enterpriseId: "ent-a",
        agentSlug: slug,
        displayName: slug,
        nowIso: NOW,
        legacyAgentId: "sales-bot",
      });
    }
    const report = applyAgentRegistryBackfill({ store, agents: agents(), nowIso: LATER });

    expect(report.counts.quarantined).toBe(1);
    expect(listOpenQuarantineEntries(store, "ent-a")).toHaveLength(1);
    expect(listAgentAssets(store, "ent-a")).toHaveLength(2);
  });

  it("reports a taken slug instead of renaming or re-pointing", () => {
    const store = createEmptyAgentRegistryStore();
    const other = createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot",
      displayName: "Unrelated",
      nowIso: NOW,
    });
    const report = applyAgentRegistryBackfill({ store, agents: agents(), nowIso: LATER });

    expect(report.actions).toEqual([
      {
        action: "slug-conflict",
        legacyAgentId: "sales-bot",
        tenantId: "ent-a",
        agentAssetId: other.agentAssetId,
      },
    ]);
    expect(other.legacyAgentId).toBeUndefined();
  });

  it("keeps enterprises separate when the same agent id exists in both", () => {
    const store = createEmptyAgentRegistryStore();
    const report = applyAgentRegistryBackfill({
      store,
      agents: [
        { tenantId: "ent-a", legacyAgentId: "sales-bot", seatId: "seat-1" },
        { tenantId: "ent-b", legacyAgentId: "sales-bot", seatId: "seat-9" },
      ],
      nowIso: NOW,
    });
    expect(report.counts.created).toBe(2);
    expect(listAgentAssets(store, "ent-a")).toHaveLength(1);
    expect(listAgentAssets(store, "ent-b")).toHaveLength(1);
    expect(listAgentAssets(store, "ent-a")[0].agentAssetId).not.toBe(
      listAgentAssets(store, "ent-b")[0].agentAssetId,
    );
  });

  it("never gives a universal builtin a canonical identity or an owner", () => {
    // ADR amendment 2: every employee gets a private instance, so it is not an enterprise
    // asset. Backfilling it once made the CEO's seat the owner of everyone's assistant.
    const store = createEmptyAgentRegistryStore();
    const report = applyAgentRegistryBackfill({
      store,
      agents: [{ tenantId: "ent-a", legacyAgentId: "main", seatId: "seat-1" }],
      nowIso: NOW,
    });
    expect(report.counts).toMatchObject({ created: 0, "skipped-builtin": 1 });
    expect(listAgentAssets(store, "ent-a")).toHaveLength(0);
    expect(listOpenQuarantineEntries(store, "ent-a")).toHaveLength(0);
  });

  it("skips unusable input rather than inventing a tenant or seat", () => {
    const store = createEmptyAgentRegistryStore();
    const report = applyAgentRegistryBackfill({
      store,
      agents: [
        { tenantId: "", legacyAgentId: "a", seatId: "seat-1" },
        { tenantId: "ent-a", legacyAgentId: "  ", seatId: "seat-1" },
        { tenantId: "ent-a", legacyAgentId: "b", seatId: "" },
      ],
      nowIso: NOW,
    });
    expect(report.counts["skipped-invalid"]).toBe(3);
    expect(listAgentAssets(store, "ent-a")).toHaveLength(0);
    expect(report.actions.map((entry) => "reason" in entry && entry.reason)).toEqual([
      "missing tenantId",
      "missing agentId",
      "missing seatId",
    ]);
  });
});

describe("backfill candidate selection", () => {
  it("takes only active agent ownership records", () => {
    expect(
      selectBackfillCandidates([
        {
          tenantId: "ent-a",
          subjectKind: "agent",
          subjectId: "sales-bot",
          positionId: "seat-1",
          bindingStatus: "active",
        },
        {
          tenantId: "ent-a",
          subjectKind: "agent",
          subjectId: "old-bot",
          positionId: "seat-2",
          bindingStatus: "revoked",
        },
        {
          tenantId: "ent-a",
          subjectKind: "group",
          subjectId: "group-1",
          positionId: "seat-3",
          bindingStatus: "active",
        },
      ]),
    ).toEqual([{ tenantId: "ent-a", legacyAgentId: "sales-bot", seatId: "seat-1" }]);
  });

  it("attaches a display name when one is known", () => {
    expect(
      selectBackfillCandidates(
        [
          {
            tenantId: "ent-a",
            subjectKind: "agent",
            subjectId: "sales-bot",
            positionId: "seat-1",
            bindingStatus: "active",
          },
        ],
        (agentId) => (agentId === "sales-bot" ? "Sales Bot" : undefined),
      ),
    ).toEqual([
      { tenantId: "ent-a", legacyAgentId: "sales-bot", seatId: "seat-1", displayName: "Sales Bot" },
    ]);
  });
});
