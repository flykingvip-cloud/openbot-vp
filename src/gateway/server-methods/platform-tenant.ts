import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  findCompletedImportByPackage,
  getTenantImportJob,
  upsertTenantImportJob,
} from "../../data/tenant-import/import-job-store.js";
import { runLocalTenantImport } from "../../data/tenant-import/import-job.js";
import { buildRemapPlanFromPackage } from "../../data/tenant-import/plan-from-package.js";
import { preflightTenantImportArchive } from "../../data/tenant-import/preflight.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { reportDedicatedRuntimeCost } from "../tenant-dedicated-cost.js";
import {
  listTenantIsolationDrift,
  resolveTenantIsolationDrift,
} from "../tenant-isolation-entitlement.js";
import { setTenantOperationalStatus } from "../tenant-operational-status.js";
import {
  beginTenantMigration,
  clearTenantMigration,
  getTenantRecord,
  isTenantIsolation,
  isTenantMigrationDirection,
  listTenantRecords,
  type TenantIsolation,
  upsertTenantRecord,
} from "../tenant-registry-store.js";
import { resolveTenantLiveRoot, resolveTenantsRoot } from "../tenant-store-paths.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

/**
 * Platform-privileged tenant lifecycle RPCs (SaaS tenant data architecture §14).
 *
 * Wraps the local tenant-import engine (`runLocalTenantImport`) with tenant provisioning, a
 * persisted job record, and `importJobId` idempotency (§10.4 / SAAS-T-02). These methods are
 * gated to platform sessions two ways: operator ADMIN/READ scope (`method-scopes.ts`) and the
 * `"platform"` session domain (`platform-auth/session-domain.ts`) — an employee token is rejected
 * before reaching these handlers. The import runs inline (packages are small); it can move to a
 * background worker later without changing the RPC contract (status is queried from the store).
 */

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function stringParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Extract + validate + canonicalize a tenant id param (hybrid-gateway-isolation F1): maps a legacy
 * alias to its canonical id (e.g. upbeyond-91aeea3c -> 001) so the control plane (tenant directory,
 * registry, import) keys by the SAME identity the runtime derives from membership. "" when missing
 * or unsafe.
 */
function tenantIdParam(value: unknown): string {
  const raw = stringParam(value);
  if (!raw || !SAFE_TENANT_ID.test(raw)) {
    return "";
  }
  return canonicalizeTenantId(raw) ?? raw;
}

/** Platform-global import-job ledger, kept alongside the tenants volume (so it moves with it). */
function resolveJobStorePath(): string {
  return path.join(resolveTenantsRoot(), ".import-jobs.json");
}

async function tenantExists(tenantId: string): Promise<boolean> {
  return fs
    .stat(resolveTenantLiveRoot(tenantId))
    .then((s) => s.isDirectory())
    .catch(() => false);
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  return fs
    .readFile(filePath, "utf-8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
}

/**
 * Read the target tenant's existing users (email→id) and agent ids so a re-import merges by email
 * (OQ-3) and resolves agent-id collisions. Empty for a freshly provisioned tenant.
 */
async function readExistingTenantState(
  tenantLiveRoot: string,
): Promise<{ existingUsersByEmail: Record<string, string>; existingAgentIds: string[] }> {
  const existingUsersByEmail: Record<string, string> = {};
  const slice = (await readJsonSafe(
    path.join(tenantLiveRoot, "control-plane", "platform-auth-slice.json"),
  )) as { users?: unknown } | null;
  const users = Array.isArray(slice?.users)
    ? slice.users
    : slice?.users && typeof slice.users === "object"
      ? Object.values(slice.users)
      : [];
  for (const entry of users) {
    const id = (entry as { id?: unknown }).id;
    const email = (entry as { email?: unknown }).email;
    if (typeof id === "string" && typeof email === "string" && email.trim()) {
      existingUsersByEmail[email.trim().toLowerCase()] = id;
    }
  }

  const existingAgentIds = new Set<string>();
  const usersDir = path.join(tenantLiveRoot, "users");
  const userEntries = await fs.readdir(usersDir, { withFileTypes: true }).catch(() => []);
  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory()) {
      continue;
    }
    const agentsDir = path.join(usersDir, userEntry.name, "OpenBot", "agents");
    const agentEntries = await fs.readdir(agentsDir, { withFileTypes: true }).catch(() => []);
    for (const agentEntry of agentEntries) {
      if (agentEntry.isDirectory()) {
        existingAgentIds.add(agentEntry.name);
      }
    }
  }
  return { existingUsersByEmail, existingAgentIds: [...existingAgentIds] };
}

