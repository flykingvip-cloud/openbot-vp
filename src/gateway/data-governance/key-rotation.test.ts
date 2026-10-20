import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { PROMOTION_KEY_HMAC_KEY_ENV } from "./cognitive-promotion-key.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as dataGovernanceBarrel from "./index.js";
import {
  resolveTenantKeyManagementAuth,
  writeTenantKeyManagementPolicyAtDeployBoundary,
  type TenantKeyManagementAuth,
} from "./key-rotation-auth.js";
import {
  assertSingleWritableCanonical,
  bootstrapTenantKeyService,
  commitActiveKeyGeneration,
  decryptCoveredObject,
  encryptCanonicalWrite,
  generateNextKeyGeneration,
  loadTenantKeyService,
  reactivateRetiredKey,
  readableKeyGenerations,
  reclaimOrphanWraps,
  refuseMtimeAsTruth,
  retireKeyGeneration,
  rewriteCiphertextForAlgorithmRetirement,
  rewrapCoveredObjects,
  selectWriteKeyGeneration,
} from "./key-rotation.js";
import { resolveDataGovernanceCatalogPath, resolveKeyRotationRoot } from "./paths.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type StorageBinding } from "./types.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: resolveAuthoritativeMembershipMock,
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const TENANT = "tenant-p5b";
const OTHER_TENANT = "tenant-p5b-other";
const MEMBER = "user-p5b";
const ADMIN = "user-p5b-admin";
const OWNER_B = "user-p5b-owner-b";
const OTHER_ADMIN = "user-p5b-other-admin";
const RESOURCE = "res-p5b-1";
const PLAINTEXT = Buffer.from("p5-b-canonical-body", "utf8");
const previousKey = process.env[PROMOTION_KEY_HMAC_KEY_ENV];
const here = path.dirname(fileURLToPath(import.meta.url));

let stateDir = "";
let call: GovernanceAuthenticatedCall;
let adminCall: GovernanceAuthenticatedCall;
let ownerBCall: GovernanceAuthenticatedCall;
let otherCall: GovernanceAuthenticatedCall;
let auth: TenantKeyManagementAuth;
let otherAuth: TenantKeyManagementAuth;

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p5b-key-rotation-"));
}

function binding(role: StorageBinding["role"], state: StorageBinding["state"]): StorageBinding {
  return {
    bindingId: `bind-${role}-${state}`,
    resourceId: RESOURCE,
    role,
    storageKind: "object-store",
    locator: `loc-${role}`,
    state,
    contentVersion: "1",
  };
}

async function authCall(tenantId: string, userId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId,
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${userId}@${tenantId}.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

function seedPolicy(tenantId: string, userId: string): void {
  writeTenantKeyManagementPolicyAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId,
      operators: [{ userId, role: "tenant-admin" }],
    },
  });
}

function resolveAuth(callToResolve: GovernanceAuthenticatedCall): TenantKeyManagementAuth {
  const resolved = resolveTenantKeyManagementAuth({ call: callToResolve, stateDir });
  if (!resolved.ok) {
    throw new Error("expected TenantKeyManagementAuth");
  }
  return resolved.auth;
}

async function seedOwnedCatalog(resourceId: string, ownerUserId = MEMBER, tenantId = TENANT) {
  const store = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  await store.put({
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId,
      owner: { kind: "user", userId: ownerUserId },
      scope: { kind: "tenant", tenantId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `loc-${resourceId}`,
        state: "active",
        contentVersion: "1",
      },
    ],
  });
}

