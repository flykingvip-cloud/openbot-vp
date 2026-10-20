import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { isMigrationExportDenied, MIGRATION_CORE_RELATIVE_PATHS } from "../migration-bundle.js";
import {
  buildTenantImportManifest,
  TENANT_IMPORT_MANIFEST_NAME,
  type TenantImportManifest,
} from "./manifest.js";
import {
  scanTenantImportEntries,
  type SecretScanFinding,
  type TenantImportScanEntry,
} from "./secret-scanner.js";

/**
 * tenant-import package builder (SaaS tenant data architecture §9, the "打包 CLI" core engine).
 *
 * Assembles a `tenant-import.zip` from an already-collected source layout:
 *  - `control-plane/` — L1 slice (seat-assets, enterprise-data, organization, …), walked fully.
 *  - `users/<uid>/OpenBot/` — L2 per-user Data Space, core paths only (mirrors data-export;
 *    excludes rebuildable `cache/` and runtime sessions).
 *  - `tenant-shared/` — optional L1 shared assets, walked fully.
 *
 * The builder is fail-loud on secrets: it runs the §9.2 scanner over every collected entry and
 * aborts (throws {@link TenantImportSecretError}) rather than emitting a package that leaks a
 * credential. Symlinks are skipped (Dirent type is not a regular file/dir), avoiding symlink
 * escape (§15). Store-slicing (which tenant's rows) is a separate concern layered on top.
 */

export class TenantImportSecretError extends Error {
  readonly findings: SecretScanFinding[];
  constructor(findings: SecretScanFinding[]) {
    super(`tenant-import 打包中止：命中 ${String(findings.length)} 处密钥红线（§9.2）`);
    this.name = "TenantImportSecretError";
    this.findings = findings;
  }
}

export type TenantImportSource = {
  environment: string;
  sourceTenantId: string;
  targetTenantId: string;
  targetRegion?: string;
  openbotVersion?: string;
  /** Absolute L1 control-plane dir; walked → `control-plane/<rel>`. */
  controlPlaneDir?: string;
  /** userId -> absolute OpenBot data space dir; core paths → `users/<uid>/OpenBot/<rel>`. */
  userDataSpaces: Record<string, string>;
  /** Absolute tenant-shared dir; walked → `tenant-shared/<rel>`. */
  tenantSharedDir?: string;
};

export type TenantImportBuildResult = {
  buffer: Buffer;
  manifest: TenantImportManifest;
};

type CollectedEntry = { pkgPath: string; absPath: string };

/** Recursively collect regular files under `absDir`, mapping to `${pkgPrefix}/<rel>`. */
async function walkDir(
  absDir: string,
  pkgPrefix: string,
  options?: { dataRoot?: string },
): Promise<CollectedEntry[]> {
  const out: CollectedEntry[] = [];
  if (options?.dataRoot && isMigrationExportDenied(options.dataRoot, absDir)) {
    return out;
  }
  const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (options?.dataRoot && isMigrationExportDenied(options.dataRoot, abs)) {
      continue;
    }
    const pkg = `${pkgPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walkDir(abs, pkg, options)));
    } else if (entry.isFile()) {
      // Skip symlinks and specials: Dirent.isFile() is false for them (no symlink escape).
      out.push({ pkgPath: pkg, absPath: abs });
    }
  }
  return out;
}

async function countAgentDirs(openbotDir: string): Promise<number> {
  const entries = await fs
    .readdir(path.join(openbotDir, "agents"), { withFileTypes: true })
    .catch(() => null);
  if (!entries) {
    return 0;
  }
  return entries.filter((d) => d.isDirectory()).length;
}

export async function buildTenantImportPackage(
  source: TenantImportSource,
  opts: { now?: () => Date } = {},
): Promise<TenantImportBuildResult> {
  const collected: CollectedEntry[] = [];

  if (source.controlPlaneDir) {
    collected.push(...(await walkDir(source.controlPlaneDir, "control-plane")));
  }

  const userIds = Object.keys(source.userDataSpaces).toSorted();
  let agentCount = 0;
  for (const userId of userIds) {
    const openbotDir = source.userDataSpaces[userId];
    if (!openbotDir) {
      continue;
    }
    for (const rel of MIGRATION_CORE_RELATIVE_PATHS) {
      collected.push(
        ...(await walkDir(path.join(openbotDir, rel), `users/${userId}/OpenBot/${rel}`, {
          dataRoot: openbotDir,
        })),
      );
    }
    agentCount += await countAgentDirs(openbotDir);
  }

  if (source.tenantSharedDir) {
    collected.push(...(await walkDir(source.tenantSharedDir, "tenant-shared")));
  }

  // Read file contents once; build scan entries (content-scan .json only).
  const fileBuffers = new Map<string, Buffer>();
  const scanEntries: TenantImportScanEntry[] = [];
  let bytes = 0;
  for (const entry of collected) {
    const data = await fs.readFile(entry.absPath);
    fileBuffers.set(entry.pkgPath, data);
    bytes += data.byteLength;
    const isJson = entry.pkgPath.toLowerCase().endsWith(".json");
    scanEntries.push({ path: entry.pkgPath, json: isJson ? data.toString("utf-8") : undefined });
  }

  // §9.2: any finding aborts packaging (never emit a leaky package).
  const scan = scanTenantImportEntries(scanEntries);
  if (!scan.ok) {
    throw new TenantImportSecretError(scan.findings);
  }

  const manifest = buildTenantImportManifest({
    environment: source.environment,
    sourceTenantId: source.sourceTenantId,
    targetTenantId: source.targetTenantId,
    targetRegion: source.targetRegion,
    openbotVersion: source.openbotVersion,
    userDataSpaces: userIds,
    controlPlane: Boolean(source.controlPlaneDir),
    tenantShared: Boolean(source.tenantSharedDir),
    stats: { fileCount: collected.length, bytes, userCount: userIds.length, agentCount },
    now: opts.now,
  });

  const zip = new JSZip();
  zip.file(TENANT_IMPORT_MANIFEST_NAME, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [pkgPath, data] of fileBuffers) {
    zip.file(pkgPath, data);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, manifest };
}
