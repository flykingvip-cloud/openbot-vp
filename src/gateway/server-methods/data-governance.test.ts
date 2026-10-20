// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileDataGovernanceCatalogStore } from "../data-governance/catalog-store.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "../data-governance/types.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dg-rpc-"));

vi.mock("../../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => tmpRoot,
  };
});

const resolveCallerGovernanceTenant = vi.fn(async () => ({
  tenantId: null as string | null,
  isPlatformAdmin: true,
  userId: null as string | null,
}));

vi.mock("./operator-access.js", () => ({
  resolveCallerGovernanceTenant,
}));

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: vi.fn(async () => ({ tenantId: null, userId: null })),
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const { dataGovernanceHandlers } = await import("./data-governance.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

async function invoke(
  method: keyof typeof dataGovernanceHandlers,
  params: Record<string, unknown> = {},
  client: unknown = { connect: { scopes: ["operator.admin"] } },
): Promise<InvokeResult> {
  let result: InvokeResult = { ok: false };
  await dataGovernanceHandlers[method]({
    req: {} as never,
    params,
    client: client as never,
    isWebchatConnect: () => false,
    respond: ((ok: boolean, payload?: unknown, error?: { message?: string }) => {
      result = { ok, payload: payload as Record<string, unknown>, error };
    }) as never,
    context: {} as never,
  });
  return result;
}

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  fs.rmSync(path.join(tmpRoot, "data-governance"), { recursive: true, force: true });
  resolveCallerGovernanceTenant.mockReset();
  resolveCallerGovernanceTenant.mockResolvedValue({
    tenantId: null,
    isPlatformAdmin: true,
    userId: null,
  });
  resolveTenantContextMock.mockReset();
  resolveTenantContextMock.mockResolvedValue(null);
});

async function seed(tenantId: string, resourceId: string) {
  const store = createFileDataGovernanceCatalogStore({
    storePath: path.join(tmpRoot, "data-governance", "catalog.json"),
  });
  await store.put({
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId,
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: "bind-1",
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: "bind-1",
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: "/data/ws",
        state: "active",
        contentVersion: "v1",
      },
    ],
  });
}

