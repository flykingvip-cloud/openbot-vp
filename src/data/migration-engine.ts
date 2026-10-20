import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { ensureDataSpace, resolveDataRoot } from "../config/data-space.js";
import { validateMigrationTargetPath } from "./data-root-info.js";
import { estimateMigrationBundleSize, resolveMigrationAbsolutePaths } from "./migration-bundle.js";

export type MigrationPhase =
  | "idle"
  | "preflight_check"
  | "copy_bundle"
  | "verify_bundle"
  | "switch_config"
  | "postflight_doctor"
  | "done"
  | "rollback"
  | "failed"
  | "cancelled";

export type MigrationJob = {
  id: string;
  phase: MigrationPhase;
  sourceRoot: string;
  targetRoot: string;
  stagingRoot: string;
  includeCache: boolean;
  progressPercent: number;
  message: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
  previousConfigRoot?: string;
};

const STAGING_DIRNAME = ".openbot-migrate-staging";
const PREVIOUS_ROOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let activeJob: MigrationJob | null = null;

export function getActiveMigrationJob(): MigrationJob | null {
  return activeJob ? { ...activeJob } : null;
}

export function clearMigrationJobForTests(): void {
  activeJob = null;
}

export type MigrationPreflightResult = {
  ok: boolean;
  sourceRoot: string;
  targetRoot?: string;
  estimatedBytes: number;
  estimatedBytesLabel: string;
  fileCount: number;
  availableBytes?: number;
  error?: string;
};

export async function preflightMigration(params: {
  targetPath: string;
  includeCache?: boolean;
  cfg?: OpenBotConfig;
}): Promise<MigrationPreflightResult> {
  const cfg = params.cfg ?? loadConfig();
  const sourceRoot = resolveDataRoot(cfg);
  const validation = validateMigrationTargetPath(params.targetPath);
  if (!validation.ok || !validation.resolvedPath) {
    return {
      ok: false,
      sourceRoot,
      estimatedBytes: 0,
      estimatedBytesLabel: "0 B",
      fileCount: 0,
      error: validation.error ?? "目标路径无效。",
    };
  }
  const targetRoot = path.join(validation.resolvedPath, "OpenBot");
  const estimate = estimateMigrationBundleSize(sourceRoot, {
    includeCache: params.includeCache === true,
  });
  if (
    validation.availableBytes != null &&
    validation.availableBytes > 0 &&
    estimate.bytes > validation.availableBytes
  ) {
    return {
      ok: false,
      sourceRoot,
      targetRoot,
      estimatedBytes: estimate.bytes,
      estimatedBytesLabel: `${estimate.bytes}`,
      fileCount: estimate.fileCount,
      availableBytes: validation.availableBytes,
      error: "目标磁盘可用空间不足。",
    };
  }
  return {
    ok: true,
    sourceRoot,
    targetRoot,
    estimatedBytes: estimate.bytes,
    estimatedBytesLabel: String(estimate.bytes),
    fileCount: estimate.fileCount,
    availableBytes: validation.availableBytes,
  };
}

function touchJob(job: MigrationJob, patch: Partial<MigrationJob>): MigrationJob {
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  activeJob = next;
  return next;
}

