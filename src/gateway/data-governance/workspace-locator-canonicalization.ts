import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveTenantsRoot } from "../tenant-store-paths.js";
import { buildBuiltinStewardWorkspaceResourceId } from "../workspace-resolver/builders.js";
import type { CatalogRecord } from "./types.js";

/** Retired absolute prefixes from when the gateway ran as root with HOME=/root. */
export const HISTORICAL_STATE_DIR_PREFIXES = ["/root/.openbot"] as const;
export const HISTORICAL_TENANTS_ROOT_PREFIXES = ["/root/openbot-tenants"] as const;

const SHORT_STEWARD_RESOURCE_ID = /^ws:([^:]+):user:([^:]+):steward$/;

export type CanonicalLocatorRoots = {
  stateDir: string;
  tenantsRoot: string;
};

export function resolveOfficialWorkspaceRoots(
  env: NodeJS.ProcessEnv = process.env,
): CanonicalLocatorRoots {
  const stateDir = path.resolve(resolveStateDir(env));
  const tenantsRoot = path.resolve(
    env.OPENBOT_TENANTS_ROOT?.trim() ? resolveTenantsRoot(env) : path.join(stateDir, "tenants"),
  );
  return { stateDir, tenantsRoot };
}

function isInside(absPath: string, root: string): boolean {
  const rel = path.relative(root, absPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function rewriteHistoricalPrefix(
  absPath: string,
  prefixes: readonly string[],
  canonicalRoot: string,
): string | null {
  for (const prefix of prefixes) {
    const prefixAbs = path.resolve(prefix);
    if (absPath === prefixAbs || absPath.startsWith(`${prefixAbs}${path.sep}`)) {
      return path.resolve(canonicalRoot, path.relative(prefixAbs, absPath));
    }
  }
  return null;
}

/**
 * Official filesystem locator: current STATE_DIR / TENANTS_ROOT.
 * Historical `/root/.openbot` and `/root/openbot-tenants` prefixes are the
 * same trees under those roots — never remapped onto operators.
 */
export function canonicalizeWorkspaceLocator(
  locator: string,
  roots: CanonicalLocatorRoots,
): { locator: string; changed: boolean } {
  const abs = path.resolve(locator);
  const stateDir = path.resolve(roots.stateDir);
  const tenantsRoot = path.resolve(roots.tenantsRoot);
  if (isInside(abs, stateDir) || isInside(abs, tenantsRoot)) {
    return { locator: abs, changed: abs !== locator };
  }
  const fromState = rewriteHistoricalPrefix(abs, HISTORICAL_STATE_DIR_PREFIXES, stateDir);
  if (fromState) {
    return { locator: fromState, changed: fromState !== abs };
  }
  const fromTenants = rewriteHistoricalPrefix(abs, HISTORICAL_TENANTS_ROOT_PREFIXES, tenantsRoot);
  if (fromTenants) {
    return { locator: fromTenants, changed: fromTenants !== abs };
  }
  return { locator: abs, changed: abs !== locator };
}

export function parseShortStewardResourceId(
  resourceId: string,
): { tenantId: string; userId: string } | null {
  const match = SHORT_STEWARD_RESOURCE_ID.exec(resourceId);
  if (!match) {
    return null;
  }
  return { tenantId: match[1], userId: match[2] };
}

export function isDirectoryOwnerWritable(dir: string, uid = process.getuid?.()): boolean {
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) {
      return false;
    }
    if (typeof uid === "number" && st.uid === uid && (st.mode & 0o200) !== 0) {
      return true;
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function restoreOwnerWriteBit(dir: string, uid = process.getuid?.()): boolean {
  const st = fs.statSync(dir);
  if (!st.isDirectory()) {
    throw new Error(`not_directory:${dir}`);
  }
  if (typeof uid === "number" && st.uid !== uid) {
    throw new Error(`directory_not_owned:${dir}`);
  }
  if ((st.mode & 0o200) !== 0) {
    return false;
  }
  fs.chmodSync(dir, (st.mode & 0o777) | 0o200);
  return true;
}

export type CatalogCanonicalizationAction =
  | {
      kind: "rewrite_locator";
      resourceId: string;
      from: string;
      to: string;
    }
  | {
      kind: "retire_short_steward";
      resourceId: string;
      officialResourceId: string;
      mintOfficial: boolean;
      locator: string;
    }
  | {
      kind: "restore_owner_write";
      resourceId: string;
      locator: string;
      mode: string;
    };

export function planWorkspaceCatalogCanonicalization(params: {
  records: readonly CatalogRecord[];
  roots: CanonicalLocatorRoots;
  processUid?: number;
}): CatalogCanonicalizationAction[] {
  const actions: CatalogCanonicalizationAction[] = [];
  const officialIds = new Set(params.records.map((r) => r.envelope.resourceId));
  for (const record of params.records) {
    const resourceId = record.envelope.resourceId;
    const canonical = record.bindings.find(
      (b) => b.bindingId === record.envelope.canonicalBindingId && b.role === "canonical",
    );
    if (!canonical || canonical.storageKind !== "filesystem" || !canonical.locator) {
      continue;
    }
    const rewritten = canonicalizeWorkspaceLocator(canonical.locator, params.roots);
    const locator = rewritten.locator;
    if (path.resolve(locator) !== path.resolve(canonical.locator)) {
      actions.push({
        kind: "rewrite_locator",
        resourceId,
        from: canonical.locator,
        to: locator,
      });
    }
    const short = parseShortStewardResourceId(resourceId);
    if (short && record.envelope.lifecycleState === "active") {
      const officialResourceId = buildBuiltinStewardWorkspaceResourceId(short);
      actions.push({
        kind: "retire_short_steward",
        resourceId,
        officialResourceId,
        mintOfficial: !officialIds.has(officialResourceId),
        locator,
      });
    }
    if (record.envelope.lifecycleState !== "active" || canonical.state !== "active") {
      continue;
    }
    try {
      if (fs.existsSync(locator) && fs.statSync(locator).isDirectory()) {
        if (!isDirectoryOwnerWritable(locator, params.processUid)) {
          const st = fs.statSync(locator);
          actions.push({
            kind: "restore_owner_write",
            resourceId,
            locator,
            mode: (st.mode & 0o777).toString(8).padStart(3, "0"),
          });
        }
      }
    } catch {
      // Absence is a locator problem, not a permission repair.
    }
  }
  return actions;
}

export type CatalogMutator = {
  get: (resourceId: string) => Promise<CatalogRecord | null | undefined>;
  put: (record: CatalogRecord) => Promise<unknown>;
};

export function backupGovernanceCatalogFile(stateDir: string, now = new Date()): string {
  const src = resolveDataGovernanceCatalogPath(stateDir);
  const dest = `${src}.bak-${now.toISOString().replace(/[:.]/g, "")}`;
  fs.copyFileSync(src, dest);
  return dest;
}

export type CatalogCanonicalizationReport = {
  applied: CatalogCanonicalizationAction[];
  skipped: { action: CatalogCanonicalizationAction; reason: string }[];
  errors: { action: CatalogCanonicalizationAction; error: string }[];
};

export async function applyWorkspaceCatalogCanonicalization(params: {
  catalog: CatalogMutator;
  actions: readonly CatalogCanonicalizationAction[];
  applyPermissions: boolean;
  processUid?: number;
}): Promise<CatalogCanonicalizationReport> {
  const applied: CatalogCanonicalizationAction[] = [];
  const skipped: CatalogCanonicalizationReport["skipped"] = [];
  const errors: CatalogCanonicalizationReport["errors"] = [];
  const now = new Date().toISOString();

  for (const action of params.actions) {
    try {
      if (action.kind === "rewrite_locator") {
        const existing = await params.catalog.get(action.resourceId);
        if (!existing) {
          skipped.push({ action, reason: "resource_missing" });
          continue;
        }
        const canonical = existing.bindings.find(
          (b) => b.bindingId === existing.envelope.canonicalBindingId && b.role === "canonical",
        );
        if (!canonical) {
          skipped.push({ action, reason: "canonical_missing" });
          continue;
        }
        if (path.resolve(canonical.locator) === path.resolve(action.to)) {
          skipped.push({ action, reason: "already_canonical" });
          continue;
        }
        await params.catalog.put({
          envelope: {
            ...existing.envelope,
            governanceVersion: existing.envelope.governanceVersion + 1,
            updatedAt: now,
          },
          bindings: [
            {
              ...canonical,
              locator: path.resolve(action.to),
              contentVersion: String(existing.envelope.governanceVersion + 1),
            },
            ...existing.bindings.filter((b) => b.bindingId !== canonical.bindingId),
          ],
        });
        applied.push(action);
        continue;
      }

      if (action.kind === "retire_short_steward") {
        const short = await params.catalog.get(action.resourceId);
        if (!short) {
          skipped.push({ action, reason: "resource_missing" });
          continue;
        }
        if (action.mintOfficial) {
          const official = await params.catalog.get(action.officialResourceId);
          if (!official) {
            const canonical = short.bindings.find(
              (b) => b.bindingId === short.envelope.canonicalBindingId && b.role === "canonical",
            );
            if (!canonical) {
              skipped.push({ action, reason: "canonical_missing" });
              continue;
            }
            const bindingId = `canonical:${action.officialResourceId}`;
            await params.catalog.put({
              envelope: {
                ...short.envelope,
                resourceId: action.officialResourceId,
                canonicalBindingId: bindingId,
                governanceVersion: 1,
                createdAt: now,
                updatedAt: now,
                lifecycleState: "active",
              },
              bindings: [
                {
                  ...canonical,
                  bindingId,
                  resourceId: action.officialResourceId,
                  locator: path.resolve(action.locator),
                  state: "active",
                  contentVersion: "1",
                },
              ],
            });
          }
        }
        if (short.envelope.lifecycleState !== "retired") {
          await params.catalog.put({
            envelope: {
              ...short.envelope,
              lifecycleState: "retired",
              governanceVersion: short.envelope.governanceVersion + 1,
              updatedAt: now,
            },
            bindings: short.bindings.map((b) =>
              b.role === "canonical" ? { ...b, state: "retired" as const } : b,
            ),
          });
        }
        applied.push(action);
        continue;
      }

      if (action.kind === "restore_owner_write") {
        if (!params.applyPermissions) {
          skipped.push({ action, reason: "permissions_not_requested" });
          continue;
        }
        const changed = restoreOwnerWriteBit(action.locator, params.processUid);
        if (!changed) {
          skipped.push({ action, reason: "already_writable" });
          continue;
        }
        applied.push(action);
      }
    } catch (error) {
      errors.push({
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { applied, skipped, errors };
}
