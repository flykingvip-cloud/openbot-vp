import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  assertManifestTargetsTenant,
  type TenantImportManifest,
  TENANT_IMPORT_MANIFEST_NAME,
  validateTenantImportManifest,
} from "./manifest.js";
import { isVerifiedTextPath, textHasSourceAbsolutePath } from "./path-scan.js";
import {
  scanPathForSecrets,
  scanJsonForSecrets,
  type SecretScanFinding,
} from "./secret-scanner.js";

/**
 * tenant-import preflight (SaaS tenant data architecture §14 `platform.tenant.import.preflight`).
 *
 * Validates an untrusted package BEFORE any store mutation: manifest schema (§9.3), target-tenant
 * match (§4.1), secret-scanner (§9.2), zip-slip entry-name safety (§15), and — read-only — that no
 * config/content file retains a source-machine absolute path (§10.3; managed mode derives paths
 * from data.root, so a leaked `/Users/…` path is a 归集 miss). It never extracts or writes; it only
 * inspects. `ok` is true only when there are zero blocking errors and zero secret findings — the
 * commit stage must refuse to run otherwise. `verify` re-checks absolute paths as a backstop.
 */

export type TenantImportPreflightResult = {
  ok: boolean;
  manifest?: TenantImportManifest;
  errors: string[];
  secretFindings: SecretScanFinding[];
  stats: { entryCount: number };
};

/** An entry name is unsafe if it is absolute or normalizes to an escaping (`..`) path (§15). */
export function isUnsafeEntryName(name: string): boolean {
  const posix = name.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[A-Za-z]:\//.test(posix)) {
    return true; // absolute (posix or windows drive)
  }
  const normalized = path.posix.normalize(posix);
  return normalized === ".." || normalized.startsWith("../");
}

export async function preflightTenantImportArchive(params: {
  archivePath?: string;
  buffer?: Buffer;
  jobTargetTenantId: string;
}): Promise<TenantImportPreflightResult> {
  const errors: string[] = [];
  const secretFindings: SecretScanFinding[] = [];

  const buffer = params.buffer ?? (await fs.readFile(params.archivePath ?? ""));
  const zip = await JSZip.loadAsync(buffer);

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  let manifest: TenantImportManifest | undefined;

  // 1) Manifest presence + schema (§9.3) + target-tenant match (§4.1).
  const manifestEntry = zip.file(TENANT_IMPORT_MANIFEST_NAME);
  if (!manifestEntry) {
    errors.push(`缺少 ${TENANT_IMPORT_MANIFEST_NAME}`);
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(await manifestEntry.async("string"));
    } catch {
      raw = undefined;
      errors.push(`${TENANT_IMPORT_MANIFEST_NAME} 不是合法 JSON`);
    }
    if (raw !== undefined) {
      const validation = validateTenantImportManifest(raw);
      if (!validation.ok) {
        errors.push(...validation.errors);
      } else {
        manifest = validation.manifest;
        const targetCheck = assertManifestTargetsTenant(manifest, params.jobTargetTenantId);
        if (!targetCheck.ok) {
          errors.push(targetCheck.error);
        }
      }
    }
  }

  // 2) Per-entry: zip-slip name safety (§15) + secret scan (§9.2).
  for (const entry of entries) {
    if (entry.name === TENANT_IMPORT_MANIFEST_NAME) {
      continue;
    }
    if (isUnsafeEntryName(entry.name)) {
      errors.push(`越界路径（zip slip）：${entry.name}`);
      continue; // do not read escaping entries
    }
    secretFindings.push(...scanPathForSecrets(entry.name));
    if (isVerifiedTextPath(entry.name)) {
      const text = await entry.async("string");
      if (entry.name.toLowerCase().endsWith(".json")) {
        secretFindings.push(...scanJsonForSecrets(entry.name, text));
      }
      // §10.3: reject source-machine absolute paths early, before any staging I/O.
      if (textHasSourceAbsolutePath(text)) {
        errors.push(`残留源机绝对路径（打包前须完成归集，§10.3）：${entry.name}`);
      }
    }
  }

  return {
    ok: errors.length === 0 && secretFindings.length === 0,
    manifest,
    errors,
    secretFindings,
    stats: { entryCount: entries.length },
  };
}