export const platformTenantHandlers: GatewayRequestHandlers = {
  "platform.tenant.provision": async ({ params, respond }) => {
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    // hybrid-gateway-isolation F1: isolation is OPTIONAL and provision is IDEMPOTENT — an omitted
    // isolation PRESERVES the tenant's existing assignment (never silently demotes dedicated ->
    // shared). Only a supplied value is validated and applied.
    const rawIsolation = params.isolation;
    let isolation: TenantIsolation | undefined;
    if (rawIsolation === undefined) {
      isolation = undefined;
    } else if (isTenantIsolation(rawIsolation)) {
      isolation = rawIsolation;
    } else {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'isolation must be "shared" or "dedicated"'),
      );
      return;
    }
    const root = resolveTenantLiveRoot(tenantId);
    for (const sub of ["control-plane", "shared", "users"]) {
      await fs.mkdir(path.join(root, sub), { recursive: true });
    }
    const record = await upsertTenantRecord(
      isolation === undefined ? { tenantId } : { tenantId, isolation },
    );
    respond(true, { tenantId, root, provisioned: true, isolation: record.isolation });
  },

  "platform.tenant.import.preflight": async ({ params, respond }) => {
    const targetTenantId = tenantIdParam(params.targetTenantId);
    const archivePath = stringParam(params.archivePath);
    if (!targetTenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid targetTenantId"));
      return;
    }
    if (!archivePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "archivePath is required"));
      return;
    }
    if (!(await tenantExists(targetTenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${targetTenantId}`),
      );
      return;
    }
    try {
      const report = await preflightTenantImportArchive({
        archivePath,
        jobTargetTenantId: targetTenantId,
      });
      respond(true, report);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "platform.tenant.import.start": async ({ params, respond, client }) => {
    const targetTenantId = tenantIdParam(params.targetTenantId);
    const archivePath = stringParam(params.archivePath);
    const importJobId = stringParam(params.importJobId);
    const force = params.force === true;
    const operatorId = stringParam(client?.user) || undefined;

    if (!targetTenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid targetTenantId"));
      return;
    }
    if (!archivePath || !importJobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "archivePath and importJobId are required"),
      );
      return;
    }
    if (!(await tenantExists(targetTenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${targetTenantId}`),
      );
      return;
    }

    // Idempotency (SAAS-T-02): a retry of the same importJobId returns the recorded job.
    const existing = await getTenantImportJob(importJobId, resolveJobStorePath());
    if (existing) {
      respond(true, { ...existing, idempotentReplay: true });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(archivePath);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      return;
    }
    const packageSha256 = createHash("sha256").update(buffer).digest("hex");

    // §10.4 duplicate-package guard (unless force).
    if (!force) {
      const dup = await findCompletedImportByPackage(
        targetTenantId,
        packageSha256,
        resolveJobStorePath(),
      );
      if (dup) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `package already imported as job ${dup.importJobId}; pass force=true to re-import`,
          ),
        );
        return;
      }
    }

    const tenantLiveRoot = resolveTenantLiveRoot(targetTenantId);
    const stagingRoot = path.join(tenantLiveRoot, ".import-staging", importJobId);
    await upsertTenantImportJob(
      {
        importJobId,
        targetTenantId,
        status: "running",
        phase: "preflight",
        packageSha256,
        operatorId,
      },
      resolveJobStorePath(),
    );

    try {
      const existingState = await readExistingTenantState(tenantLiveRoot);
      const plan = await buildRemapPlanFromPackage({ buffer, targetTenantId, ...existingState });
      const result = await runLocalTenantImport({
        buffer,
        jobTargetTenantId: targetTenantId,
        plan,
        stagingRoot,
        tenantLiveRoot,
      });
      const record = await upsertTenantImportJob(
        {
          importJobId,
          targetTenantId,
          status: result.ok ? "done" : "failed",
          phase: result.phase,
          packageSha256,
          committedFiles: result.committedFiles,
          stats: result.stats,
          errors: result.ok ? undefined : result.errors,
          operatorId,
        },
        resolveJobStorePath(),
      );
      // RPC succeeds once the job ran; import outcome is in `record.status`.
      respond(true, record);
    } catch (err) {
      const record = await upsertTenantImportJob(
        {
          importJobId,
          targetTenantId,
          status: "failed",
          phase: "preflight",
          packageSha256,
          errors: [String(err)],
          operatorId,
        },
        resolveJobStorePath(),
      );
      respond(true, record);
    }
  },

  "platform.tenant.import.status": async ({ params, respond }) => {
    const importJobId = stringParam(params.importJobId);
    if (!importJobId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "importJobId is required"));
      return;
    }
    const job = await getTenantImportJob(importJobId, resolveJobStorePath());
    if (!job) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `job not found: ${importJobId}`),
      );
      return;
    }
    respond(true, job);
  },

  "platform.tenant.setIsolation": async ({ params, respond }) => {
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    const isolation = params.isolation;
    if (!isTenantIsolation(isolation)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'isolation must be "shared" or "dedicated"'),
      );
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    // Optional routing fields (F2/F3): infra may backfill the dedicated endpoint/region here.
    const endpoint = stringParam(params.endpoint) || undefined;
    const region = stringParam(params.region) || undefined;
    const record = await upsertTenantRecord({ tenantId, isolation, endpoint, region });
    respond(true, record);
  },

  "platform.tenant.beginMigration": async ({ params, respond }) => {
    // hybrid-gateway-isolation F4: mark an in-flight promote/demote. This records the drain window
    // ONLY — it does NOT change the authoritative route (isolation/endpoint). The route flips once,
    // atomically, when infra later calls setIsolation (commit), so an abort is a clean rollback with
    // no split-brain (R6.4).
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    const direction = params.direction;
    if (!isTenantMigrationDirection(direction)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'direction must be "promote" or "demote"'),
      );
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    try {
      // Fail-closed inside the store: rejects a double migration or a direction that does not match
      // the tenant's current isolation.
      const record = await beginTenantMigration(tenantId, direction);
      respond(true, record);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "platform.tenant.abortMigration": async ({ params, respond }) => {
    // hybrid-gateway-isolation F4: roll back an in-flight migration. Clears the marker WITHOUT
    // flipping the route, so the tenant stays at its source location (no split-brain). Idempotent.
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    const record = await clearTenantMigration(tenantId);
    respond(true, record);
  },

  "platform.tenant.getIsolation": async ({ params, respond }) => {
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    // A provisioned tenant with no explicit record defaults to the shared pool.
    const record = await getTenantRecord(tenantId);
    respond(true, record ?? { tenantId, isolation: "shared" });
  },

  "platform.tenant.listIsolation": async ({ respond }) => {
    // Routing map for the reverse proxy (hybrid-gateway-isolation F2, R5.1-5.3): every tenant's
    // isolation + optional dedicated endpoint, so the proxy can send dedicated tenants to their
    // instance and everything else to the shared pool. A tenant with no explicit record is on the
    // shared pool (default). The proxy / subdomain routing itself is infra (R5.4), consuming this
    // read-only interface.
    const tenants = await listTenantRecords();
    respond(true, { tenants });
  },

  "platform.tenant.getIsolationDrift": async ({ params, respond }) => {
    // hybrid-gateway-isolation F5 (R7.4): observe entitlement(desired) vs registry(actual) drift for
    // one tenant. READ-ONLY — recommends promote/demote but never runs a migration (POLICY decoupled
    // from MECHANISM). desired comes from the subscription's dedicatedIsolation feature.
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    respond(true, await resolveTenantIsolationDrift(tenantId));
  },

  "platform.tenant.listIsolationDrift": async ({ respond }) => {
    // hybrid-gateway-isolation F5 (R7.4): entitlement-vs-actual drift across all recorded tenants —
    // the platform-side reconciliation worklist (which tenants an operator should promote/demote).
    // READ-ONLY; the mechanism (F4 migration) stays operator/infra-driven.
    const drifts = await listTenantIsolationDrift();
    respond(true, { drifts });
  },

  "platform.tenant.reportDedicatedCost": async ({ params, respond }) => {
    // hybrid-gateway-isolation F6 (R8.3): the PRODUCTION seam for dedicated-instance cost
    // attribution. Infra (which owns the instance's real infra cost) rolls up a billing period's
    // cost and calls this; it lands `dedicated_infra_cost` in the existing usage ledger + billing
    // event bus keyed by enterpriseId (= tenantId), so per-tenant observability + cost attribution
    // are wired through the established path (not a parallel one). Parallel to endpoint backfill via
    // setIsolation — infra computes the value, the platform records it.
    const tenantId = tenantIdParam(params.tenantId);
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
      return;
    }
    const period = stringParam(params.period);
    if (!period) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "period is required"));
      return;
    }
    const cents = params.cents;
    if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "cents must be a non-negative number"),
      );
      return;
    }
    if (!(await tenantExists(tenantId))) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `tenant not provisioned: ${tenantId}`),
      );
      return;
    }
    const occurredAt = stringParam(params.occurredAt) || undefined;
    const result = await reportDedicatedRuntimeCost({
      tenantId,
      cents,
      period,
      ...(occurredAt ? { occurredAt } : {}),
    });
    respond(true, { tenantId, period, cents: Math.round(cents), ...result });
  },

  /**
   * Pause writes operational status `suspended` and audits `reason`.
   * It does not call `agent-runtime.update-lifecycle` and does not drain agents.
   * Whether this should also suspend the commercial enterprise record is open.
   */
  "platform.tenant.pause": async ({ params, respond, client }) => {
    await respondTenantOperationalStatus(params, respond, client, "suspended");
  },

  /** Resume writes operational status `active`. It does not restart drained agents. */
  "platform.tenant.resume": async ({ params, respond, client }) => {
    await respondTenantOperationalStatus(params, respond, client, "active");
  },
};

async function respondTenantOperationalStatus(
  params: Record<string, unknown>,
  respond: RespondFn,
  client: GatewayClient | null,
  status: "active" | "suspended",
): Promise<void> {
  const tenantId = tenantIdParam(params.tenantId);
  const reason = stringParam(params.reason);
  if (!tenantId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tenantId"));
    return;
  }
  if (!reason) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "reason is required"));
    return;
  }
  if (reason.length > 500) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "reason is too long"));
    return;
  }
  const result = await setTenantOperationalStatus({
    tenantId,
    status,
    reason,
    actor: stringParam(client?.user) || "operator",
  });
  respond(true, {
    tenantId: result.tenantId,
    status: result.status,
    previousStatus: result.previousStatus,
  });
}