beforeEach(async () => {
  stateDir = tmpStateDir();
  process.env[PROMOTION_KEY_HMAC_KEY_ENV] = "p5b-test-hmac-secret";
  call = await authCall(TENANT, MEMBER);
  adminCall = await authCall(TENANT, ADMIN);
  ownerBCall = await authCall(TENANT, OWNER_B);
  otherCall = await authCall(OTHER_TENANT, OTHER_ADMIN);
  seedPolicy(TENANT, ADMIN);
  seedPolicy(OTHER_TENANT, OTHER_ADMIN);
  auth = resolveAuth(adminCall);
  otherAuth = resolveAuth(otherCall);
});

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env[PROMOTION_KEY_HMAC_KEY_ENV];
  } else {
    process.env[PROMOTION_KEY_HMAC_KEY_ENV] = previousKey;
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("P5-b key rotation", () => {
  it("rewrapping then CAS keeps resourceId and makes G ciphertext readable under G+1", async () => {
    await seedOwnedCatalog(RESOURCE);
    await seedOwnedCatalog("res-p5b-write-before-cas");
    await seedOwnedCatalog("res-p5b-write-after-cas");
    expect(bootstrapTenantKeyService({ auth, stateDir }).ok).toBe(true);
    const written = encryptCanonicalWrite({
      call,
      stateDir,
      resourceId: RESOURCE,
      plaintext: PLAINTEXT,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) {
      return;
    }
    expect(written.value.resourceId).toBe(RESOURCE);
    expect(written.value.wraps["1"]).toBeDefined();

    const generated = generateNextKeyGeneration({ auth, stateDir });
    expect(generated.ok && generated.value.generation.state).toBe("prepared");
    expect(generated.ok && generated.value.receipt.kind).toBe("p5_key_rotation_receipt");
    expect(generated.ok && generated.value.receipt.state).toBe("prepared");

    const rewrapped = rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 });
    expect(rewrapped.ok).toBe(true);
    if (!rewrapped.ok) {
      return;
    }
    expect(rewrapped.value[0]?.resourceId).toBe(RESOURCE);
    expect(rewrapped.value[0]?.contentChecksum).toBeDefined();

    const beforeCommit = encryptCanonicalWrite({
      call,
      stateDir,
      resourceId: "res-p5b-write-before-cas",
      plaintext: Buffer.from("still-g1", "utf8"),
    });
    expect(beforeCommit.ok && beforeCommit.value.wraps["1"]).toBeDefined();
    expect(beforeCommit.ok && beforeCommit.value.wraps["2"]).toBeUndefined();
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 })).toEqual({
      ok: false,
      error: "rewrap_incomplete",
    });
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);

    const committed = commitActiveKeyGeneration({
      auth,
      stateDir,
      toGeneration: 2,
    });
    expect(committed.ok && committed.value.state).toBe("applied");
    const service = loadTenantKeyService({ auth, stateDir });
    expect(service?.activeKeyGeneration).toBe(2);
    expect(selectWriteKeyGeneration(service!).ok && service?.activeKeyGeneration).toBe(2);
    expect(readableKeyGenerations(service!)).toEqual([1, 2]);

    const afterCommit = encryptCanonicalWrite({
      call,
      stateDir,
      resourceId: "res-p5b-write-after-cas",
      plaintext: Buffer.from("now-g2", "utf8"),
    });
    expect(afterCommit.ok && afterCommit.value.wraps["2"]).toBeDefined();
    expect(afterCommit.ok && afterCommit.value.wraps["1"]).toBeUndefined();

    const decrypted = decryptCoveredObject({
      call,
      stateDir,
      resourceId: RESOURCE,
    });
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) {
      return;
    }
    expect(decrypted.value.resourceId).toBe(RESOURCE);
    expect(decrypted.value.plaintext.equals(PLAINTEXT)).toBe(true);
    expect(decrypted.value.usedGeneration).toBe(2);
  });

  it("failure before pointer CAS leaves G active and orphan G+1 wraps reclaimable", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);

    const service = loadTenantKeyService({ auth, stateDir });
    expect(service?.activeKeyGeneration).toBe(1);
    expect(service?.generations["2"]?.state).toBe("prepared");
    expect(service?.objects[RESOURCE]?.wraps["2"]).toBeDefined();

    const retry = generateNextKeyGeneration({ auth, stateDir });
    expect(retry.ok && retry.value.generation.generation).toBe(2);
    expect(retry.ok && retry.value.receipt.state).toBe("prepared");

    const reclaimed = reclaimOrphanWraps({ auth, stateDir });
    expect(reclaimed.ok && reclaimed.value).toBe(1);
    const after = loadTenantKeyService({ auth, stateDir });
    expect(after?.activeKeyGeneration).toBe(1);
    expect(after?.objects[RESOURCE]?.wraps["2"]).toBeUndefined();
    expect(decryptCoveredObject({ call, stateDir, resourceId: RESOURCE }).ok).toBe(true);
  });

  it("refuses commit when rewrap receipts are missing", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 })).toEqual({
      ok: false,
      error: "rewrap_incomplete",
    });
    expect(loadTenantKeyService({ auth, stateDir })?.activeKeyGeneration).toBe(1);
  });

  it("refuses retire while a prepared rotation receipt is open", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(
      retireKeyGeneration({
        auth,
        stateDir,
        generation: 1,
        now: "2026-08-17T12:00:00.000Z",
        retireNotBefore: "2026-08-17T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "prepared_rotation_open" });
  });

  it("enforces retire TTL and forbids silent re-activate", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);

    expect(
      retireKeyGeneration({
        auth,
        stateDir,
        generation: 1,
        now: "2026-08-17T00:00:00.000Z",
        retireNotBefore: "2026-08-17T12:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "retire_ttl_not_elapsed" });

    const retired = retireKeyGeneration({
      auth,
      stateDir,
      generation: 1,
      now: "2026-08-17T12:00:00.000Z",
      retireNotBefore: "2026-08-17T00:00:00.000Z",
    });
    expect(retired.ok && retired.value.kind).toBe("p5_key_retire_receipt");
    expect(loadTenantKeyService({ auth, stateDir })?.generations["1"]?.state).toBe("retired");
    expect(loadTenantKeyService({ auth, stateDir })?.objects[RESOURCE]?.wraps["1"]).toBeUndefined();
    expect(reactivateRetiredKey({ auth, stateDir, generation: 1 })).toEqual({
      ok: false,
      error: "retired_key_reactivate_forbidden",
    });

    const decrypted = decryptCoveredObject({
      call,
      stateDir,
      resourceId: RESOURCE,
    });
    expect(decrypted.ok && decrypted.value.plaintext.equals(PLAINTEXT)).toBe(true);
  });

  it("rewrites ciphertext only when the algorithm is retired, keeping resourceId", async () => {
    await seedOwnedCatalog(RESOURCE);
    const legacy = encryptCanonicalWrite({
      call,
      stateDir,
      resourceId: RESOURCE,
      plaintext: PLAINTEXT,
      algorithm: "aes-256-gcm-legacy",
    });
    expect(legacy.ok).toBe(true);
    const rewritten = rewriteCiphertextForAlgorithmRetirement({
      call,
      stateDir,
      resourceId: RESOURCE,
    });
    expect(rewritten.ok && rewritten.value.resourceId).toBe(RESOURCE);
    expect(rewritten.ok && rewritten.value.algorithm).toBe("aes-256-gcm");
    expect(
      rewriteCiphertextForAlgorithmRetirement({
        call,
        stateDir,
        resourceId: RESOURCE,
      }),
    ).toEqual({ ok: false, error: "algorithm_rewrite_not_required" });
    const decrypted = decryptCoveredObject({
      call,
      stateDir,
      resourceId: RESOURCE,
    });
    expect(decrypted.ok && decrypted.value.plaintext.equals(PLAINTEXT)).toBe(true);
  });

  it("fail-closes dual active write generations and dual writable canonicals", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(assertSingleWritableCanonical([binding("canonical", "active")])).toEqual({
      ok: true,
      value: true,
    });
    expect(
      assertSingleWritableCanonical([
        binding("canonical", "active"),
        { ...binding("canonical", "active"), bindingId: "bind-dup", locator: "loc-dup" },
      ]),
    ).toEqual({ ok: false, error: "catalog_corrupt" });

    fs.mkdirSync(path.join(resolveKeyRotationRoot(stateDir), TENANT), { recursive: true });
    fs.writeFileSync(
      path.join(resolveKeyRotationRoot(stateDir), TENANT, "key-service.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          revision: 1,
          tenantId: TENANT,
          activeKeyGeneration: 1,
          generations: {
            "1": {
              generation: 1,
              state: "active",
              wrapKeyId: "wrap:platform_tenant:tenant-p5b:g1",
            },
            "2": {
              generation: 2,
              state: "active",
              wrapKeyId: "wrap:platform_tenant:tenant-p5b:g2",
            },
          },
          rotationReceipts: {},
          rewrapReceipts: {},
          retireReceipts: {},
          objects: {},
        },
        null,
        2,
      )}\n`,
    );
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }),
    ).toEqual({ ok: false, error: "key_generation_corrupt" });
  });

  it("does not treat mtime as rotation truth", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    const storePath = path.join(resolveKeyRotationRoot(stateDir), TENANT, "key-service.json");
    const past = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(storePath, past, past);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    const decrypted = decryptCoveredObject({
      call,
      stateDir,
      resourceId: RESOURCE,
    });
    expect(decrypted.ok && decrypted.value.plaintext.equals(PLAINTEXT)).toBe(true);
    expect(refuseMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("keeps rotation source free of promotion forks and mtime truth", () => {
    const source = fs.readFileSync(path.join(here, "key-rotation.ts"), "utf8");
    for (const token of [
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "mtime:",
      "placement_export",
      "p5_integrity_scan_receipt",
    ]) {
      expect(source.includes(token), token).toBe(false);
    }
    expect(source).toContain("export type KeyRotationAuthParams");
    expect(source).toContain("export type KeyManagementCommandParams");
    expect(source).toContain("call: GovernanceAuthenticatedCall");
    expect(source).toContain("auth: TenantKeyManagementAuth");
    expect(source).toContain("tenantId?: never");
    expect(source).toContain('error: "catalog_not_found"');
    for (const name of ["decryptCoveredObject", "encryptCanonicalWrite"]) {
      const start = source.indexOf(`export function ${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = source.indexOf("export function", start + 1);
      const block = source.slice(start, next === -1 ? undefined : next);
      expect(block, name).toContain("KeyRotationAuthParams");
      expect(block, name).not.toMatch(/tenantId:\s*string/);
    }
    for (const name of [
      "bootstrapTenantKeyService",
      "generateNextKeyGeneration",
      "rewrapCoveredObjects",
      "commitActiveKeyGeneration",
      "retireKeyGeneration",
    ]) {
      const start = source.indexOf(`export function ${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = source.indexOf("export function", start + 1);
      const block = source.slice(start, next === -1 ? undefined : next);
      expect(block, name).toContain("KeyManagementCommandParams");
      expect(block, name).not.toMatch(/tenantId:\s*string/);
    }
  });

  it("does not export store internals or raw-tenant APIs from the barrel", () => {
    expect(dataGovernanceBarrel).not.toHaveProperty("mutateTenantKeyService");
    expect(dataGovernanceBarrel).not.toHaveProperty("readTenantKeyService");
    expect(dataGovernanceBarrel).not.toHaveProperty("loadTenantKeyService");
    expect(dataGovernanceBarrel).not.toHaveProperty("wrapKeyIdForGeneration");
    expect(dataGovernanceBarrel).not.toHaveProperty(
      "writeTenantKeyManagementPolicyAtDeployBoundary",
    );
    expect(dataGovernanceBarrel).not.toHaveProperty("getPlacementExportReceipt");
    expect(dataGovernanceBarrel).toHaveProperty("commitActiveKeyGeneration");
    expect(dataGovernanceBarrel).toHaveProperty("rewrapCoveredObjects");
    expect(dataGovernanceBarrel).toHaveProperty("decryptCoveredObject");
    expect(dataGovernanceBarrel).toHaveProperty("resolveTenantKeyManagementAuth");
  });
});

describe("P5-b key rotation authorization", () => {
  it("refuses bootstrap and rotate without branded key-management auth", () => {
    expect(
      bootstrapTenantKeyService({
        auth: { callerTenantId: TENANT, actor: { kind: "user", userId: ADMIN } } as never,
        stateDir,
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      generateNextKeyGeneration({
        auth: { callerTenantId: TENANT, actor: { kind: "user", userId: ADMIN } } as never,
        stateDir,
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      resolveTenantKeyManagementAuth({
        call: { callerTenantId: TENANT, actor: { kind: "user", userId: ADMIN } } as never,
        stateDir,
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
  });

  it("refuses a wire tenantId that does not match the authenticated tenant", () => {
    expect(
      generateNextKeyGeneration({
        auth,
        stateDir,
        tenantId: OTHER_TENANT,
      } as never),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      decryptCoveredObject({
        call,
        stateDir,
        tenantId: OTHER_TENANT,
        resourceId: RESOURCE,
      } as never),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
  });

  it("refuses an ordinary tenant member generate / rewrap / commit / retire", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    const before = loadTenantKeyService({ auth, stateDir });
    expect(before?.activeKeyGeneration).toBe(1);
    expect(before?.generations["2"]?.state).toBe("prepared");

    const memberAuth = resolveTenantKeyManagementAuth({ call, stateDir });
    expect(memberAuth).toEqual({ ok: false, error: "actor_not_authorized" });
    const forgedMember = {
      auth: call as never,
      stateDir,
    };
    expect(generateNextKeyGeneration(forgedMember)).toEqual({
      ok: false,
      error: "actor_not_authorized",
    });
    expect(rewrapCoveredObjects({ ...forgedMember, toGeneration: 2 })).toEqual({
      ok: false,
      error: "actor_not_authorized",
    });
    expect(commitActiveKeyGeneration({ ...forgedMember, toGeneration: 2 })).toEqual({
      ok: false,
      error: "actor_not_authorized",
    });
    expect(
      retireKeyGeneration({
        ...forgedMember,
        generation: 1,
        now: "2026-08-17T12:00:00.000Z",
        retireNotBefore: "2026-08-17T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });

    const after = loadTenantKeyService({ auth, stateDir });
    expect(after?.activeKeyGeneration).toBe(1);
    expect(after?.generations["2"]?.state).toBe("prepared");
    expect(after?.objects[RESOURCE]?.wraps["1"]).toBeDefined();
    expect(after?.objects[RESOURCE]?.wraps["2"]).toBeDefined();
  });

  it("lets a tenant admin complete generate / rewrap / commit / retire", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(
      retireKeyGeneration({
        auth,
        stateDir,
        generation: 1,
        now: "2026-08-17T12:00:00.000Z",
        retireNotBefore: "2026-08-17T00:00:00.000Z",
      }).ok,
    ).toBe(true);
    expect(loadTenantKeyService({ auth, stateDir })?.activeKeyGeneration).toBe(2);
  });

  it("lets a platform key-service operator generate a rotation", async () => {
    writeTenantKeyManagementPolicyAtDeployBoundary({
      stateDir,
      record: {
        schemaVersion: 1,
        tenantId: TENANT,
        operators: [{ userId: "user-p5b-platform", role: "platform-admin" }],
      },
    });
    const platformAuth = resolveAuth(await authCall(TENANT, "user-p5b-platform"));
    expect(generateNextKeyGeneration({ auth: platformAuth, stateDir }).ok).toBe(true);
  });

  it("refuses decrypt and encrypt when Catalog is missing", () => {
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }),
    ).toEqual({ ok: false, error: "catalog_not_found" });
    fs.mkdirSync(path.join(resolveKeyRotationRoot(stateDir), TENANT), { recursive: true });
    fs.writeFileSync(
      path.join(resolveKeyRotationRoot(stateDir), TENANT, "key-service.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          revision: 1,
          tenantId: TENANT,
          activeKeyGeneration: 1,
          generations: {
            "1": {
              generation: 1,
              state: "active",
              wrapKeyId: "wrap:platform_tenant:tenant-p5b:g1",
            },
          },
          rotationReceipts: {},
          rewrapReceipts: {},
          retireReceipts: {},
          objects: {
            [RESOURCE]: {
              resourceId: RESOURCE,
              tenantId: TENANT,
              algorithm: "aes-256-gcm",
              contentIv: "AA",
              contentTag: "AA",
              contentCiphertext: "AA",
              wraps: {},
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    expect(decryptCoveredObject({ call, stateDir, resourceId: RESOURCE })).toEqual({
      ok: false,
      error: "catalog_not_found",
    });
    expect(
      rewriteCiphertextForAlgorithmRetirement({ call, stateDir, resourceId: RESOURCE }),
    ).toEqual({ ok: false, error: "catalog_not_found" });
  });

  it("refuses same-tenant user-a decrypt of a user-b-owned resource", async () => {
    await seedOwnedCatalog(RESOURCE, OWNER_B);
    expect(
      encryptCanonicalWrite({
        call: ownerBCall,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(decryptCoveredObject({ call, stateDir, resourceId: RESOURCE })).toEqual({
      ok: false,
      error: "ownership_mismatch",
    });
    expect(decryptCoveredObject({ call: ownerBCall, stateDir, resourceId: RESOURCE }).ok).toBe(
      true,
    );
  });

  it("refuses tenant-b decrypt of a tenant-a resource", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(bootstrapTenantKeyService({ auth: otherAuth, stateDir }).ok).toBe(true);
    expect(
      decryptCoveredObject({
        call: otherCall,
        stateDir,
        resourceId: RESOURCE,
      }),
    ).toEqual({ ok: false, error: "envelope_tenant_mismatch" });
  });

  it("refuses cross-tenant rotate, rewrap, commit, and retire", async () => {
    await seedOwnedCatalog(RESOURCE);
    expect(
      encryptCanonicalWrite({
        call,
        stateDir,
        resourceId: RESOURCE,
        plaintext: PLAINTEXT,
      }).ok,
    ).toBe(true);
    expect(generateNextKeyGeneration({ auth, stateDir }).ok).toBe(true);
    expect(rewrapCoveredObjects({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);

    expect(rewrapCoveredObjects({ auth: otherAuth, stateDir, toGeneration: 2 })).toEqual({
      ok: false,
      error: "rotation_not_prepared",
    });
    expect(commitActiveKeyGeneration({ auth: otherAuth, stateDir, toGeneration: 2 })).toEqual({
      ok: false,
      error: "rotation_not_prepared",
    });
    expect(
      retireKeyGeneration({
        auth: otherAuth,
        stateDir,
        generation: 1,
        now: "2026-08-17T12:00:00.000Z",
        retireNotBefore: "2026-08-17T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "retired_key_cannot_wrap" });

    expect(generateNextKeyGeneration({ auth: otherAuth, stateDir }).ok).toBe(true);
    expect(loadTenantKeyService({ auth, stateDir })?.activeKeyGeneration).toBe(1);
    expect(commitActiveKeyGeneration({ auth, stateDir, toGeneration: 2 }).ok).toBe(true);
    expect(loadTenantKeyService({ auth: otherAuth, stateDir })?.activeKeyGeneration).toBe(1);
  });
});