describe("dataGovernance inventory RPCs", () => {
  it("lists and gets catalogued resources for platform admin", async () => {
    await seed("t1", "ws-1");

    const list = await invoke("dataGovernance.inventory.list", {
      resourceType: "workspace",
      tenantId: "t1",
    });
    expect(list.ok).toBe(true);
    expect((list.payload?.items as unknown[])?.length).toBe(1);
    expect(list.payload?.access).toBe("platform_admin");

    const got = await invoke("dataGovernance.inventory.get", { resourceId: "ws-1" });
    expect(got.ok).toBe(true);
    expect(
      (got.payload?.record as { envelope?: { resourceId?: string } })?.envelope?.resourceId,
    ).toBe("ws-1");
  });

  it("rejects invalid resourceType", async () => {
    const res = await invoke("dataGovernance.inventory.list", { resourceType: "not-a-type" });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/resourceType/);
  });

  it("lists knowledge resources when catalogued", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(tmpRoot, "data-governance", "catalog.json"),
    });
    await store.put({
      envelope: {
        resourceId: "knowledge:t1:doc:d1:v1",
        resourceType: "knowledge",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "user", userId: "u1" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-k",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
        projection: { contentClass: "document_version", docId: "d1", versionId: "v1" },
      },
      bindings: [
        {
          bindingId: "bind-k",
          resourceId: "knowledge:t1:doc:d1:v1",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/k",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });
    const list = await invoke("dataGovernance.inventory.list", {
      resourceType: "knowledge",
      tenantId: "t1",
    });
    expect(list.ok).toBe(true);
    expect((list.payload?.items as unknown[])?.length).toBe(1);
  });

  it("diagnose returns orphan report for platform admin", async () => {
    const res = await invoke("dataGovernance.inventory.diagnose", {
      observedLocators: ["/data/orphan"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.orphans).toEqual([
      { locator: "/data/orphan", reason: "no_catalog_binding" },
    ]);
  });

  it("denies cross-tenant list filter for tenant-bound callers", async () => {
    resolveCallerGovernanceTenant.mockResolvedValue({
      tenantId: "t-a",
      isPlatformAdmin: false,
      userId: "u-a",
    });
    const res = await invoke(
      "dataGovernance.inventory.list",
      { tenantId: "t-b" },
      { connect: { scopes: ["operator.read"] } },
    );
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/cross-tenant/);
  });

  it("denies cross-tenant get for tenant-bound callers", async () => {
    await seed("t-other", "ws-other");
    resolveCallerGovernanceTenant.mockResolvedValue({
      tenantId: "t-a",
      isPlatformAdmin: false,
      userId: "u-a",
    });
    const res = await invoke(
      "dataGovernance.inventory.get",
      { resourceId: "ws-other" },
      { connect: { scopes: ["operator.read"] } },
    );
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/cross-tenant/);
  });

  it("denies tenant-bound get of tenantId=null local/system resources", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(tmpRoot, "data-governance", "catalog.json"),
    });
    await store.put({
      envelope: {
        resourceId: "ws-local",
        resourceType: "workspace",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: null,
        owner: { kind: "system", systemId: "local" },
        scope: { kind: "system" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-local",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-local",
          resourceId: "ws-local",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/local",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });
    resolveCallerGovernanceTenant.mockResolvedValue({
      tenantId: "t-a",
      isPlatformAdmin: false,
      userId: "u-a",
    });
    const res = await invoke(
      "dataGovernance.inventory.get",
      { resourceId: "ws-local" },
      { connect: { scopes: ["operator.read"] } },
    );
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/cross-tenant/);
  });

  it("denies diagnose for non-platform admin", async () => {
    resolveCallerGovernanceTenant.mockResolvedValue({
      tenantId: "t-a",
      isPlatformAdmin: false,
      userId: "u-a",
    });
    const res = await invoke("dataGovernance.inventory.diagnose", {});
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/platform admin/);
  });

  it("lists recovery_required via dedicated RPC and lifecycle filter", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(tmpRoot, "data-governance", "catalog.json"),
    });
    await store.put({
      envelope: {
        resourceId: "ws-rr",
        resourceType: "workspace",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "user", userId: "u1" },
        lifecycleState: "recovery_required",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-rr",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "bind-rr",
          resourceId: "ws-rr",
          role: "canonical",
          storageKind: "filesystem",
          locator: "/data/rr",
          state: "active",
          contentVersion: "v1",
        },
      ],
    });

    const byFilter = await invoke("dataGovernance.inventory.list", {
      lifecycleState: "recovery_required",
      tenantId: "t1",
    });
    expect(byFilter.ok).toBe(true);
    expect(
      (byFilter.payload?.items as Array<{ resourceId: string }>)?.map((i) => i.resourceId),
    ).toEqual(["ws-rr"]);

    const dedicated = await invoke("dataGovernance.inventory.listRecoveryRequired", {
      tenantId: "t1",
    });
    expect(dedicated.ok).toBe(true);
    expect((dedicated.payload?.items as unknown[])?.length).toBe(1);
  });

  it("diagnose reports duplicate canonicals for platform admin", async () => {
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(tmpRoot, "data-governance", "catalog.json"),
    });
    const mk = (resourceId: string) => ({
      envelope: {
        resourceId,
        resourceType: "workspace" as const,
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user" as const, userId: "u1" },
        scope: { kind: "user" as const, userId: "u1" },
        lifecycleState: "active" as const,
        classification: "internal" as const,
        governanceVersion: 1,
        canonicalBindingId: `bind-${resourceId}`,
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      },
      bindings: [
        {
          bindingId: `bind-${resourceId}`,
          resourceId,
          role: "canonical" as const,
          storageKind: "filesystem" as const,
          locator: "/data/shared-dup",
          state: "active" as const,
          contentVersion: "v1",
        },
      ],
    });
    await store.put(mk("ws-a"));
    await store.put(mk("ws-b"));

    const res = await invoke("dataGovernance.inventory.diagnose", {
      observedLocators: ["/data/shared-dup"],
    });
    expect(res.ok).toBe(true);
    const dups = res.payload?.duplicateCanonicals as string[];
    expect(
      dups.some((d) => d.includes("duplicate_canonical") && d.includes("/data/shared-dup")),
    ).toBe(true);
  });

  it("lists and reads recovery receipts for platform admin", async () => {
    const { writeGovernanceRecoveryReceipt } =
      await import("../data-governance/recovery-receipt.js");
    writeGovernanceRecoveryReceipt({
      operationId: "op-rpc-1",
      stage: "config_restore",
      reason: "test",
      haltCompensation: true,
      stateDir: tmpRoot,
    });

    const listed = await invoke("dataGovernance.recovery.listReceipts", {
      operationId: "op-rpc-1",
    });
    expect(listed.ok).toBe(true);
    expect((listed.payload?.receipts as unknown[])?.length).toBe(1);

    const got = await invoke("dataGovernance.recovery.getReceipt", {
      operationId: "op-rpc-1",
      stage: "config_restore",
    });
    expect(got.ok).toBe(true);
    expect((got.payload?.receipt as { operationId?: string })?.operationId).toBe("op-rpc-1");
  });

  it("rejects recovery receipt path traversal", async () => {
    const res = await invoke("dataGovernance.recovery.getReceipt", {
      operationId: "../etc",
      stage: "passwd",
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/invalid_recovery/);
  });
});

