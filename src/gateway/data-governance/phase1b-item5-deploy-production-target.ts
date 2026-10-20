/**
 * Item 5: resolve and validate a single explicit production state target.
 * Registry + Catalog must share the same stateDir. Does not flip flags.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStateDir } from "../../config/paths.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";

export const PRODUCTION_STATE_DIR_ENV = "OPENBOT_PRODUCTION_STATE_DIR";
export const PRODUCTION_EXECUTION_MODE_ENV = "OPENBOT_PRODUCTION_EXECUTION_MODE";
export const PRODUCTION_ON_GATEWAY_HOST_ENV = "OPENBOT_PRODUCTION_ON_GATEWAY_HOST";

const REGISTRY_FILE = "openbot-agent-registry.json";

export type ProductionWriteTargetErrorCode =
  | "production_write_target_unconfigured"
  | "production_write_target_rejected"
  | "production_write_target_inconsistent"
  | "production_write_target_filesystem";

export class ProductionWriteTargetError extends Error {
  readonly code: ProductionWriteTargetErrorCode;

  constructor(code: ProductionWriteTargetErrorCode, message: string) {
    super(message);
    this.name = "ProductionWriteTargetError";
    this.code = code;
  }
}

export type ProductionDeployTarget = {
  stateDir: string;
  registryStorePath: string;
  catalogPath: string;
};

function resolveEvidenceStateDirs(): Set<string> {
  const evidenceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../docs/design/evidence",
  );
  const dirs = new Set<string>([
    path.resolve(evidenceRoot, "memory-workspace-phase1b-item5-runtime-state"),
  ]);
  for (const dir of dirs) {
    dirs.add(path.resolve(resolveDataGovernanceCatalogPath(dir), "..", ".."));
  }
  return dirs;
}

function isEvidenceStateDir(stateDir: string): boolean {
  const resolved = path.resolve(stateDir);
  for (const evidenceDir of resolveEvidenceStateDirs()) {
    if (resolved === evidenceDir || resolved.startsWith(`${evidenceDir}${path.sep}`)) {
      return true;
    }
  }
  return resolved.includes(`${path.sep}docs${path.sep}design${path.sep}evidence${path.sep}`);
}

export function resolveRegistryStorePathForStateDir(stateDir: string): string {
  return path.join(path.resolve(stateDir), REGISTRY_FILE);
}

export function resolveProductionDeployTarget(
  env: NodeJS.ProcessEnv = process.env,
): ProductionDeployTarget {
  const explicit = env[PRODUCTION_STATE_DIR_ENV]?.trim();
  if (!explicit) {
    throw new ProductionWriteTargetError(
      "production_write_target_unconfigured",
      "production_write_target_unconfigured",
    );
  }

  const mode = env[PRODUCTION_EXECUTION_MODE_ENV]?.trim();
  if (mode !== "production") {
    throw new ProductionWriteTargetError(
      "production_write_target_rejected",
      "production_execution_mode_must_be_production",
    );
  }

  const stateDir = path.resolve(explicit);
  if (!stateDir || stateDir === path.parse(stateDir).root) {
    throw new ProductionWriteTargetError(
      "production_write_target_rejected",
      "production_state_dir_invalid",
    );
  }

  if (isEvidenceStateDir(stateDir)) {
    throw new ProductionWriteTargetError(
      "production_write_target_rejected",
      "production_state_dir_evidence_forbidden",
    );
  }

  const processStateDir = path.resolve(resolveStateDir(env));
  const onGatewayHost = env[PRODUCTION_ON_GATEWAY_HOST_ENV]?.trim() === "1";
  if (stateDir === processStateDir && !onGatewayHost) {
    throw new ProductionWriteTargetError(
      "production_write_target_rejected",
      "production_state_dir_dev_implicit_forbidden",
    );
  }

  const registryStorePath = resolveRegistryStorePathForStateDir(stateDir);
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  const registryParent = path.resolve(path.dirname(registryStorePath));
  const catalogParent = path.resolve(path.dirname(catalogPath));
  if (registryParent !== catalogParent && registryParent !== stateDir) {
    throw new ProductionWriteTargetError(
      "production_write_target_inconsistent",
      "production_registry_catalog_state_dir_inconsistent",
    );
  }

  return { stateDir, registryStorePath, catalogPath };
}

export function classifyProductionWriteTargetError(
  error: unknown,
): ProductionWriteTargetErrorCode | "unknown" {
  if (error instanceof ProductionWriteTargetError) {
    return error.code;
  }
  if (error instanceof Error) {
    if (error.message === "production_write_target_unconfigured") {
      return "production_write_target_unconfigured";
    }
    if (
      error.message.startsWith("production_state_dir_") ||
      error.message.startsWith("production_execution_mode_") ||
      error.message === "production_write_target_rejected"
    ) {
      return "production_write_target_rejected";
    }
    if (error.message.includes("inconsistent")) {
      return "production_write_target_inconsistent";
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "EROFS") {
      return "production_write_target_filesystem";
    }
  }
  return "unknown";
}

export function assertProductionDeployTargetFilesystemReady(target: ProductionDeployTarget): void {
  try {
    fs.mkdirSync(path.dirname(target.catalogPath), { recursive: true });
    fs.accessSync(target.stateDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new ProductionWriteTargetError(
      "production_write_target_filesystem",
      error instanceof Error ? error.message : "production_state_dir_filesystem_unavailable",
    );
  }
}

export type ProductionWriteTargetStatus =
  | { reachable: true; target: ProductionDeployTarget }
  | { reachable: false; code: ProductionWriteTargetErrorCode | "unknown"; message: string };

export function inspectProductionWriteTarget(
  env: NodeJS.ProcessEnv = process.env,
): ProductionWriteTargetStatus {
  try {
    const target = resolveProductionDeployTarget(env);
    assertProductionDeployTargetFilesystemReady(target);
    return { reachable: true, target };
  } catch (error) {
    return {
      reachable: false,
      code: classifyProductionWriteTargetError(error),
      message: error instanceof Error ? error.message : "production_write_target_unknown",
    };
  }
}

/** @deprecated use inspectProductionWriteTarget */
export function productionWriteTargetReachable(env: NodeJS.ProcessEnv = process.env): boolean {
  return inspectProductionWriteTarget(env).reachable;
}

/** @deprecated use resolveProductionDeployTarget */
export function assertProductionStateDirNotLocalHost(stateDir: string): void {
  const env = {
    ...process.env,
    [PRODUCTION_STATE_DIR_ENV]: stateDir,
    [PRODUCTION_EXECUTION_MODE_ENV]: "production",
    [PRODUCTION_ON_GATEWAY_HOST_ENV]: "1",
  };
  resolveProductionDeployTarget(env);
}

/** @deprecated use resolveProductionDeployTarget */
export function resolveProductionWriteTarget(env: NodeJS.ProcessEnv = process.env) {
  const target = resolveProductionDeployTarget(env);
  return { kind: "state_dir" as const, stateDir: target.stateDir };
}
