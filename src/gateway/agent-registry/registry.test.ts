// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import {
  listOpenQuarantineEntries,
  resolveLegacyAgentId,
  resolveLegacyAgentIdWithQuarantine,
  resolveQuarantineEntry,
} from "./legacy-resolver.js";
import {
  assertAgentOwnershipInvariant,
  findPrimaryOwnerBinding,
  isPrimaryOwner,
  listOwnerBindingHistory,
  releasePrimaryOwner,
  setPrimaryOwner,
} from "./ownership.js";
import {
  assertNoCrossEnterpriseTransfer,
  copyAgentAssetToEnterprise,
  createAgentAsset,
  findAgentAsset,
  findAgentAssetBySlug,
  listAgentAssets,
} from "./registry.js";
import { agentRefEquals, createEmptyAgentRegistryStore, isAgentRef } from "./types.js";

const NOW = "2026-07-31T00:00:00.000Z";
const LATER = "2026-07-31T01:00:00.000Z";

function storeWithAsset(overrides?: { legacyAgentId?: string }) {
  const store = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    ...(overrides?.legacyAgentId ? { legacyAgentId: overrides.legacyAgentId } : {}),
  });
  return { store, asset, ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId } };
}

describe("agent asset registry", () => {
  it("generates an opaque server side id and keeps the slug as an alias", () => {
    const { asset } = storeWithAsset();
    expect(asset.agentAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(asset.agentSlug).toBe("sales-bot");
    expect(asset.status).toBe("active");
  });

  it("rejects a duplicate slug inside one enterprise, case-insensitively", () => {
    const { store } = storeWithAsset();
    expect(() =>
      createAgentAsset({
        store,
        enterpriseId: "ent-a",
        agentSlug: "Sales-Bot",
        displayName: "Copy",
        nowIso: NOW,
      }),
    ).toThrow(/already exists/);
  });

  it("allows the same slug in a different enterprise", () => {
    const { store } = storeWithAsset();
    const other = createAgentAsset({
      store,
      enterpriseId: "ent-b",
      agentSlug: "sales-bot",
      displayName: "Sales Bot",
      nowIso: NOW,
    });
    expect(other.enterpriseId).toBe("ent-b");
    expect(listAgentAssets(store, "ent-a")).toHaveLength(1);
    expect(listAgentAssets(store, "ent-b")).toHaveLength(1);
  });

  it("does not leak an asset to another enterprise that knows its id", () => {
    const { store, asset } = storeWithAsset();
    expect(
      findAgentAsset(store, { enterpriseId: "ent-b", agentAssetId: asset.agentAssetId }),
    ).toBeUndefined();
    expect(findAgentAssetBySlug(store, "ent-b", "sales-bot")).toBeUndefined();
  });

  it("treats a cross enterprise copy as a new asset with provenance", () => {
    const { store, ref } = storeWithAsset();
    const copy = copyAgentAssetToEnterprise({
      store,
      source: ref,
      targetEnterpriseId: "ent-b",
      agentSlug: "sales-bot",
      nowIso: LATER,
    });
    expect(copy.agentAssetId).not.toBe(ref.agentAssetId);
    expect(copy.copiedFrom).toEqual({
      enterpriseId: "ent-a",
      agentAssetId: ref.agentAssetId,
      copiedAt: LATER,
    });
  });

  it("refuses to transfer an asset across enterprises", () => {
    const { asset } = storeWithAsset();
    expect(() => assertNoCrossEnterpriseTransfer(asset, "ent-b")).toThrow(
      /cannot be transferred across enterprises/,
    );
  });

  it("guards half-built references", () => {
    expect(isAgentRef({ enterpriseId: "ent-a", agentAssetId: "asset-1" })).toBe(true);
    expect(isAgentRef({ enterpriseId: "ent-a" })).toBe(false);
    expect(isAgentRef({ enterpriseId: " ", agentAssetId: "asset-1" })).toBe(false);
    expect(
      agentRefEquals(
        { enterpriseId: "ent-a", agentAssetId: "asset-1" },
        { enterpriseId: "ent-b", agentAssetId: "asset-1" },
      ),
    ).toBe(false);
  });
});

describe("legacy agent resolution", () => {
  it("resolves an exact legacy id inside the enterprise", () => {
    const { store, asset } = storeWithAsset({ legacyAgentId: "legacy-1" });
    expect(
      resolveLegacyAgentId({ store, enterpriseId: "ent-a", legacyAgentId: "legacy-1" }),
    ).toEqual({
      kind: "resolved",
      ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId },
    });
  });

  it("never falls back to the slug when no legacy id matches", () => {
    const { store } = storeWithAsset();
    expect(
      resolveLegacyAgentId({ store, enterpriseId: "ent-a", legacyAgentId: "sales-bot" }),
    ).toEqual({ kind: "not-found" });
  });

  it("does not resolve a legacy id belonging to another enterprise", () => {
    const { store } = storeWithAsset({ legacyAgentId: "legacy-1" });
    expect(
      resolveLegacyAgentId({ store, enterpriseId: "ent-b", legacyAgentId: "legacy-1" }),
    ).toEqual({ kind: "not-found" });
  });

  it("reports a universal builtin as such, before consulting the store", () => {
    const store = createEmptyAgentRegistryStore();
    // Even with a stray asset claiming that legacy id, it must never resolve into the
    // ownership or policy model (ADR amendment 2).
    createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "steward",
      displayName: "Steward",
      nowIso: NOW,
      legacyAgentId: "main",
    });
    expect(resolveLegacyAgentId({ store, enterpriseId: "ent-a", legacyAgentId: "main" })).toEqual({
      kind: "builtin-universal",
    });
  });

  it("reports ambiguity instead of picking a candidate", () => {
    const { store } = storeWithAsset({ legacyAgentId: "legacy-1" });
    createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot-2",
      displayName: "Second",
      nowIso: LATER,
      legacyAgentId: "legacy-1",
    });
    const result = resolveLegacyAgentId({
      store,
      enterpriseId: "ent-a",
      legacyAgentId: "legacy-1",
    });
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidateAgentAssetIds).toHaveLength(2);
  });

  it("quarantines an ambiguous legacy id once and allows adjudication", () => {
    const { store } = storeWithAsset({ legacyAgentId: "legacy-1" });
    createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot-2",
      displayName: "Second",
      nowIso: LATER,
      legacyAgentId: "legacy-1",
    });
    const args = { store, enterpriseId: "ent-a", legacyAgentId: "legacy-1", nowIso: LATER };
    expect(resolveLegacyAgentIdWithQuarantine(args).kind).toBe("ambiguous");
    expect(resolveLegacyAgentIdWithQuarantine(args).kind).toBe("ambiguous");
    const open = listOpenQuarantineEntries(store, "ent-a");
    expect(open).toHaveLength(1);
    expect(open[0].reason).toBe("ambiguous-legacy-id");

    expect(
      resolveQuarantineEntry({ store, quarantineId: open[0].quarantineId, nowIso: LATER })
        ?.resolvedAt,
    ).toBe(LATER);
    expect(listOpenQuarantineEntries(store, "ent-a")).toHaveLength(0);
  });
});