describe("dataGovernance later-wave enablement RPC", () => {
  const tenantId = "tenant-acme";
  const c19SummaryPath = path.resolve(
    process.cwd(),
    "docs/design/evidence/workspace-isolation-20260810-001.summary.json",
  );

  it("denies tenant-bound callers", async () => {
    resolveCallerGovernanceTenant.mockResolvedValue({
      tenantId: "t-a",
      isPlatformAdmin: false,
      userId: "u-a",
    });
    const res = await invoke(
      "dataGovernance.laterWave.evaluateEnablement",
      { tenantId, adapter: "byos" },
      { connect: { scopes: ["operator.write"] } },
    );
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/platform admin/);
  });

  it("rejects an unknown adapter", async () => {
    const res = await invoke("dataGovernance.laterWave.evaluateEnablement", {
      tenantId,
      adapter: "tenant-only",
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/adapter/);
  });

  it("denies when the authenticated call tenant does not match", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-other",
      userId: "u-ops",
      domain: "enterprise",
    });
    const res = await invoke("dataGovernance.laterWave.evaluateEnablement", {
      tenantId,
      adapter: "byos",
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("tenant_not_authorized");
  });

  it("evaluates BYOS gates without claiming LIVE cutover", async () => {
    const { PROMOTION_KEY_HMAC_KEY_ENV } =
      await import("../data-governance/cognitive-promotion-key.js");
    const { LATER_WAVE_C19_SUMMARY_PATH_ENV } =
      await import("../data-governance/later-wave-production-gate.js");
    const {
      installPlacementRegionTrustSecretForTests,
      signPlatformDeploymentRegionReceiptForTests,
    } = await import("../data-governance/placement-resolve.test-harness.js");
    const restoreSecret = installPlacementRegionTrustSecretForTests();
    const prevHmac = process.env[PROMOTION_KEY_HMAC_KEY_ENV];
    const prevC19 = process.env[LATER_WAVE_C19_SUMMARY_PATH_ENV];
    const prevProfile = process.env.OPENBOT_SECURITY_PROFILE;
    process.env[PROMOTION_KEY_HMAC_KEY_ENV] = "later-wave-hmac-test-key";
    process.env[LATER_WAVE_C19_SUMMARY_PATH_ENV] = c19SummaryPath;
    process.env.OPENBOT_SECURITY_PROFILE = "personal_local";
    resolveTenantContextMock.mockResolvedValue({
      tenantId,
      userId: "u-ops",
      domain: "enterprise",
    });
    const res = await invoke("dataGovernance.laterWave.evaluateEnablement", {
      tenantId,
      adapter: "byos",
      signedRegionReceipt: signPlatformDeploymentRegionReceiptForTests({
        receiptId: "drr-rpc-byos",
        tenantId,
        region: "us-west-2",
      }),
    });
    if (prevHmac === undefined) {
      delete process.env[PROMOTION_KEY_HMAC_KEY_ENV];
    } else {
      process.env[PROMOTION_KEY_HMAC_KEY_ENV] = prevHmac;
    }
    if (prevC19 === undefined) {
      delete process.env[LATER_WAVE_C19_SUMMARY_PATH_ENV];
    } else {
      process.env[LATER_WAVE_C19_SUMMARY_PATH_ENV] = prevC19;
    }
    if (prevProfile === undefined) {
      delete process.env.OPENBOT_SECURITY_PROFILE;
    } else {
      process.env.OPENBOT_SECURITY_PROFILE = prevProfile;
    }
    restoreSecret();
    expect(res.ok).toBe(true);
    expect(res.payload?.liveCutover).toBe(false);
    expect(res.payload?.ok).toBe(true);
    expect(
      (res.payload?.receipt as { productionReady?: boolean; liveCutover?: boolean })
        ?.productionReady,
    ).toBe(true);
    expect((res.payload?.receipt as { liveCutover?: boolean })?.liveCutover).toBe(false);
  });
});
