import type { EvolutionVerifierRecord, ExternalEffectVerifier } from "@openbot/evolution-core";
import { classifyGrantActivity, isCodeIdentityCredentialRef } from "@openbot/evolution-core";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { createDurableMap } from "./persistent-store.js";
import { FIXED_BUILTIN_VERIFIER_CATALOG, isCatalogBuiltinRecord } from "./verifiers/catalog.js";

export type VerifierRegistry = {
  get(verifierId: string): EvolutionVerifierRecord | undefined;
  list(): EvolutionVerifierRecord[];
  resolve(verifierId: string): ExternalEffectVerifier | undefined;
};

export type CompositionRootVerifierHandle = {
  registry: VerifierRegistry;
  installFixedBuiltin(
    record: EvolutionVerifierRecord,
    implementation: ExternalEffectVerifier,
  ): EvolutionVerifierRecord;
  revokeFixedBuiltin(
    verifierId: string,
    inspector: EvolutionAuthorizationInspector,
    grantId: string,
  ): EvolutionVerifierRecord;
};

function assertPlatformInspector(
  inspector: EvolutionAuthorizationInspector,
  grantId: string,
  action: "register" | "revoke",
): void {
  const grant = inspector.inspect(grantId);
  if (grant.status === "missing" || !("grantId" in grant)) {
    throw new Error(
      action === "register"
        ? "caller cannot self-register a verifier"
        : "caller cannot revoke a verifier",
    );
  }
  const activity = classifyGrantActivity(grant);
  if (!activity.active) {
    throw new Error(
      action === "register"
        ? `caller cannot self-register a verifier: ${activity.code}`
        : `caller cannot revoke a verifier: ${activity.code}`,
    );
  }
  if (grant.confidentialityCeiling !== "platform" || !grant.allowedActions.includes("platform")) {
    throw new Error(
      action === "register"
        ? "caller cannot self-register a verifier"
        : "caller cannot revoke a verifier",
    );
  }
}

function sameBuiltinIdentity(
  existing: EvolutionVerifierRecord,
  next: EvolutionVerifierRecord,
): boolean {
  return (
    existing.verifierId === next.verifierId &&
    existing.verifierKind === next.verifierKind &&
    existing.credentialRef === next.credentialRef &&
    existing.trustedBy === next.trustedBy
  );
}

function loadTrustedPersistedRecords(
  persistPath?: string,
): ReturnType<typeof createDurableMap<EvolutionVerifierRecord>> {
  const rows = createDurableMap<EvolutionVerifierRecord>(persistPath);
  for (const [verifierId, record] of rows.entries()) {
    const catalog = FIXED_BUILTIN_VERIFIER_CATALOG.find(
      (row) => row.record.verifierId === verifierId,
    );
    if (!catalog || !sameBuiltinIdentity(record, catalog.record)) {
      rows.delete(verifierId);
    }
  }
  return rows;
}

function createRegistryState(persistPath?: string): {
  rows: ReturnType<typeof createDurableMap<EvolutionVerifierRecord>>;
  implementations: Map<string, ExternalEffectVerifier>;
  registry: VerifierRegistry;
} {
  const rows = loadTrustedPersistedRecords(persistPath);
  const implementations = new Map<string, ExternalEffectVerifier>();
  const registry: VerifierRegistry = {
    get(verifierId) {
      const record = rows.get(verifierId);
      if (!record || !isCatalogBuiltinRecord(record)) {
        return undefined;
      }
      return record;
    },
    list() {
      return [...rows.values()].filter((record) => isCatalogBuiltinRecord(record));
    },
    resolve(verifierId) {
      const record = registry.get(verifierId);
      if (!record || record.status !== "active") {
        return undefined;
      }
      const implementation = implementations.get(verifierId);
      if (!implementation) {
        return undefined;
      }
      if (
        implementation.verifierId !== record.verifierId ||
        implementation.verifierKind !== record.verifierKind
      ) {
        return undefined;
      }
      return implementation;
    },
  };
  return { rows, implementations, registry };
}

export function createVerifierRegistry(persistPath?: string): VerifierRegistry {
  return createRegistryState(persistPath).registry;
}

/**
 * Composition-root handle. The install method is not an authority DTO and is
 * not attached to the public registry passed into the control plane.
 */
