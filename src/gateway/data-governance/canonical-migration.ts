import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import { MIGRATION_RECEIPT_KIND, type MigrationApplyItem } from "./migration-apply.js";
import { verifyMigrationBatch } from "./migration-verify.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export function digestWorkspaceArtifacts(
  root: string,
): Array<{ artifactId: string; checksum: string }> {
  const result: Array<{ artifactId: string; checksum: string }> = [];
  function walk(relative: string) {
    for (const entry of fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .toSorted((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("migration_symlink_refused");
      }
      if (entry.isDirectory()) {
        walk(rel);
      } else if (entry.isFile()) {
        result.push({
          artifactId: rel,
          checksum: `sha256:${createHash("sha256")
            .update(fs.readFileSync(path.join(root, rel)))
            .digest("hex")}`,
        });
      } else {
        throw new Error("migration_special_file_refused");
      }
    }
  }
  walk("");
  return result;
}
function digestSet(set: ReturnType<typeof digestWorkspaceArtifacts>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(set)).digest("hex")}`;
}

/** Trusted, explicit cutover command. Never invoked by ordinary reads/writes.
 * Source is retained; an exclusive destination and CAS prevent overwrite.
 */
export async function migrateCanonicalWorkspace(params: {
  tenantId: string;
  authorizedTenantId: string;
  resourceId: string;
  expectedGovernanceVersion: number;
  destination: string;
  authorizationIdentity: string;
  proof: GovernanceOwnershipProof;
  store: DataGovernanceCatalogStore;
  receiptDir: string;
}) {
  if (
    !params.tenantId ||
    params.tenantId !== params.authorizedTenantId ||
    !params.authorizationIdentity.trim()
  ) {
    throw new Error("migration_authorization_required");
  }
  const record = await params.store.get(params.resourceId);
  if (
    !record ||
    record.envelope.tenantId !== params.tenantId ||
    record.envelope.resourceType !== "workspace" ||
    record.envelope.lifecycleState !== "active" ||
    record.envelope.governanceVersion !== params.expectedGovernanceVersion ||
    JSON.stringify(record.envelope.owner) !== JSON.stringify(params.proof.owner)
  ) {
    throw new Error("migration_identity_or_version_mismatch");
  }
  const bindings = record.bindings.filter((b) => b.role === "canonical" && b.state === "active");
  if (bindings.length !== 1) {
    throw new Error("migration_canonical_ambiguous");
  }
  const from = bindings[0],
    source = fs.realpathSync(from.locator),
    target = path.resolve(params.destination);
  if (
    !path.isAbsolute(params.destination) ||
    target === source ||
    target.startsWith(source + path.sep) ||
    fs.existsSync(target)
  ) {
    throw new Error("migration_destination_invalid");
  }
  const artifactSet = digestWorkspaceArtifacts(source);
  if (!artifactSet.length) {
    throw new Error("migration_artifacts_empty");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  const checksum = digestSet(artifactSet);
  if (
    digestSet(digestWorkspaceArtifacts(target)) !== checksum ||
    digestSet(digestWorkspaceArtifacts(source)) !== checksum
  ) {
    throw new Error("migration_copy_checksum_mismatch");
  }
  const operationId = randomUUID(),
    toBindingId = `canonical:${operationId}`;
  const next = {
    envelope: {
      ...record.envelope,
      canonicalBindingId: toBindingId,
      governanceVersion: record.envelope.governanceVersion + 1,
      updatedAt: new Date().toISOString(),
    },
    bindings: [
      {
        ...from,
        bindingId: toBindingId,
        locator: fs.realpathSync(target),
        contentVersion: checksum,
      },
      ...record.bindings.map((b) =>
        b.bindingId === from.bindingId
          ? { ...b, role: "replica" as const, state: "read_only" as const }
          : b,
      ),
    ],
  };
  const change = {
    fromBindingId: from.bindingId,
    toBindingId,
    fromContentVersion: from.contentVersion,
    toContentVersion: checksum,
    fromDirectory: source,
    toDirectory: fs.realpathSync(target),
    authorizationIdentity: params.authorizationIdentity,
    operationIdentity: operationId,
    artifactSet,
  };
  const item: MigrationApplyItem = {
    candidateId: operationId,
    resourceId: params.resourceId,
    status: "migrated",
    receipt: {
      kind: MIGRATION_RECEIPT_KIND,
      receiptId: operationId,
      operationId,
      batchId: operationId,
      tenantId: params.tenantId,
      candidateId: operationId,
      resourceId: params.resourceId,
      resourceType: "workspace",
      status: "migrated",
      inventoryChecksum: checksum,
      planChecksum: checksum,
      contentChecksum: checksum,
      previousLocator: source,
      canonicalBindingId: toBindingId,
      observationLocator: source,
      changeSnapshot: change,
    },
  };
  // Persist evidence before cutover; CAS failure never activates the destination.
  fs.mkdirSync(params.receiptDir, { recursive: true });
  fs.writeFileSync(
    path.join(params.receiptDir, `${operationId}.prepared.json`),
    JSON.stringify({ ...item.receipt, status: "recovery_required", phase: "prepared" }),
    { flag: "wx" },
  );
  const cas = await params.store.compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next,
  });
  if (!cas.ok) {
    throw new Error("migration_cas_conflict");
  }
  fs.writeFileSync(
    path.join(params.receiptDir, `${operationId}.apply.json`),
    JSON.stringify(item.receipt),
    { flag: "wx" },
  );
  return verifyMigrationBatch({
    callerTenantId: params.tenantId,
    authorizedTenantId: params.authorizedTenantId,
    batchId: operationId,
    store: params.store,
    items: [item],
    proofs: { [operationId]: params.proof },
    physical: {
      read: async ({ locator }) => ({ checksum: digestSet(digestWorkspaceArtifacts(locator)) }),
    },
    receiptDir: params.receiptDir,
  });
}
