// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import type { ValidationRecord } from "../../site-capability/validation-record.js";
import { includeInEnterprisePublicCatalog } from "../skill-lifecycle-store.js";
import {
  hideRegistryDraftFromPublicCatalog,
  installLeavesAccountBindingsUntouched,
  projectCapabilityCenterInstall,
} from "./capability-center-install.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataSource } from "./data-source-store.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore, EnterpriseSarExecutionBridge } from "./types.js";

const tenantId = "tenant-acme";
const ownerId = "user-owner";
const adminId = "user-admin";
const skillId = "skill-site";

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

function storeWithSite(options?: { withAccount?: boolean }): EnterpriseDataStore {
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
  if (options?.withAccount !== false) {
    registerCallerAccountBinding({
      store,
      caller: { tenantId, userId: ownerId },
      bindingId: "bind-owner",
    });
  }
  store.sarExecutionBridges = { "bridge-1": bridge() };
  return store;
}

function validation(overrides: Partial<ValidationRecord> = {}): ValidationRecord {
  return {
    recordId: "val-1",
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

function inFlight(): SiteRunResult {
  return {
    runId: "run-inflight",
    capabilityId: "sar.cap.read",
    version: "2026.10.17",
    status: "unknown",
    verification: "not_performed",
    data: null,
    completeness: "partial",
    evidenceRef: "evidence-inflight",
    durationMs: 10,
    repair: "none",
    error: {
      code: "TIMEOUT",
      message: "unknown",
      retry: "not_ordinary",
      ordinaryFailure: false,
    },
  };
}

function project(
  store: EnterpriseDataStore,
  overrides: Partial<Parameters<typeof projectCapabilityCenterInstall>[0]> = {},
) {
  return projectCapabilityCenterInstall({
    store,
    tenantId,
    callerUserId: ownerId,
    skill: {
      skillId,
      lifecycle: "private",
      visibility: "private",
      dependencies: ["fixture.sar.draft-note.create"],
      maturityLabel: "企业认证",
    },
    pin: {
      skillId,
      installedVersion: "2026.10.17",
      artifactDigest: "digest-pinned",
      enabled: true,
    },
    skillAuthorized: true,
    validationRecords: [validation()],
    catalog: { version: "2026.10.18", artifactDigest: "digest-catalog" },
    linkedWriteEffects: [
      {
        capabilityId: "fixture.sar.draft-note.create",
        version: "2026.10.17",
        effect: "create",
      },
    ],
    ...overrides,
  });
}

describe("E3 capability center install", () => {
  it("refuses a skill that has no account binding", () => {
    const store = storeWithSite({ withAccount: false });
    const before = structuredClone(store.accountBindings ?? {});
    const facts = project(store);
    expect(store.accountBindings ?? {}).toEqual(before);
    expect(installLeavesAccountBindingsUntouched(store).createdAccountBinding).toBe(false);
    expect(facts.accountRequirement).toBe("待配置");
    expect(facts.bindingId).toBeNull();
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_BINDING_MISSING");
    expect(facts.websites.map((site) => site.displayName)).toEqual(["网站 A"]);
    expect(facts.effects).toEqual(["read", "create"]);
    expect(facts.entersKnowledgeProjection).toBe(false);
  });

  it("refuses an account that has no skill authorization", () => {
    const store = storeWithSite();
    const facts = project(store, { skillAuthorized: false, pin: null });
    expect(facts.accountRequirement).toBe("已绑定");
    expect(facts.bindingId).toBe("bind-owner");
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("POLICY_DENIED");
    expect(facts.denialMessage).toContain("撤销");
  });

  it("does not share a private account with an enterprise admin", () => {
    const store = storeWithSite();
    const facts = project(store, { callerUserId: adminId });
    expect(facts.accountRequirement).toBe("待配置");
    expect(facts.bindingId).toBeNull();
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_BINDING_PRIVATE");
    expect(JSON.stringify(facts)).not.toContain(ownerId);
  });

  it("keeps the pinned version when the catalog head moves", () => {
    const store = storeWithSite();
    const facts = project(store);
    expect(facts.executable).toBe(true);
    expect(facts.executionVersion).toBe("2026.10.17");
    expect(facts.executionDigest).toBe("digest-pinned");
    expect(facts.catalogVersion).toBe("2026.10.18");
    expect(facts.executionVersion).not.toBe(facts.catalogVersion);
    expect(facts.executionDigest).not.toBe("digest-catalog");
    expect(facts.reviewedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(facts.maturityLabel).toBe("企业认证");
  });

  it("does not let maturity or a bridge flag replace a validation record", () => {
    const store = storeWithSite();
    const facts = project(store, { validationRecords: [] });
    expect(facts.maturityLabel).toBe("企业认证");
    expect(facts.bridgeVerification).toBe("passed");
    expect(facts.verification).toBe("unknown");
    expect(facts.reviewedAt).toBeNull();
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
    expect(facts.denialMessage).toContain("成熟度");
  });

  it("blocks a new run when the skill is disabled and does not withdraw in-flight effects", () => {
    const store = storeWithSite();
    const facts = project(store, {
      pin: {
        skillId,
        installedVersion: "2026.10.17",
        artifactDigest: "digest-pinned",
        enabled: false,
      },
      inFlightRun: inFlight(),
    });
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("POLICY_DENIED");
    expect(facts.denialMessage).toContain("停用");
    expect(facts.inFlightSideEffectsWithdrawn).toBe(false);
    expect(facts.inFlight?.sideEffectsWithdrawn).toBe(false);
    expect(facts.inFlight?.priorWriteMayBeReplayed).toBe(false);
    expect(facts.inFlight?.status).toBe("unknown");
  });

  it("blocks a new run when the verified version no longer matches the pin", () => {
    const store = storeWithSite();
    store.sarExecutionBridges = {
      "bridge-1": bridge({
        version: "2026.10.18",
        artifactDigest: "digest-catalog",
        verification: "stale",
      }),
    };
    const facts = project(store);
    expect(facts.executable).toBe(false);
    expect(facts.denialCode).toBe("SAR_VERIFICATION_MISSING");
    expect(facts.executionVersion).toBe("2026.10.17");
    expect(facts.executionDigest).toBe("digest-pinned");
    expect(facts.inFlightSideEffectsWithdrawn).toBe(false);
  });

  it("does not treat a failed or unknown run as verified executable", () => {
    const store = storeWithSite();
    const failed = project(store, {
      validationRecords: [
        validation({
          verdict: "passed",
          promotable: false,
          runStatus: "failed",
          runVerification: "failed",
          independentReviewEvidence: {
            evidenceRef: "review-ev-failed",
            statement: "Separate ledger check, not the failed run.",
            artifactDigest: "digest-pinned",
          },
        }),
      ],
    });
    expect(failed.executable).toBe(false);
    expect(failed.verification).not.toBe("passed");
    expect(failed.denialCode).toBe("SAR_VERIFICATION_MISSING");

    const unknown = project(store, {
      validationRecords: [
        validation({
          verdict: "passed",
          promotable: false,
          runStatus: "unknown",
          runVerification: "not_performed",
        }),
      ],
    });
    expect(unknown.executable).toBe(false);
    expect(unknown.verification).not.toBe("passed");
    expect(unknown.denialCode).toBe("SAR_VERIFICATION_MISSING");
  });

  it("keeps private drafts and registry drafts out of the public catalog", () => {
    expect(includeInEnterprisePublicCatalog({ lifecycle: "draft", visibility: "private" })).toBe(
      false,
    );
    expect(includeInEnterprisePublicCatalog({ lifecycle: "draft", visibility: "enterprise" })).toBe(
      false,
    );
    expect(
      includeInEnterprisePublicCatalog({ lifecycle: "published", visibility: "private" }),
    ).toBe(false);
    expect(
      includeInEnterprisePublicCatalog({ lifecycle: "published", visibility: "enterprise" }),
    ).toBe(true);
    expect(hideRegistryDraftFromPublicCatalog("submitted")).toBe(true);
    expect(hideRegistryDraftFromPublicCatalog("draft")).toBe(true);
    expect(hideRegistryDraftFromPublicCatalog("published")).toBe(false);
  });
});
