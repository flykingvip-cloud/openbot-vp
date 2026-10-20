import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveMigrationAbsolutePaths } from "./migration-bundle.js";

export type DataExportManifest = {
  schemaVersion: 1;
  exportedAt: string;
  dataRoot: string;
  /** Relative paths included in the archive (under data root). */
  paths: string[];
  /** Explicitly excluded categories for audit. */
  excluded: string[];
};

export type DataExportResult = {
  exportPath: string;
  manifest: DataExportManifest;
  bytes: number;
};

const EXPORT_MANIFEST_NAME = "openbot-export-manifest.json";

export async function createDataExportArchive(params: {
  cfg?: OpenBotConfig;
  includeCache?: boolean;
  outputDir?: string;
}): Promise<DataExportResult> {
  const cfg = params.cfg;
  const dataRoot = resolveDataRoot(cfg);
  const includeCache = params.includeCache === true;
  const sources = resolveMigrationAbsolutePaths(dataRoot, { includeCache });
  const relativePaths = sources.map((abs) => path.relative(dataRoot, abs));

  const manifest: DataExportManifest = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    dataRoot,
    paths: relativePaths,
    excluded: ["credentials", "identity", "runtime-sessions", "auth-profiles"],
  };

  const zip = new JSZip();
  zip.file(EXPORT_MANIFEST_NAME, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const abs of sources) {
    try {
      await addPathToZip(zip, abs, path.relative(dataRoot, abs));
    } catch {
      // skip missing paths
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const outDir = params.outputDir ?? path.join(os.tmpdir(), "openbot-exports");
  await fs.mkdir(outDir, { recursive: true });
  const exportPath = path.join(outDir, `openbot-export-${Date.now()}.zip`);
  await fs.writeFile(exportPath, buffer);

  return {
    exportPath,
    manifest,
    bytes: buffer.byteLength,
  };
}

async function addPathToZip(zip: JSZip, absPath: string, relPath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      await addPathToZip(zip, path.join(absPath, entry.name), path.join(relPath, entry.name));
    }
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  const data = await fs.readFile(absPath);
  zip.file(relPath.replace(/\\/g, "/"), data);
}

export async function restoreDataExportArchive(params: {
  archivePath: string;
  targetRoot?: string;
  cfg?: OpenBotConfig;
}): Promise<{ targetRoot: string; manifest: DataExportManifest }> {
  const buffer = await fs.readFile(params.archivePath);
  const zip = await JSZip.loadAsync(buffer);
  const manifestEntry = zip.file(EXPORT_MANIFEST_NAME);
  if (!manifestEntry) {
    throw new Error("导出包缺少 manifest。");
  }
  const manifest = JSON.parse(await manifestEntry.async("string")) as DataExportManifest;
  const targetRoot = path.resolve(params.targetRoot ?? resolveDataRoot(params.cfg));
  await fs.mkdir(targetRoot, { recursive: true });

  const files = Object.values(zip.files);
  for (const entry of files) {
    if (entry.dir || entry.name === EXPORT_MANIFEST_NAME) {
      continue;
    }
    const dest = path.join(targetRoot, entry.name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const content = await entry.async("nodebuffer");
    await fs.writeFile(dest, content);
  }

  return { targetRoot, manifest };
}