async function copyBundle(params: {
  sourceRoot: string;
  stagingRoot: string;
  includeCache: boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<void> {
  const sources = resolveMigrationAbsolutePaths(params.sourceRoot, {
    includeCache: params.includeCache,
  });
  await fs.mkdir(params.stagingRoot, { recursive: true });
  const total = sources.length;
  for (let index = 0; index < sources.length; index += 1) {
    const src = sources[index];
    const rel = path.relative(params.sourceRoot, src);
    const dest = path.join(params.stagingRoot, rel);
    try {
      await fs.access(src);
    } catch {
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true, force: true });
    const percent = Math.round(((index + 1) / total) * 70);
    params.onProgress(percent, `正在复制 ${rel || path.basename(src)}…`);
  }
}

async function verifyBundle(
  stagingRoot: string,
  sourceRoot: string,
  includeCache: boolean,
): Promise<void> {
  const sourceEstimate = estimateMigrationBundleSize(sourceRoot, { includeCache });
  const stagingEstimate = estimateMigrationBundleSize(stagingRoot, { includeCache });
  if (stagingEstimate.bytes < sourceEstimate.bytes * 0.9) {
    throw new Error("迁移校验失败：目标数据量明显小于源数据。");
  }
}

async function promoteStagingToTarget(stagingRoot: string, targetRoot: string): Promise<void> {
  await fs.mkdir(targetRoot, { recursive: true });
  const entries = await fs.readdir(stagingRoot, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(stagingRoot, entry.name);
    const to = path.join(targetRoot, entry.name);
    await fs.cp(from, to, { recursive: true, force: true });
  }
}

function buildMigratedConfig(cfg: OpenBotConfig, targetRoot: string): OpenBotConfig {
  const previousRoot = resolveDataRoot(cfg);
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const workspace = path.join(targetRoot, "agents", defaultAgentId, "workspace");
  const expiresAt = new Date(Date.now() + PREVIOUS_ROOT_RETENTION_MS).toISOString();
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        workspace,
      },
    },
    data: {
      ...cfg.data,
      root: targetRoot,
      cacheDir: path.join(targetRoot, "cache"),
      mode: "local",
      schemaVersion: cfg.data?.schemaVersion ?? 1,
      previousRoot,
      previousRootExpiresAt: expiresAt,
    },
  };
}

export async function startMigration(params: {
  targetPath: string;
  includeCache?: boolean;
  cfg?: OpenBotConfig;
}): Promise<MigrationJob> {
  if (activeJob && !["done", "failed", "cancelled", "idle"].includes(activeJob.phase)) {
    throw new Error("已有迁移任务正在运行。");
  }
  const preflight = await preflightMigration(params);
  if (!preflight.ok || !preflight.targetRoot) {
    throw new Error(preflight.error ?? "迁移预检失败。");
  }
  const cfg = loadConfig();
  const sourceRoot = preflight.sourceRoot;
  const targetRoot = preflight.targetRoot;
  const stagingRoot = path.join(path.dirname(targetRoot), STAGING_DIRNAME);

  let job: MigrationJob = {
    id: `migrate-${Date.now()}`,
    phase: "preflight_check",
    sourceRoot,
    targetRoot,
    stagingRoot,
    includeCache: params.includeCache === true,
    progressPercent: 5,
    message: "预检完成，准备复制…",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    previousConfigRoot: sourceRoot,
  };
  activeJob = job;

  try {
    job = touchJob(job, { phase: "copy_bundle", progressPercent: 10, message: "正在复制数据…" });
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await copyBundle({
      sourceRoot,
      stagingRoot,
      includeCache: job.includeCache,
      onProgress: (percent, message) => {
        job = touchJob(job, { progressPercent: percent, message });
      },
    });

    job = touchJob(job, { phase: "verify_bundle", progressPercent: 75, message: "正在校验…" });
    await verifyBundle(stagingRoot, sourceRoot, job.includeCache);

    job = touchJob(job, { phase: "switch_config", progressPercent: 85, message: "正在切换配置…" });
    await promoteStagingToTarget(stagingRoot, targetRoot);
    ensureDataSpace({ root: targetRoot, mode: "local" });
    const nextCfg = buildMigratedConfig(cfg, targetRoot);
    await writeConfigFile(nextCfg);

    job = touchJob(job, {
      phase: "postflight_doctor",
      progressPercent: 95,
      message: "正在完成收尾…",
    });
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);

    job = touchJob(job, {
      phase: "done",
      progressPercent: 100,
      message: `数据已迁移至 ${targetRoot}`,
    });
    return job;
  } catch (err) {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    job = touchJob(job, {
      phase: "failed",
      error: String(err),
      message: "迁移失败，已回滚到原路径。",
    });
    return job;
  }
}

export async function cancelMigration(): Promise<MigrationJob | null> {
  if (!activeJob) {
    return null;
  }
  await fs.rm(activeJob.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  activeJob = touchJob(activeJob, {
    phase: "cancelled",
    message: "迁移已取消。",
  });
  return { ...activeJob };
}
