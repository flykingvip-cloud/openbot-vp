import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digestWorkspaceArtifacts, migrateCanonicalWorkspace } from "./canonical-migration.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

function signingKey(root: string): Buffer {
  const keyPath = path.join(root, "signing.key");
  try {
    fs.writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      throw e;
    }
  }
  return fs.readFileSync(keyPath);
}
function sign(plan: unknown, root: string): string {
  return createHmac("sha256", signingKey(root)).update(JSON.stringify(plan)).digest("hex");
}
type Plan = {
  id: string;
  tenantId: string;
  adminId: string;
  resourceId: string;
  governanceVersion: number;
  bindingId: string;
  contentVersion: string;
  source: string;
  target: string;
  expiresAt: number;
  artifactCount: number;
  byteLength: number;
  proof: GovernanceOwnershipProof;
};
/** prepare writes metadata only. Placement is server-owned tenant root, never a wire path. */
export async function prepareCanonicalMigration(params: {
  tenantId: string;
  adminId: string;
  resourceId: string;
  store: DataGovernanceCatalogStore;
  tenantRoot: string;
  planRoot: string;
  nowMs?: number;
}) {
  const r = await params.store.get(params.resourceId);
  const bs = r?.bindings.filter((b) => b.role === "canonical" && b.state === "active") ?? [];
  if (
    !params.tenantId ||
    !params.adminId ||
    !r ||
    r.envelope.tenantId !== params.tenantId ||
    r.envelope.lifecycleState !== "active" ||
    bs.length !== 1 ||
    r.envelope.resourceType !== "workspace"
  ) {
    throw new Error("migration_plan_identity_invalid");
  }
  const b = bs[0],
    source = fs.realpathSync(b.locator);
  if (!fs.statSync(source).isDirectory()) {
    throw new Error("migration_source_invalid");
  }
  const id = randomUUID(),
    root = fs.realpathSync(params.tenantRoot);
  const target = path.join(
    root,
    "workspaces",
    createHash("sha256").update(params.resourceId).digest("hex"),
    id,
  );
  const p: Plan = {
    id,
    tenantId: params.tenantId,
    adminId: params.adminId,
    resourceId: params.resourceId,
    governanceVersion: r.envelope.governanceVersion,
    bindingId: b.bindingId,
    contentVersion: b.contentVersion,
    source,
    target,
    expiresAt: (params.nowMs ?? Date.now()) + 15 * 60_000,
    artifactCount: digestWorkspaceArtifacts(source).length,
    byteLength: digestWorkspaceArtifacts(source).reduce(
      (sum, item) => sum + fs.statSync(path.join(source, item.artifactId)).size,
      0,
    ),
    proof: { owner: r.envelope.owner, scope: r.envelope.scope },
  };
  fs.mkdirSync(params.planRoot, { recursive: true });
  fs.writeFileSync(
    path.join(params.planRoot, `${id}.json`),
    JSON.stringify({ plan: p, signature: sign(p, params.planRoot) }),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return p;
}
export async function confirmCanonicalMigration(params: {
  tenantId: string;
  adminId: string;
  planId: string;
  store: DataGovernanceCatalogStore;
  tenantRoot: string;
  planRoot: string;
  receiptDir: string;
  nowMs?: number;
}) {
  if (!/^[a-f0-9-]{36}$/.test(params.planId)) {
    throw new Error("migration_plan_invalid");
  }
  const file = path.join(params.planRoot, `${params.planId}.json`);
  const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { plan: Plan; signature: string };
  const p = saved.plan;
  if (saved.signature !== sign(p, params.planRoot)) {
    throw new Error("migration_plan_signature_invalid");
  }
  if (
    p.id !== params.planId ||
    p.tenantId !== params.tenantId ||
    p.adminId !== params.adminId ||
    p.expiresAt <= (params.nowMs ?? Date.now())
  ) {
    throw new Error("migration_plan_authorization_or_expiry");
  }
  const r = await params.store.get(p.resourceId),
    b = r?.bindings.find((b) => b.role === "canonical" && b.state === "active");
  if (
    !r ||
    r.envelope.tenantId !== p.tenantId ||
    r.envelope.governanceVersion !== p.governanceVersion ||
    b?.bindingId !== p.bindingId ||
    b.contentVersion !== p.contentVersion ||
    fs.realpathSync(b.locator) !== p.source
  ) {
    throw new Error("migration_plan_stale");
  }
  const root = fs.realpathSync(params.tenantRoot),
    expected = path.join(
      root,
      "workspaces",
      createHash("sha256").update(p.resourceId).digest("hex"),
      p.id,
    );
  if (p.target !== expected) {
    throw new Error("migration_plan_placement_invalid");
  }
  // Parent creation is confined to a server-owned root and rejects symlink redirects.
  const parent = path.dirname(expected);
  let ancestor = parent;
  while (!fs.existsSync(ancestor)) {
    ancestor = path.dirname(ancestor);
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== root && !realAncestor.startsWith(root + path.sep)) {
    throw new Error("migration_plan_placement_escape");
  }
  fs.mkdirSync(parent, { recursive: true });
  if (!fs.realpathSync(parent).startsWith(root + path.sep)) {
    throw new Error("migration_plan_placement_escape");
  }
  fs.writeFileSync(
    file + ".confirmed",
    JSON.stringify({ adminId: params.adminId, at: params.nowMs ?? Date.now() }),
    { flag: "wx", mode: 0o600 },
  );
  return migrateCanonicalWorkspace({
    tenantId: p.tenantId,
    authorizedTenantId: params.tenantId,
    resourceId: p.resourceId,
    expectedGovernanceVersion: p.governanceVersion,
    destination: p.target,
    authorizationIdentity: `admin:${params.adminId}:plan:${p.id}`,
    proof: p.proof,
    store: params.store,
    receiptDir: params.receiptDir,
  });
}
