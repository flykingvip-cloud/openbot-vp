import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMocks } from "./agents-item7-batch9-12-cr.test.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const m = getMocks();
  return {
    ...actual,
    mkdir: (...args: unknown[]) => m.mkdir(...args),
    appendFile: (...args: unknown[]) => m.appendFile(...args),
    access: (...args: unknown[]) => m.access(...args),
  };
});

import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import {
  CANONICAL_LOCATOR,
  expectDenied,
  expectDeniedAny,
  expectZeroFileOps,
  groupOwnedCatalog,
  handlerArgs,
  installCompleteTrustedContext,
  installGroupMemberContext,
  installPositionMemberContext,
  multiOwnerSameAssetCatalog,
  positionOwnedCatalog,
  resetCrMocks,
  trustedSeatStore,
} from "./agents-item7-batch9-12-cr.test.js";

/** Two position rows, same asset, no user row — must stay ambiguous. */
function dualPositionSameAssetCatalog() {
  const sales = positionOwnedCatalog({ seatId: "seat-sales" }).snapshot();
  const other = positionOwnedCatalog({ seatId: "seat-other" }).snapshot();
  const salesResource = Object.values(sales.resources)[0];
  const salesBinding = Object.values(sales.bindings)[0];
  const otherResource = Object.values(other.resources)[0];
  const otherBinding = Object.values(other.bindings)[0];
  if (!salesResource || !salesBinding || !otherResource || !otherBinding) {
    throw new Error("dual position fixture missing");
  }
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: {
      [salesResource.resourceId]: salesResource,
      [otherResource.resourceId]: otherResource,
    },
    bindings: {
      [salesBinding.bindingId]: salesBinding,
      [otherBinding.bindingId]: otherBinding,
    },
  });
}

const mocks = getMocks();

const helperSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents-handler-workspace-locator.ts"),
  "utf8",
);

const HANDLERS = [
  {
    site: "S10",
    method: "agents.files.get" as const,
    params: { agentId: "research", name: "IDENTITY.md" },
  },
  {
    site: "S11",
    method: "agents.files.set" as const,
    params: { agentId: "research", name: "IDENTITY.md", content: "x" },
  },
  {
    site: "S12",
    method: "agents.update" as const,
    params: { agentId: "research", avatar: "🙂" },
  },
  {
    site: "S13",
    method: "agents.delete" as const,
    params: { agentId: "research" },
  },
];

async function invokeHandler(
  method: (typeof HANDLERS)[number]["method"],
  params: Record<string, unknown>,
) {
  const respond = vi.fn();
  const { agentsHandlers } = await import("./agents.js");
  await agentsHandlers[method](handlerArgs(params, respond));
  return respond;
}

