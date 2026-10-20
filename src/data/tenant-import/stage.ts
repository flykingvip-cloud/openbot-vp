import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { IdRemapPlan } from "./id-remap.js";
import { TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";
import { isUnsafeEntryName } from "./preflight.js";

/**
 * tenant-import staging extractor (SaaS tenant data architecture §12.6 "copy → staging" phase).
 *
 * Extracts a validated package into an isolated staging dir, applying the {@link IdRemapPlan} to
 * PACKAGE PATHS (§10.3): `users/<sourceUserId>/…` → `users/<targetUserId>/…` and, within a user
 * space, `agents/<sourceAgentId>/…` → `agents/<targetAgentId>/…`. Never writes into the live
 * tenant tree, so a failure here leaves production untouched (§12.6 rollback: verify failure just
 * discards staging). Content-level id rewrite (references inside JSON) and the atomic commit to
 * the live tree are the store-integration step, layered on top of this.
 *
 * Two zip-slip layers: entry names are rejected via {@link isUnsafeEntryName}, and every resolved
 * destination is re-checked to stay within the staging root (§15).
 */

export type StageTenantImportResult = {
  stagedRoot: string;
  fileCount: number;
  /** Original package path -> rewritten staged path, for paths the remap plan changed. */
  rewrites: Record<string, string>;
};

/** Rewrite a package-relative path per the remap plan (user id, then user-space agent id). */
export function rewritePackagePath(pkgPath: string, plan: IdRemapPlan): string {
  const segments = pkgPath.split("/");
  if (segments[0] !== "users") {
    return pkgPath; // control-plane/ and tenant-shared/ paths are not id-keyed at the path level
  }
  const sourceUserId = segments[1];
  const userRemap = sourceUserId ? plan.users[sourceUserId] : undefined;
  if (userRemap) {
    segments[1] = userRemap.targetUserId;
  }
  const agentsIdx = segments.indexOf("agents");
  if (agentsIdx >= 0 && agentsIdx < segments.length - 1) {
    const sourceAgentId = segments[agentsIdx + 1];
    const targetAgentId = sourceAgentId ? plan.agents[sourceAgentId] : undefined;
    if (targetAgentId) {
      segments[agentsIdx + 1] = targetAgentId;
    }
  }
  return segments.join("/");
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function stageTenantImportPackage(params: {
  buffer?: Buffer;
  archivePath?: string;
  plan: IdRemapPlan;
  stagingRoot: string;
}): Promise<StageTenantImportResult> {
  const buffer = params.buffer ?? (await fs.readFile(params.archivePath ?? ""));
  const zip = await JSZip.loadAsync(buffer);
  const stagingRoot = path.resolve(params.stagingRoot);
  await fs.mkdir(stagingRoot, { recursive: true });

  const rewrites: Record<string, string> = {};
  let fileCount = 0;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === TENANT_IMPORT_MANIFEST_NAME) {
      continue;
    }
    if (isUnsafeEntryName(entry.name)) {
      throw new Error(`拒绝越界路径（zip slip）：${entry.name}`);
    }
    const rewritten = rewritePackagePath(entry.name, params.plan);
    if (rewritten !== entry.name) {
      rewrites[entry.name] = rewritten;
    }
    const dest = path.resolve(stagingRoot, rewritten);
    if (!isWithinRoot(stagingRoot, dest)) {
      throw new Error(`拒绝越界路径（zip slip）：${entry.name}`);
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, await entry.async("nodebuffer"));
    fileCount += 1;
  }

  // Keep the manifest in staging for audit/verify.
  const manifestEntry = zip.file(TENANT_IMPORT_MANIFEST_NAME);
  if (manifestEntry) {
    await fs.writeFile(
      path.join(stagingRoot, TENANT_IMPORT_MANIFEST_NAME),
      await manifestEntry.async("nodebuffer"),
    );
  }

  return { stagedRoot: stagingRoot, fileCount, rewrites };
}