describe("agent asset ownership", () => {
  it("keeps exactly one open primary binding and preserves history on transfer", () => {
    const { store, ref } = storeWithAsset();
    const first = setPrimaryOwner({
      store,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const second = setPrimaryOwner({
      store,
      ref,
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: LATER,
    });

    expect(second.bindingId).not.toBe(first.bindingId);
    expect(findPrimaryOwnerBinding(store, ref)?.ownerId).toBe("seat-1");
    const history = listOwnerBindingHistory(store, ref);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      ownerId: "membership-1",
      endedAt: LATER,
      endedReason: "transferred",
    });
  });

  it("is idempotent when the same owner is set again", () => {
    const { store, ref } = storeWithAsset();
    const first = setPrimaryOwner({
      store,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const again = setPrimaryOwner({
      store,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: LATER,
    });
    expect(again.bindingId).toBe(first.bindingId);
    expect(listOwnerBindingHistory(store, ref)).toHaveLength(1);
  });

  it("refuses ownership for an asset outside the enterprise", () => {
    const { store, ref } = storeWithAsset();
    expect(() =>
      setPrimaryOwner({
        store,
        ref: { enterpriseId: "ent-b", agentAssetId: ref.agentAssetId },
        ownerType: "membership",
        ownerId: "membership-1",
        nowIso: NOW,
      }),
    ).toThrow(/not found in this enterprise/);
  });

  it("retires the asset in the same step as releasing its owner", () => {
    // The previous expectation here was "released, still active, now unowned", which is a
    // state the ADR forbids. Release and retirement are one operation instead.
    const { store, asset, ref } = storeWithAsset();
    setPrimaryOwner({ store, ref, ownerType: "membership", ownerId: "membership-1", nowIso: NOW });
    releasePrimaryOwner({
      store,
      ref,
      nowIso: LATER,
      reason: "owner_removed",
      assetStatus: "suspended",
    });
    expect(findPrimaryOwnerBinding(store, ref)).toBeUndefined();
    expect(isPrimaryOwner({ store, ref, ownerType: "membership", ownerId: "membership-1" })).toBe(
      false,
    );
    expect(asset).toMatchObject({ status: "suspended", updatedAt: LATER });
    // The retired asset no longer trips the invariant.
    expect(() => assertAgentOwnershipInvariant(store)).not.toThrow();
  });

  it("refuses to release ownership for an asset outside the enterprise", () => {
    const { store, ref } = storeWithAsset();
    expect(() =>
      releasePrimaryOwner({
        store,
        ref: { enterpriseId: "ent-b", agentAssetId: ref.agentAssetId },
        nowIso: LATER,
        reason: "owner_removed",
        assetStatus: "archived",
      }),
    ).toThrow(/not found in this enterprise/);
  });

  it("fails closed when more than one binding is open", () => {
    const { store, ref } = storeWithAsset();
    setPrimaryOwner({ store, ref, ownerType: "membership", ownerId: "membership-1", nowIso: NOW });
    // Simulate a data defect: a second open binding must not resolve an owner.
    store.ownerBindings["defect"] = {
      bindingId: "defect",
      enterpriseId: ref.enterpriseId,
      agentAssetId: ref.agentAssetId,
      ownerType: "seat",
      ownerId: "seat-9",
      isPrimary: true,
      effectiveAt: LATER,
    };
    expect(findPrimaryOwnerBinding(store, ref)).toBeUndefined();
    expect(isPrimaryOwner({ store, ref, ownerType: "membership", ownerId: "membership-1" })).toBe(
      false,
    );
  });
});

describe("ownership invariant", () => {
  it("rejects an active asset with no owner", () => {
    const { store } = storeWithAsset();
    expect(() => assertAgentOwnershipInvariant(store)).toThrow(/has 0 open primary owner bindings/);
  });

  it("rejects an active asset with two open bindings", () => {
    const { store, ref } = storeWithAsset();
    setPrimaryOwner({ store, ref, ownerType: "membership", ownerId: "membership-1", nowIso: NOW });
    store.ownerBindings.defect = {
      bindingId: "defect",
      enterpriseId: ref.enterpriseId,
      agentAssetId: ref.agentAssetId,
      ownerType: "seat",
      ownerId: "seat-9",
      isPrimary: true,
      effectiveAt: LATER,
    };
    expect(() => assertAgentOwnershipInvariant(store)).toThrow(/has 2 open primary owner bindings/);
  });

  it("accepts create-then-bind as one transaction", () => {
    // Only the persisted state has to be consistent, so binding after creating is legal.
    const { store, ref } = storeWithAsset();
    setPrimaryOwner({ store, ref, ownerType: "seat", ownerId: "seat-1", nowIso: NOW });
    expect(() => assertAgentOwnershipInvariant(store)).not.toThrow();
  });

  it("ignores non-active assets and other enterprises' bindings", () => {
    const { store, ref } = storeWithAsset();
    store.assets[ref.agentAssetId].status = "archived";
    expect(() => assertAgentOwnershipInvariant(store)).not.toThrow();

    store.assets[ref.agentAssetId].status = "active";
    // A binding recorded under another enterprise must not satisfy this asset.
    store.ownerBindings.foreign = {
      bindingId: "foreign",
      enterpriseId: "ent-b",
      agentAssetId: ref.agentAssetId,
      ownerType: "seat",
      ownerId: "seat-1",
      isPrimary: true,
      effectiveAt: NOW,
    };
    expect(() => assertAgentOwnershipInvariant(store)).toThrow(/has 0 open primary owner bindings/);
  });
});