describe("Item 7 CR2 resolver wiring", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("selects by tenantId + owner scope + agentAssetId and never first-matches", () => {
    expect(helperSource).not.toMatch(/matching\[0\]/);
    expect(helperSource).toMatch(/tenantId !== params\.tenantId/);
    expect(helperSource).toMatch(/ownerScope/);
    expect(helperSource).toMatch(/agentAssetId/);
    expect(helperSource).toMatch(/loadPlatformAuthStore/);
    expect(helperSource).toMatch(/loadSeatAssetsStoreForTenantId/);
    expect(helperSource).toMatch(/loadAuthoritativeGroupMembers/);
    expect(helperSource).not.toMatch(/client\.membership/);
    expect(helperSource).not.toMatch(/params\.params/);
    expect(helperSource).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg\s*\}\s*\)/);
  });

  for (const handler of HANDLERS) {
    describe(`${handler.site} ${handler.method}`, () => {
      it("keeps the unique user-owned row when a seat shadow shares the agentAssetId", async () => {
        // selectTrustedCatalogResource treats one user_owned row plus a
        // position_owned shadow as the personal workspace, not ambiguity.
        installCompleteTrustedContext();
        mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
          catalog: multiOwnerSameAssetCatalog(),
          agentAssetId: "asset-alpha",
        });
        const respond = await invokeHandler(handler.method, handler.params);
        expect(respond.mock.calls[0]?.[0]).toBe(true);
        if (handler.method === "agents.files.get") {
          expect(respond.mock.calls[0]?.[1]?.workspace).toBe(CANONICAL_LOCATOR);
        }
      });

      it("rejects two position-owned rows for the same agentAssetId and performs zero file ops", async () => {
        installCompleteTrustedContext();
        mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
          catalog: dualPositionSameAssetCatalog(),
          agentAssetId: "asset-alpha",
        });
        const respond = await invokeHandler(handler.method, handler.params);
        expectDeniedAny(respond, ["catalog_ambiguous", "first_canonical_selection_forbidden"]);
        expectZeroFileOps();
      });

      it("accepts a position owner who is a current seat member", async () => {
        installPositionMemberContext();
        const respond = await invokeHandler(handler.method, handler.params);
        expect(respond.mock.calls[0]?.[0]).toBe(true);
        if (handler.method === "agents.files.get") {
          expect(respond.mock.calls[0]?.[1]?.workspace).toBe(CANONICAL_LOCATOR);
        }
      });

      it("rejects a position owner who is not the current seat member", async () => {
        installPositionMemberContext();
        mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(
          trustedSeatStore({ currentEmployeeId: "user-other" }),
        );
        const respond = await invokeHandler(handler.method, handler.params);
        expectDenied(respond, "auth_failure");
        expectZeroFileOps();
      });

      it("rejects a position owner whose seat membership is cross-tenant", async () => {
        installPositionMemberContext();
        mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
          catalog: positionOwnedCatalog({ tenantId: "tenant-b" }),
          agentAssetId: "asset-alpha",
        });
        const respond = await invokeHandler(handler.method, handler.params);
        expectDeniedAny(respond, ["catalog_miss", "tenant_mismatch"]);
        expectZeroFileOps();
      });

      it("rejects a position owner when Platform Auth / seat SoT is missing", async () => {
        installPositionMemberContext();
        mocks.resolvePlatformAuthConfig.mockReturnValue(null);
        mocks.loadPlatformAuthStore.mockResolvedValue(null);
        mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(null);
        const respond = await invokeHandler(handler.method, handler.params);
        expectDenied(respond, "missing_membership_sot");
        expectZeroFileOps();
      });

      it("accepts a group owner who is an authoritative member", async () => {
        installGroupMemberContext();
        const respond = await invokeHandler(handler.method, handler.params);
        expect(respond.mock.calls[0]?.[0]).toBe(true);
        if (handler.method === "agents.files.get") {
          expect(respond.mock.calls[0]?.[1]?.workspace).toBe(CANONICAL_LOCATOR);
        }
      });

      it("rejects a group owner who is not a member", async () => {
        installGroupMemberContext();
        mocks.loadAuthoritativeGroupMembers.mockResolvedValue([
          { userId: "user-sam", status: "active" },
        ]);
        const respond = await invokeHandler(handler.method, handler.params);
        expectDenied(respond, "auth_failure");
        expectZeroFileOps();
      });

      it("rejects a group owner when membership SoT is unavailable", async () => {
        installGroupMemberContext();
        mocks.loadAuthoritativeGroupMembers.mockRejectedValue(new Error("acl missing"));
        const respond = await invokeHandler(handler.method, handler.params);
        expectDenied(respond, "missing_membership_sot");
        expectZeroFileOps();
      });

      it("keeps the user-owned happy path", async () => {
        installCompleteTrustedContext();
        const respond = await invokeHandler(handler.method, handler.params);
        expect(respond.mock.calls[0]?.[0]).toBe(true);
        if (handler.method === "agents.files.get") {
          expect(respond.mock.calls[0]?.[1]?.workspace).toBe(CANONICAL_LOCATOR);
        }
      });
    });
  }

  it("deletes a seat-owned robot the ownership store still assigns to the actor", async () => {
    installPositionMemberContext();
    mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(
      trustedSeatStore({ currentEmployeeId: "user-other" }),
    );
    mocks.findActiveOwnershipRecord.mockReturnValue({
      tenantId: "tenant-a",
      subjectKind: "agent",
      subjectId: "research",
      currentManagerUserId: "Elle@Example.com",
      bindingStatus: "active",
    });
    const respond = await invokeHandler("agents.delete", { agentId: "research" });
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(mocks.movePathToTrash.mock.calls.some((args) => args[0] === CANONICAL_LOCATOR)).toBe(
      true,
    );
  });

  it("still denies file reads when only the delete manager proof would match", async () => {
    installPositionMemberContext();
    mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(
      trustedSeatStore({ currentEmployeeId: "user-other" }),
    );
    mocks.findActiveOwnershipRecord.mockReturnValue({
      tenantId: "tenant-a",
      subjectKind: "agent",
      subjectId: "research",
      currentManagerUserId: "elle@example.com",
      bindingStatus: "active",
    });
    const respond = await invokeHandler("agents.files.get", {
      agentId: "research",
      name: "IDENTITY.md",
    });
    expectDenied(respond, "auth_failure");
    expectZeroFileOps();
  });

  it("accepts a seat occupant stored as the actor email", async () => {
    installPositionMemberContext();
    mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(
      trustedSeatStore({ currentEmployeeId: "elle@example.com" }),
    );
    const respond = await invokeHandler("agents.delete", { agentId: "research" });
    expect(respond.mock.calls[0]?.[0]).toBe(true);
  });

  it("does not treat a foreign-tenant group catalog row as a match", async () => {
    installGroupMemberContext();
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: groupOwnedCatalog({ tenantId: "tenant-b" }),
      agentAssetId: "group-ops",
    });
    const respond = await invokeHandler("agents.files.get", {
      agentId: "research",
      name: "IDENTITY.md",
    });
    expectDenied(respond, "catalog_miss");
    expectZeroFileOps();
  });
});
