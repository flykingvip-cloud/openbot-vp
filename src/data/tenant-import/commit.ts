import fs from "node:fs/promises";
import path from "node:path";
import { TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";
import { isVerifiedTextPath, textHasSourceAbsolutePath } from "./path-scan.js";

/**
 * tenant-import verify + commit phases (SaaS tenant data architecture §12.6).
 *
 * - verify: the staged tree must not retain source-machine absolute paths (§10.3 acceptance /
 *   §16 smoke #8). This is the commit-time BACKSTOP; `preflight` already rejects such paths in
 *   the raw package before any staging I/O. Runs against the isolated staging dir; a failure
 *   discards staging and never touches the live tenant tree.
 * - commit: merge the staged content into the live tenant tree (`/data/tenants/<tid>/`). Import
 *   content wins on overlap; re-running the same staged tree is idempotent (same bytes land at
 *   the same paths). Auto-rollback of an already-committed job is out of scope (§12.6: requires an
 *   explicit `platform.tenant.import.rollback`); safety comes from preflight/stage/verify never
 *   writing into the live tree.
 */

export type StagedVerifyResult = {
  ok: boolean;
  errors: string[];
};

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Verify a staged tree before commit: manifest present and no source-machine absolute paths left
 * in config/content files (§10.3). Returns all errors so an operator can fix the source at once.
 */
export async function verifyStagedTenantImport(stagedRoot: string): Promise<StagedVerifyResult> {
  const errors: string[] = [];
  const root = path.resolve(stagedRoot);

  const manifestPresent = await fs
    .access(path.join(root, TENANT_IMPORT_MANIFEST_NAME))
    .then(() => true)
    .catch(() => false);
  if (!manifestPresent) {
    errors.push(`staging 缺少 ${TENANT_IMPORT_MANIFEST_NAME}`);
  }

  for (const file of await walkFiles(root)) {
    if (!isVerifiedTextPath(file)) {
      continue;
    }
    const text = await fs.readFile(file, "utf-8").catch(() => "");
    if (textHasSourceAbsolutePath(text)) {
      errors.push(`残留源机绝对路径：${path.relative(root, file)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export type CommitTenantImportResult = {
  tenantLiveRoot: string;
  committedFiles: number;
};

/**
 * Merge the staged tree into the live tenant tree. The staging manifest is not merged into live
 * content (it is import metadata). Overwrites on overlap so re-commit is idempotent.
 */
export async function commitStagedTenantImport(params: {
  stagedRoot: string;
  tenantLiveRoot: string;
}): Promise<CommitTenantImportResult> {
  const stagedRoot = path.resolve(params.stagedRoot);
  const tenantLiveRoot = path.resolve(params.tenantLiveRoot);
  await fs.mkdir(tenantLiveRoot, { recursive: true });

  let committedFiles = 0;
  for (const file of await walkFiles(stagedRoot)) {
    const rel = path.relative(stagedRoot, file);
    if (rel === TENANT_IMPORT_MANIFEST_NAME) {
      continue; // import metadata, not tenant content
    }
    const dest = path.join(tenantLiveRoot, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(file, dest);
    committedFiles += 1;
  }
  return { tenantLiveRoot, committedFiles };
}
