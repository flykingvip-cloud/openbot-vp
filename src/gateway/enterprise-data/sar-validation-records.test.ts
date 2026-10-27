// @vitest-environment node
/**
 * A2: durable validation records → capability-install projection.
 * Product path loads from the enterprise store (not a fixture-only empty array).
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationRecord } from "../../site-capability/validation-record.js";
import { projectCapabilityCenterInstall } from "./capability-center-install.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataSource } from "./data-source-store.js";
import {
  listSarValidationRecordsForInstall,
  upsertSarValidationRecord,
} from "./sar-validation-records.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";
import type { EnterpriseDataStore, EnterpriseSarExecutionBridge } from "./types.js";

const tenantId = "tenant-acme";
const otherTenant = "tenant-other";
const ownerId = "user-owner";
const skillId = "skill-site";
const agentId = "robot-a2";
const nowIso = "2026-10-18T10:00:00.000Z";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-sar-a2-validation-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const requireAdminTenantMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("./enterprise-data-seat-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-data-seat-context.js")>();
  return {
    ...actual,
    requireResolvedEnterpriseAdminTenantId: requireAdminTenantMock,
  };
});

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { details?: { code?: string } }) => ({
    code,
    message,
    details: extra?.details,
  }),
}));

function validation(overrides: Partial<ValidationRecord> = {}): ValidationRecord {
  return {
    recordId: "val-a2-1",
    capabilityId: "sar.cap.read",
    version: "2026.10.17",
    artifactDigest: "digest-pinned",
    input: {},
    participatedInDraftGeneration: false,
    basis: { kind: "human", statement: "夹具核对通过" },
    runId: "run-1",
    evidenceRef: "evidence-1",
    output: { ok: true },
    completeness: "complete",
    verdict: "passed",
    reviewer: "reviewer-1",
    reviewedAt: "2026-10-17T09:00:00.000Z",
    reason: "输出与夹具一致",
    runStatus: "succeeded",
    runVerification: "not_performed",
    promotable: true,
    ...overrides,
  };
}

function bridge(
  overrides: Partial<EnterpriseSarExecutionBridge> = {},
): EnterpriseSarExecutionBridge {
  return {
    bridgeId: "bridge-1",
    tenantId,
    sourceId: "src-site",
    actionRef: { connectorId: "site-session", actionKey: "read", version: "1" },
    capabilityId: "sar.cap.read",
    version: "2026.10.17",
    artifactDigest: "digest-pinned",
    skillId,
    bindingId: "bind-owner",
    userId: ownerId,
    verification: "passed",
    effect: "read",
    supportedScopeTypes: ["SELF"],
    enforcedFilterFields: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function storeReady(skillKey = skillId): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  upsertDataSource({
    store,
    tenantId,
    nowIso: "2026-10-16T00:00:00.000Z",
    source: {
      sourceId: "src-site",
      sourceKey: "site-a",
      displayName: "网站 A",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId: "bind-owner",
    },
  });
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId: ownerId },
    bindingId: "bind-owner",
  });
  store.sarExecutionBridges = { "bridge-1": bridge({ skillId: skillKey }) };
  return store;
}

function projectFromStore(store: EnterpriseDataStore, now = nowIso) {
  return projectCapabilityCenterInstall({
    store,
    tenantId,
    callerUserId: ownerId,
    skill: {
      skillId,
      lifecycle: "private",
      visibility: "private",
      dependencies: [],
    },
    pin: {
      skillId,
      installedVersion: "2026.10.17",
      artifactDigest: "digest-pinned",
      enabled: true,
    },
    skillAuthorized: true,
    validationRecords: listSarValidationRecordsForInstall({ store, tenantId, nowIso: now }),
    catalog: { version: "2026.10.18" },
  });
}

function cleanTmp() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

describe("A2 sar validation records → install projection", () => {
  beforeEach(() => {
    cleanTmp();
    requireAdminTenantMock.mockReset();
    resolveBillingScopeMock.mockReset();
  });
  afterEach(() => {
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  });

  it("makes install executable when a matching durable passed record exists", () => {
    const store = storeReady();
    upsertSarValidationRecord({ store, tenantId, record: validation() });
    const facts = projectFromStore(store);
    expect(facts.executable).toBe(true);
    expect(facts.verification).toBe("passed");
    expect(facts.reviewedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(facts.denialCode).toBeNull();
  });

  it("rejects when no durable validation record is present", () => {
    const store = storeReady();
    const facts = projectFromStore(store);
    expect(facts.executable).toBe(false);
    expect(facts.verification).toBe("unknown");
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
  });

  it("rejects an expired durable validation record", () => {
    const store = storeReady();
    upsertSarValidationRecord({
      store,
      tenantId,
      record: validation(),
      expiresAt: "2026-10-18T09:00:00.000Z",
    });
    expect(listSarValidationRecordsForInstall({ store, tenantId, nowIso })).toEqual([]);
    const facts = projectFromStore(store);
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
  });

  it("rejects a durable record whose version or digest does not match the pin", () => {
    const store = storeReady();
    upsertSarValidationRecord({
      store,
      tenantId,
      record: validation({ version: "2026.10.18", artifactDigest: "digest-other" }),
    });
    const facts = projectFromStore(store);
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
    expect(listSarValidationRecordsForInstall({ store, tenantId, nowIso })).toHaveLength(1);
  });

  it("does not leak another tenant's durable validation record", () => {
    const store = storeReady();
    upsertSarValidationRecord({
      store,
      tenantId: otherTenant,
      record: validation(),
    });
    expect(listSarValidationRecordsForInstall({ store, tenantId, nowIso })).toEqual([]);
    const facts = projectFromStore(store);
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
    expect(
      listSarValidationRecordsForInstall({ store, tenantId: otherTenant, nowIso }),
    ).toHaveLength(1);
  });

  it("persists validation records in the enterprise data store across load/save", async () => {
    const store = storeReady();
    upsertSarValidationRecord({ store, tenantId, record: validation() });
    await saveEnterpriseDataStore(store);
    const reloaded = await loadEnterpriseDataStore();
    const listed = listSarValidationRecordsForInstall({
      store: reloaded,
      tenantId,
      nowIso,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.recordId).toBe("val-a2-1");
    expect(listed[0]?.verdict).toBe("passed");
  });

  it("wires enterprise-data.assets.capability-install to load durable records", async () => {
    const source = fs.readFileSync(
      new URL("../server-methods/enterprise-data-assets.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("listSarValidationRecordsForInstall");
    expect(source).not.toMatch(/validationRecords:\s*\[\s*\]/);

    const { resetSkillHealthWindowsCacheForTests, saveSkillAsset } =
      await import("../skill-lifecycle-store.js");
    const { writeSarExecutionPin } = await import("../skill-execution-binding/sar-pin.js");
    const { createEnterpriseDataAssetHandlers } =
      await import("../server-methods/enterprise-data-assets.js");

    resetSkillHealthWindowsCacheForTests();
    const saved = saveSkillAsset({
      sourceAgentId: agentId,
      lifecycle: "private",
      profile: {
        name: "A2 website skill",
        summary: "Pinned SAR skill for install projection",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: {
        prompts: ["use pinned artifact"],
        dependencies: [],
      },
    });

    writeSarExecutionPin({
      agentId,
      skillId: saved.skillId,
      skillName: "A2 website skill",
      installedVersion: "2026.10.17",
      artifactDigest: "digest-pinned",
      enabled: true,
      materialisedPath: "",
      updatedAtMs: 1,
    });

    const store = storeReady(saved.skillId);
    upsertSarValidationRecord({ store, tenantId, record: validation() });
    await saveEnterpriseDataStore(store);

    requireAdminTenantMock.mockResolvedValue(tenantId);
    resolveBillingScopeMock.mockResolvedValue({
      user: { id: ownerId },
      tenantId,
      isEnterpriseAdmin: true,
    });

    async function withStore<T>(
      runTenantId: string,
      _client: unknown,
      run: (s: EnterpriseDataStore) => Promise<T> | T,
    ): Promise<T> {
      expect(runTenantId).toBe(tenantId);
      const loaded = await loadEnterpriseDataStore();
      const result = await run(loaded);
      await saveEnterpriseDataStore(loaded);
      return result;
    }

    const handlers = createEnterpriseDataAssetHandlers(withStore);
    const handler = handlers["enterprise-data.assets.capability-install"];

    let respondOk = false;
    let payload: Record<string, unknown> | undefined;
    let error: unknown;
    await handler({
      req: { type: "req", id: "1", method: "enterprise-data.assets.capability-install" },
      params: { tenantId, skillId: saved.skillId, agentId },
      client: { user: "owner@example.com" } as never,
      context: {} as never,
      respond: (ok: boolean, data?: unknown, err?: unknown) => {
        respondOk = ok;
        payload = data as Record<string, unknown> | undefined;
        error = err;
      },
    } as never);

    expect(error).toBeUndefined();
    expect(respondOk).toBe(true);
    expect(payload?.tenantId).toBe(tenantId);
    const facts = payload?.facts as {
      executable: boolean;
      verification: string;
      denialCode: string | null;
      reviewedAt: string | null;
    };
    expect(facts.executable).toBe(true);
    expect(facts.verification).toBe("passed");
    expect(facts.reviewedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(facts.denialCode).toBeNull();
  });

  it("RPC path rejects cross-tenant durable records", async () => {
    const { resetSkillHealthWindowsCacheForTests, saveSkillAsset } =
      await import("../skill-lifecycle-store.js");
    const { writeSarExecutionPin } = await import("../skill-execution-binding/sar-pin.js");
    const { createEnterpriseDataAssetHandlers } =
      await import("../server-methods/enterprise-data-assets.js");

    resetSkillHealthWindowsCacheForTests();
    const saved = saveSkillAsset({
      sourceAgentId: agentId,
      lifecycle: "private",
      profile: {
        name: "A2 cross tenant",
        summary: "cross tenant",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], dependencies: [] },
    });
    writeSarExecutionPin({
      agentId,
      skillId: saved.skillId,
      skillName: "A2 cross tenant",
      installedVersion: "2026.10.17",
      artifactDigest: "digest-pinned",
      enabled: true,
      materialisedPath: "",
      updatedAtMs: 1,
    });

    const store = storeReady(saved.skillId);
    upsertSarValidationRecord({
      store,
      tenantId: otherTenant,
      record: validation(),
    });
    await saveEnterpriseDataStore(store);

    requireAdminTenantMock.mockResolvedValue(tenantId);
    resolveBillingScopeMock.mockResolvedValue({
      user: { id: ownerId },
      tenantId,
      isEnterpriseAdmin: true,
    });

    async function withStore<T>(
      runTenantId: string,
      _client: unknown,
      run: (s: EnterpriseDataStore) => Promise<T> | T,
    ): Promise<T> {
      const loaded = await loadEnterpriseDataStore();
      return run(loaded);
    }

    const handlers = createEnterpriseDataAssetHandlers(withStore);
    const handler = handlers["enterprise-data.assets.capability-install"];
    let payload: Record<string, unknown> | undefined;
    await handler({
      req: { type: "req", id: "2", method: "enterprise-data.assets.capability-install" },
      params: { tenantId, skillId: saved.skillId, agentId },
      client: { user: "owner@example.com" } as never,
      context: {} as never,
      respond: (_ok: boolean, data?: unknown) => {
        payload = data as Record<string, unknown> | undefined;
      },
    } as never);

    const facts = payload?.facts as { executable: boolean; denialCode: string | null };
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
  });
});
