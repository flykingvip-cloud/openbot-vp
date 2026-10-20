import { describe, expect, it } from "vitest";
import * as handleModule from "./memory-workspace-handle.js";
import {
  checkConfiguredCloudTenant,
  createMemoryWorkspaceHandle,
  deriveCloudTenantId,
  isMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
} from "./memory-workspace-handle.js";

const COMPLETE = {
  resourceId: "ws-resource-1",
  memoryAssetResourceId: "mem-asset-1",
  tenantId: "tenant-1",
  agentAssetId: "agent-asset-1",
  bindingId: "binding-1",
  canonicalObjectKey: "object-1",
  governanceVersion: 3,
  fencingToken: "fence-1",
  lifecycle: "active",
  permissions: {
    search: true,
    ingest: true,
    distill: false,
    prune: false,
    reset: false,
    export: true,
  },
} as const;

const RETIRED_READ_ONLY = {
  ...COMPLETE,
  lifecycle: "retired",
  permissions: {
    search: true,
    ingest: false,
    distill: false,
    prune: false,
    reset: false,
    export: true,
  },
} as const;

describe("U0 MemoryWorkspaceHandle contract", () => {
  it("does not export a forgeable brand symbol", () => {
    expect("MEMORY_WORKSPACE_HANDLE_BRAND" in handleModule).toBe(false);
    expect(Object.getOwnPropertyNames(handleModule)).not.toContain("MEMORY_WORKSPACE_HANDLE_BRAND");
  });

  it("constructs only a branded complete handle", () => {
    const result = createMemoryWorkspaceHandle(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(isMemoryWorkspaceHandle(result.handle)).toBe(true);
    expect(result.handle.resourceId).toBe("ws-resource-1");
    expect(result.handle.memoryAssetResourceId).toBe("mem-asset-1");
    expect(result.handle.governanceVersion).toBe(3);
  });

  it("does not construct a handle when resourceId, Memory Asset, tenant, binding, or fencing is missing", () => {
    const cases = [
      [{ ...COMPLETE, resourceId: "  " }, "missing_workspace_resource"],
      [{ ...COMPLETE, memoryAssetResourceId: "" }, "missing_memory_asset"],
      [{ ...COMPLETE, tenantId: undefined }, "tenant_mismatch"],
      [{ ...COMPLETE, bindingId: "" }, "missing_binding"],
      [{ ...COMPLETE, fencingToken: "" }, "stale_fencing_token"],
    ] as const;
    for (const [input, reasonCode] of cases) {
      const result = createMemoryWorkspaceHandle(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe(reasonCode);
      }
    }
  });

  it("requires governanceVersion to be a positive integer", () => {
    for (const governanceVersion of [0, -1, 1.5, Number.NaN, "3", undefined]) {
      const result = createMemoryWorkspaceHandle({ ...COMPLETE, governanceVersion });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe("stale_fencing_token");
        expect(result.reason).toMatch(/positive integer/);
      }
    }
    const ok = createMemoryWorkspaceHandle({ ...COMPLETE, governanceVersion: 1 });
    expect(ok.ok).toBe(true);
  });

  it("requires all six permission fields to be boolean", () => {
    const cases = [
      { ...COMPLETE.permissions, search: "true" },
      { ...COMPLETE.permissions, ingest: 1 },
      { ...COMPLETE.permissions, distill: null },
      { search: true, ingest: true, distill: false, prune: false, reset: false },
      { ...COMPLETE.permissions, export: undefined },
    ];
    for (const permissions of cases) {
      const result = createMemoryWorkspaceHandle({ ...COMPLETE, permissions });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe("missing_binding");
        expect(result.reason).toMatch(/six boolean fields/);
      }
    }
  });

  it("rejects retired/purged handles that still allow ingest/distill/prune/reset", () => {
    for (const lifecycle of ["retired", "purged"] as const) {
      for (const key of ["ingest", "distill", "prune", "reset"] as const) {
        const result = createMemoryWorkspaceHandle({
          ...RETIRED_READ_ONLY,
          lifecycle,
          permissions: { ...RETIRED_READ_ONLY.permissions, [key]: true },
        });
        expect(result.ok, `${lifecycle}.${key}`).toBe(false);
        if (!result.ok) {
          expect(result.reasonCode).toBe("missing_binding");
          expect(result.reason).toMatch(/forbids ingest\/distill\/prune\/reset/);
        }
      }
    }
  });

  it("constructs retired/purged handles only when write permissions are all false", () => {
    for (const lifecycle of ["retired", "purged"] as const) {
      const result = createMemoryWorkspaceHandle({ ...RETIRED_READ_ONLY, lifecycle });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.handle.permissions).toEqual(RETIRED_READ_ONLY.permissions);
      }
    }
  });

  it("returns structured denial for ambiguous agent assets and stale fencing", () => {
    expect(
      createMemoryWorkspaceHandle({ ...COMPLETE, reasonCode: "ambiguous_agent_asset" }),
    ).toEqual({
      ok: false,
      reasonCode: "ambiguous_agent_asset",
      reason: "agent asset is not uniquely bound; do not construct a handle",
    });
    const stale = createMemoryWorkspaceHandle({ ...COMPLETE, reasonCode: "stale_fencing_token" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reasonCode).toBe("stale_fencing_token");
    }
  });

  it("does not treat spread, Object.assign, type assertions, or stolen brands as a handle", () => {
    const created = createMemoryWorkspaceHandle(COMPLETE);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const spread = { ...created.handle } as MemoryWorkspaceHandle;
    const assigned = Object.assign({}, COMPLETE) as MemoryWorkspaceHandle;
    const globalForged = Object.defineProperty(
      { ...COMPLETE },
      Symbol.for("openbot.MemoryWorkspaceHandle"),
      {
        value: true,
        writable: false,
        enumerable: false,
        configurable: false,
      },
    );
    const stolenSymbols = Object.getOwnPropertySymbols(created.handle);
    const stolen =
      stolenSymbols.length > 0
        ? Object.defineProperty({ ...created.handle }, stolenSymbols[0], {
            value: true,
            writable: false,
            enumerable: false,
            configurable: false,
          })
        : { ...created.handle };
    expect(isMemoryWorkspaceHandle(spread)).toBe(false);
    expect(isMemoryWorkspaceHandle(assigned)).toBe(false);
    expect(isMemoryWorkspaceHandle(COMPLETE)).toBe(false);
    expect(isMemoryWorkspaceHandle(globalForged)).toBe(false);
    expect(isMemoryWorkspaceHandle(stolen)).toBe(false);
    expect(() => deriveCloudTenantId(spread)).toThrow(/branded MemoryWorkspaceHandle/);
  });

  it("derives cloud tenantId from the branded handle and rejects config mismatch", () => {
    const created = createMemoryWorkspaceHandle(COMPLETE);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(deriveCloudTenantId(created.handle)).toBe("tenant-1");
    expect(
      checkConfiguredCloudTenant({
        handle: created.handle,
        configuredTenantId: "tenant-1",
      }).ok,
    ).toBe(true);
    expect(
      checkConfiguredCloudTenant({
        handle: created.handle,
        configuredTenantId: "other-tenant",
      }),
    ).toEqual({
      ok: false,
      reasonCode: "tenant_mismatch",
      reason:
        "configured cloud tenantId is not a second tenant source; it must equal Handle.tenantId",
    });
  });
});
