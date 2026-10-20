import { describe, expect, it, vi } from "vitest";

type OwnershipRow = {
  subjectKind: string;
  subjectId: string;
  tenantId: string;
  bindingStatus: string;
};

const listOwnershipRecordsMock = vi.hoisted(() => vi.fn(() => [] as OwnershipRow[]));
const findActiveOwnershipRecordMock = vi.hoisted(() =>
  vi.fn(
    (params: { tenantId: string; subjectKind: string; subjectId: string }): OwnershipRow | null => {
      return (
        listOwnershipRecordsMock().find(
          (entry) =>
            entry.subjectKind === params.subjectKind &&
            entry.subjectId === params.subjectId &&
            entry.tenantId === params.tenantId &&
            entry.bindingStatus !== "revoked",
        ) ?? null
      );
    },
  ),
);

vi.mock("../ownership-store.js", () => ({
  listOwnershipRecords: () => listOwnershipRecordsMock(),
  findActiveOwnershipRecord: (params: {
    tenantId: string;
    subjectKind: string;
    subjectId: string;
  }) => findActiveOwnershipRecordMock(params),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ agents: { list: [] }, session: {} }),
}));

describe("resolveCollaborationGroupTenantId", () => {
  it("returns the unique ownership tenant when no tenant context is provided", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "grp-acme",
        tenantId: "tenant-acme",
        bindingStatus: "active",
      },
    ]);
    const { resolveCollaborationGroupTenantId } =
      await import("../collaboration-learning/shared.js");
    expect(resolveCollaborationGroupTenantId("grp-acme")).toBe("tenant-acme");
  });

  it("resolves with authoritative tenant context via (tenantId, groupId)", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-a",
        bindingStatus: "active",
      },
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-b",
        bindingStatus: "active",
      },
    ]);
    const { resolveCollaborationGroupTenantId } =
      await import("../collaboration-learning/shared.js");
    expect(resolveCollaborationGroupTenantId("shared-gid", "tenant-b")).toBe("tenant-b");
    expect(findActiveOwnershipRecordMock).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      subjectKind: "group",
      subjectId: "shared-gid",
    });
  });

  it("fail-closes to null when the same groupId has ownership in multiple tenants", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-a",
        bindingStatus: "active",
      },
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-b",
        bindingStatus: "active",
      },
    ]);
    const { resolveCollaborationGroupTenantId } =
      await import("../collaboration-learning/shared.js");
    expect(resolveCollaborationGroupTenantId("shared-gid")).toBeNull();
  });

  it("does not fall through to another tenant when context ownership is missing", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-a",
        bindingStatus: "active",
      },
    ]);
    const { resolveCollaborationGroupTenantId } =
      await import("../collaboration-learning/shared.js");
    expect(resolveCollaborationGroupTenantId("shared-gid", "tenant-missing")).toBeNull();
  });
});

describe("buildWorkspaceSpaceSnapshot tenantId contract", () => {
  it("surfaces authoritative ownership tenantId on the space snapshot", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "grp-acme",
        tenantId: "tenant-acme",
        bindingStatus: "active",
      },
    ]);
    const { buildWorkspaceSpaceSnapshot } = await import("../collaboration-learning/shared.js");
    const snapshot = buildWorkspaceSpaceSnapshot({
      groupId: "grp-acme",
      profile: null,
      members: [],
    });
    expect(snapshot.tenantId).toBe("tenant-acme");
  });

  it("prefers explicit tenantId over ownership when provided", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "grp-acme",
        tenantId: "tenant-from-ownership",
        bindingStatus: "active",
      },
    ]);
    const { buildWorkspaceSpaceSnapshot } = await import("../collaboration-learning/shared.js");
    const snapshot = buildWorkspaceSpaceSnapshot({
      groupId: "grp-acme",
      profile: null,
      members: [],
      tenantId: "tenant-from-params",
    });
    expect(snapshot.tenantId).toBe("tenant-from-params");
  });

  it("returns null tenantId when no ownership binding exists", async () => {
    listOwnershipRecordsMock.mockReturnValue([]);
    const { buildWorkspaceSpaceSnapshot } = await import("../collaboration-learning/shared.js");
    const snapshot = buildWorkspaceSpaceSnapshot({
      groupId: "grp-orphan",
      profile: null,
      members: [],
    });
    expect(snapshot.tenantId).toBeNull();
  });

  it("returns null tenantId when the same groupId is owned by multiple tenants", async () => {
    listOwnershipRecordsMock.mockReturnValue([
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-a",
        bindingStatus: "active",
      },
      {
        subjectKind: "group",
        subjectId: "shared-gid",
        tenantId: "tenant-b",
        bindingStatus: "active",
      },
    ]);
    const { buildWorkspaceSpaceSnapshot } = await import("../collaboration-learning/shared.js");
    const snapshot = buildWorkspaceSpaceSnapshot({
      groupId: "shared-gid",
      profile: null,
      members: [],
    });
    expect(snapshot.tenantId).toBeNull();
  });
});
