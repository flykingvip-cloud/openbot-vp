import { describe, expect, it } from "vitest";
import {
  resolveOwnershipOnCreate,
  resolveOwnershipOnImport,
  transferOwnershipOnPositionChange,
} from "../ownership-service.ts";
import type { OwnedAsset } from "../ownership-service.ts";

describe("resolveOwnershipOnCreate", () => {
  it("returns ownership with non-empty positionId", () => {
    const result = resolveOwnershipOnCreate({
      operatorUserId: "user-1",
      operatorUserLabel: "Alice",
      operatorPositionId: "pos-eng-lead",
      operatorPositionLabel: "Engineering Lead",
    });

    expect(result.positionId).toBe("pos-eng-lead");
    expect(result.positionLabel).toBe("Engineering Lead");
    expect(result.createdByUserId).toBe("user-1");
    expect(result.createdByUserLabel).toBe("Alice");
    expect(result.currentManagerUserId).toBe("user-1");
    expect(result.currentManagerLabel).toBe("Alice");
    expect(result.createdAt).toBeTruthy();
  });

  it("throws when operatorPositionId is empty", () => {
    expect(() =>
      resolveOwnershipOnCreate({
        operatorUserId: "user-1",
        operatorUserLabel: "Alice",
        operatorPositionId: "",
        operatorPositionLabel: "Engineering Lead",
      }),
    ).toThrow("operatorPositionId must not be empty");
  });

  it("throws when operatorPositionId is whitespace only", () => {
    expect(() =>
      resolveOwnershipOnCreate({
        operatorUserId: "user-1",
        operatorUserLabel: "Alice",
        operatorPositionId: "   ",
        operatorPositionLabel: "Engineering Lead",
      }),
    ).toThrow("operatorPositionId must not be empty");
  });

  it("trims whitespace from all fields", () => {
    const result = resolveOwnershipOnCreate({
      operatorUserId: "  user-1  ",
      operatorUserLabel: "  Alice  ",
      operatorPositionId: "  pos-1  ",
      operatorPositionLabel: "  Lead  ",
    });

    expect(result.positionId).toBe("pos-1");
    expect(result.positionLabel).toBe("Lead");
    expect(result.createdByUserId).toBe("user-1");
    expect(result.currentManagerUserId).toBe("user-1");
  });

  it("uses userId as fallback label when userLabel is empty", () => {
    const result = resolveOwnershipOnCreate({
      operatorUserId: "user-1",
      operatorUserLabel: "",
      operatorPositionId: "pos-1",
      operatorPositionLabel: "Lead",
    });

    expect(result.createdByUserLabel).toBe("user-1");
    expect(result.currentManagerLabel).toBe("user-1");
  });
});

describe("resolveOwnershipOnImport", () => {
  it("uses provided positionId when available", () => {
    const result = resolveOwnershipOnImport({
      positionId: "pos-imported",
      positionLabel: "Imported Position",
      importerUserId: "importer-1",
      importerUserLabel: "Importer",
      fallbackPositionId: "pos-default",
      fallbackPositionLabel: "Default Admin",
    });

    expect(result.positionId).toBe("pos-imported");
    expect(result.positionLabel).toBe("Imported Position");
  });

  it("falls back to default position when positionId is null", () => {
    const result = resolveOwnershipOnImport({
      positionId: null,
      positionLabel: null,
      importerUserId: "importer-1",
      importerUserLabel: "Importer",
      fallbackPositionId: "pos-default",
      fallbackPositionLabel: "Default Admin",
    });

    expect(result.positionId).toBe("pos-default");
    expect(result.positionLabel).toBe("Default Admin");
  });

  it("falls back to default position when positionId is empty string", () => {
    const result = resolveOwnershipOnImport({
      positionId: "  ",
      positionLabel: "",
      importerUserId: "importer-1",
      importerUserLabel: "Importer",
      fallbackPositionId: "pos-default",
      fallbackPositionLabel: "Default Admin",
    });

    expect(result.positionId).toBe("pos-default");
    expect(result.positionLabel).toBe("Default Admin");
  });

  it("always has non-empty positionId", () => {
    const result = resolveOwnershipOnImport({
      importerUserId: "importer-1",
      importerUserLabel: "Importer",
      fallbackPositionId: "pos-default",
      fallbackPositionLabel: "Default Admin",
    });

    expect(result.positionId).toBeTruthy();
    expect(result.positionId.trim().length).toBeGreaterThan(0);
  });
});

describe("transferOwnershipOnPositionChange", () => {
  const baseOwnership = {
    positionId: "pos-eng",
    positionLabel: "Engineering",
    createdByUserId: "original-creator",
    createdByUserLabel: "Original Creator",
    currentManagerUserId: "old-user",
    currentManagerLabel: "Old User",
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  const assets: OwnedAsset[] = [
    { id: "agent-1", kind: "agent", ownership: { ...baseOwnership } },
    { id: "agent-2", kind: "agent", ownership: { ...baseOwnership } },
    { id: "group-1", kind: "group", ownership: { ...baseOwnership } },
    {
      id: "agent-other",
      kind: "agent",
      ownership: { ...baseOwnership, positionId: "pos-other" },
    },
  ];

  it("updates currentManagerUserId for all assets under the position", () => {
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-eng",
        previousUserId: "old-user",
        newUserId: "new-user",
        newUserLabel: "New User",
      },
      assets,
    );

    expect(result.updatedAssets).toHaveLength(3);
    for (const asset of result.updatedAssets) {
      expect(asset.ownership.currentManagerUserId).toBe("new-user");
      expect(asset.ownership.currentManagerLabel).toBe("New User");
    }
  });

  it("preserves createdByUserId (historical record)", () => {
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-eng",
        previousUserId: "old-user",
        newUserId: "new-user",
        newUserLabel: "New User",
      },
      assets,
    );

    for (const asset of result.updatedAssets) {
      expect(asset.ownership.createdByUserId).toBe("original-creator");
      expect(asset.ownership.createdByUserLabel).toBe("Original Creator");
    }
  });

  it("does not affect assets under other positions", () => {
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-eng",
        previousUserId: "old-user",
        newUserId: "new-user",
        newUserLabel: "New User",
      },
      assets,
    );

    // agent-other is under pos-other, should not be in updatedAssets
    const ids = result.updatedAssets.map((a) => a.id);
    expect(ids).not.toContain("agent-other");
  });

  it("produces correct transfer log", () => {
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-eng",
        previousUserId: "old-user",
        newUserId: "new-user",
        newUserLabel: "New User",
      },
      assets,
    );

    expect(result.transferLog.positionId).toBe("pos-eng");
    expect(result.transferLog.previousUserId).toBe("old-user");
    expect(result.transferLog.newUserId).toBe("new-user");
    expect(result.transferLog.affectedAgentCount).toBe(2);
    expect(result.transferLog.affectedGroupCount).toBe(1);
    expect(result.transferLog.transferredAt).toBeTruthy();
  });

  it("returns empty updatedAssets when no assets match the position", () => {
    const result = transferOwnershipOnPositionChange(
      {
        positionId: "pos-nonexistent",
        previousUserId: "old-user",
        newUserId: "new-user",
        newUserLabel: "New User",
      },
      assets,
    );

    expect(result.updatedAssets).toHaveLength(0);
    expect(result.transferLog.affectedAgentCount).toBe(0);
    expect(result.transferLog.affectedGroupCount).toBe(0);
  });
});