export function createCompositionRootVerifierHandle(
  persistPath?: string,
): CompositionRootVerifierHandle {
  const { rows, implementations, registry } = createRegistryState(persistPath);
  return {
    registry,
    installFixedBuiltin(record, implementation) {
      if (!isCatalogBuiltinRecord(record)) {
        throw new Error("only code-fixed builtin verifiers may be installed");
      }
      if (
        implementation.verifierId !== record.verifierId ||
        implementation.verifierKind !== record.verifierKind
      ) {
        throw new Error("builtin verifier implementation identity does not match the catalog");
      }
      if (record.trustedBy !== "code-identity") {
        throw new Error("builtin verifier is trusted by code identity only");
      }
      if (!isCodeIdentityCredentialRef(record.credentialRef, record.verifierId)) {
        throw new Error("builtin verifier is trusted by code identity only");
      }
      if ("token" in record || "secret" in record || "plaintextToken" in record) {
        throw new Error("plaintext verifier tokens are not accepted");
      }
      const existing = rows.get(record.verifierId);
      if (existing && !sameBuiltinIdentity(existing, record)) {
        throw new Error("fixed builtin verifier record cannot be replaced");
      }
      const stored: EvolutionVerifierRecord = {
        ...record,
        status: existing?.status === "revoked" ? "revoked" : "active",
        trustedBy: "code-identity",
        credentialRef: record.credentialRef,
        authorityGrantRef: record.credentialRef,
      };
      rows.set(stored.verifierId, stored);
      implementations.set(stored.verifierId, implementation);
      return stored;
    },
    revokeFixedBuiltin(verifierId, inspector, grantId) {
      assertPlatformInspector(inspector, grantId, "revoke");
      const existing = rows.get(verifierId);
      if (!existing) {
        throw new Error(`verifier not found: ${verifierId}`);
      }
      const next = { ...existing, status: "revoked" as const };
      rows.set(verifierId, next);
      implementations.delete(verifierId);
      return next;
    },
  };
}

export function assertVerifierMaySubmit(input: {
  verifier: EvolutionVerifierRecord | undefined;
  now: string;
  adapterId: string;
  tenantScope: string | null;
  effectKind: string;
  targetDomain: string;
}): { ok: true; verifier: EvolutionVerifierRecord } | { ok: false; code: string; reason: string } {
  if (!input.verifier) {
    return {
      ok: false,
      code: "verifier_missing",
      reason: "external verification registry is empty",
    };
  }
  if (!isCatalogBuiltinRecord(input.verifier)) {
    return {
      ok: false,
      code: "verifier_untrusted",
      reason: "verifier is not in the code-fixed builtin catalog",
    };
  }
  if (input.verifier.status === "revoked") {
    return {
      ok: false,
      code: "verifier_revoked",
      reason: "revoked verifier cannot submit a result",
    };
  }
  if (input.verifier.status !== "active") {
    return {
      ok: false,
      code: "verifier_suspended",
      reason: "suspended verifier cannot submit a result",
    };
  }
  if (Date.parse(input.verifier.expiresAt) <= Date.parse(input.now)) {
    return {
      ok: false,
      code: "verifier_expired",
      reason: "expired verifier cannot submit a result",
    };
  }
  if (
    input.verifier.tenantScope != null &&
    input.tenantScope != null &&
    input.verifier.tenantScope !== input.tenantScope
  ) {
    return { ok: false, code: "tenant_mismatch", reason: "verifier tenant scope exceeded" };
  }
  if (!input.verifier.supportedTargetDomains.includes(input.targetDomain)) {
    return {
      ok: false,
      code: "target_mismatch",
      reason: "verifier does not support this target domain",
    };
  }
  if (!input.verifier.supportedEffectKinds.includes(input.effectKind)) {
    return {
      ok: false,
      code: "effect_kind_mismatch",
      reason: "verifier does not support this effect kind",
    };
  }
  if (
    input.verifier.verifierId === input.adapterId ||
    input.verifier.verifierKind === input.adapterId ||
    !input.verifier.independentFromAdapterIds.includes(input.adapterId)
  ) {
    return {
      ok: false,
      code: "verifier_not_independent",
      reason: "applicator and verifier cannot be the same component",
    };
  }
  if (
    input.verifier.trustedBy !== "code-identity" ||
    !isCodeIdentityCredentialRef(input.verifier.credentialRef, input.verifier.verifierId)
  ) {
    return {
      ok: false,
      code: "credential_unresolved",
      reason: "unresolved verifier credentials cannot produce a result",
    };
  }
  return { ok: true, verifier: input.verifier };
}
