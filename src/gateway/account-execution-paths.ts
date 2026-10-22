/**
 * Account execution paths (Account Computer v4.1 P0 paths, P1 closure).
 *
 * Thin wrapper over the existing data-root, runtime-state, and robot-own
 * resolvers. It does not introduce a second data space, account id, or
 * computer id. Leaf names (`browser`, `artifacts`) sit under those roots.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureSandboxRuntimeOwnership,
  type SandboxOwnershipOptions,
} from "../agents/sandbox/sandbox-runtime-ownership.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import type { OpenBotConfig } from "../config/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { CONFIG_DIR } from "../utils.js";
import type { TenantContext } from "./tenant-context.js";
import {
  resolveDataRootForContext,
  resolveTenantAgentDirForContext,
  resolveTenantRuntimeStateRootForContext,
} from "./tenant-store-paths.js";
import { alignFormalRootForManagedAddressing } from "./workspace-resolver/formal-deliverable-root.js";
import { resolveRobotOwnWriteRoot } from "./workspace-resolver/write-roots.js";
import {
  copyMissingOperatorWorkspace,
  relocateTenantsVolumeUserPath,
} from "./workspace/operator-workspace-heal.js";

export type AccountExecutionPaths = {
  dataRoot: string;
  stateRoot: string;
  /** Current agent workspace. The only robot write root for this agent. */
  workspaceDir: string;
  /** Current agent artifacts (downloads and generated files). */
  artifactsDir: string;
  /**
   * User-level download root shared by every agent of this account.
   * The Account Computer browser mounts this directory, not `artifactsDir`.
   */
  sharedArtifactsDir: string;
  /** One browser profile directory per tenantId + userId. */
  browserProfileDir: string;
  /** Credential dir. Exec mounts must not include it. */
  credentialDir: string;
  /** `users/<uid>` itself. Must not be mounted whole. */
  userRoot: string;
  dataSpaceRef: string;
  browserNamespaceRef: string;
};

/** Browser profile directory under the L3 runtime state root. */
export function resolveAccountBrowserProfileDirForContext(
  ctx: TenantContext,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(resolveTenantRuntimeStateRootForContext(ctx, env), "browser");
}

const log = createSubsystemLogger("gateway/account-execution");

function resolveRawAccountExecutionPaths(params: {
  ctx: TenantContext;
  cfg: OpenBotConfig | undefined;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): AccountExecutionPaths {
  const agentId = normalizeAgentId(params.agentId);
  const dataRoot = resolveDataRootForContext(params.ctx, params.cfg);
  const stateRoot = resolveTenantRuntimeStateRootForContext(params.ctx, params.env);
  const browserProfileDir = resolveAccountBrowserProfileDirForContext(params.ctx, params.env);
  const workspaceDir = resolveRobotOwnWriteRoot({
    tenantId: params.ctx.tenantId,
    userId: params.ctx.userId,
    agentId,
    dataRoot,
  });
  const artifactsDir = path.join(path.dirname(workspaceDir), "artifacts");
  const sharedArtifactsDir = path.join(dataRoot, "artifacts");
  return {
    dataRoot,
    stateRoot,
    workspaceDir,
    artifactsDir,
    sharedArtifactsDir,
    browserProfileDir,
    credentialDir: resolveTenantAgentDirForContext(params.ctx, agentId, params.env),
    userRoot: path.dirname(dataRoot),
    dataSpaceRef: dataRoot,
    browserNamespaceRef: browserProfileDir,
  };
}

function relocateAccountExecutionPaths(
  raw: AccountExecutionPaths,
  env: NodeJS.ProcessEnv,
  cfg?: OpenBotConfig,
): AccountExecutionPaths {
  const move = (target: string) => relocateTenantsVolumeUserPath(target, env);
  return {
    dataRoot: move(raw.dataRoot),
    stateRoot: move(raw.stateRoot),
    // Same formal root as settle and preview. relocate alone misses a
    // state-dir tenants formula that is not under OPENBOT_TENANTS_ROOT.
    workspaceDir: alignFormalRootForManagedAddressing(raw.workspaceDir, { config: cfg, env }),
    artifactsDir: move(raw.artifactsDir),
    sharedArtifactsDir: move(raw.sharedArtifactsDir),
    browserProfileDir: move(raw.browserProfileDir),
    credentialDir: move(raw.credentialDir),
    userRoot: move(raw.userRoot),
    dataSpaceRef: move(raw.dataSpaceRef),
    browserNamespaceRef: move(raw.browserNamespaceRef),
  };
}

export function resolveAccountExecutionPaths(params: {
  ctx: TenantContext;
  cfg: OpenBotConfig | undefined;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): AccountExecutionPaths {
  const raw = resolveRawAccountExecutionPaths(params);
  const env = params.env ?? process.env;
  if (!isSharedTenantAddressingEnabled(params.cfg, env)) {
    return raw;
  }
  return relocateAccountExecutionPaths(raw, env, params.cfg);
}

function pathSegments(absPath: string): string[] {
  return path
    .resolve(absPath)
    .split(path.sep)
    .filter((segment) => segment.length > 0);
}

/** True when `absPath` is the global host browser tree (`<config>/browser/...`). */
function isConfigBrowserTree(absPath: string): boolean {
  const configParts = pathSegments(CONFIG_DIR);
  const parts = pathSegments(absPath);
  if (parts.length < configParts.length + 1) {
    return false;
  }
  for (let i = 0; i < configParts.length; i += 1) {
    if (parts[i] !== configParts[i]) {
      return false;
    }
  }
  return parts[configParts.length] === "browser";
}

/**
 * Retired multitenant write targets from v4.1 §4.
 * Canonical `OpenBot/agents/<id>/workspace` is not retired.
 */
export function isRetiredMultitenantWritePath(absPath: string): boolean {
  const parts = pathSegments(absPath);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] !== "OpenBot") {
      continue;
    }
    const next = parts[i + 1] ?? "";
    if (next === "workspace" || next.startsWith("workspace-")) {
      return true;
    }
  }
  for (let i = 0; i < parts.length - 4; i += 1) {
    if (
      parts[i] === "agents" &&
      parts[i + 1] === "main" &&
      parts[i + 2] === "employees" &&
      parts[i + 4] === "workspace"
    ) {
      return true;
    }
  }
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]?.startsWith("workspace-")) {
      continue;
    }
    const openBot = parts.indexOf("OpenBot");
    const agents = parts.indexOf("agents");
    if (openBot >= 0 && agents === openBot + 1 && i > agents) {
      continue;
    }
    return true;
  }
  return isConfigBrowserTree(absPath);
}

export function assertAccountProductionWriteAllowed(
  targetPath: string,
  cfg?: OpenBotConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isSharedTenantAddressingEnabled(cfg, env)) {
    return;
  }
  if (isRetiredMultitenantWritePath(targetPath)) {
    throw new Error(`production write refused on retired root: ${targetPath}`);
  }
}

/**
 * Create the current agent's workspace, artifacts, and browser profile.
 * Does not copy shared skills. Refuses retired roots when shared addressing is on.
 */
export async function ensureAccountProductionDirectories(params: {
  ctx: TenantContext;
  cfg: OpenBotConfig | undefined;
  agentId: string;
  env?: NodeJS.ProcessEnv;
  /** Test hook. Production callers omit this and use the image uid 1000. */
  ownership?: SandboxOwnershipOptions;
}): Promise<AccountExecutionPaths> {
  const env = params.env ?? process.env;
  const raw = resolveRawAccountExecutionPaths(params);
  const paths = isSharedTenantAddressingEnabled(params.cfg, env)
    ? relocateAccountExecutionPaths(raw, env, params.cfg)
    : raw;
  if (path.resolve(paths.workspaceDir) !== path.resolve(raw.workspaceDir)) {
    try {
      await copyMissingOperatorWorkspace(raw.workspaceDir, paths.workspaceDir, params.ownership);
    } catch (err) {
      log.warn("operator workspace copy failed; write target stays on the operator root", {
        error: err instanceof Error ? err.message : "copy_failed",
      });
    }
  }
  assertAccountProductionWriteAllowed(paths.workspaceDir, params.cfg, env);
  assertAccountProductionWriteAllowed(paths.artifactsDir, params.cfg, env);
  assertAccountProductionWriteAllowed(paths.sharedArtifactsDir, params.cfg, env);
  assertAccountProductionWriteAllowed(paths.browserProfileDir, params.cfg, env);
  await fs.mkdir(paths.workspaceDir, { recursive: true });
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  await fs.mkdir(paths.sharedArtifactsDir, { recursive: true });
  await fs.mkdir(paths.browserProfileDir, { recursive: true });
  // Exec mounts workspace + artifacts. Browser mounts state/browser + shared artifacts.
  // Account Worker containers run as the image user, not the root gateway.
  // These are the inodes the host engine must bind (state dir as well as tenants).
  await ensureSandboxRuntimeOwnership(
    [paths.workspaceDir, paths.artifactsDir, paths.sharedArtifactsDir, paths.browserProfileDir],
    params.ownership,
  );
  return paths;
}

/**
 * Shared skills stay read-only mounts. They are not copied into a user tree.
 * Matches `<tenantsRoot>/<tid>/users/<uid>`, `stateDir/tenants/<tid>/users/<uid>`,
 * and the operator SoT `$STATE_DIR/operators/<uid>/OpenBot|state`.
 */
export function assertSharedSkillsNotCopiedIntoUserTree(targetDir: string): void {
  const parts = pathSegments(targetDir);
  for (let i = 0; i < parts.length - 2; i += 1) {
    const inTenantUsers = parts[i] === "tenants" && parts[i + 2] === "users";
    const userDataLeaf =
      parts[i] === "users" && (parts[i + 2] === "OpenBot" || parts[i + 2] === "state");
    const operatorLeaf =
      parts[i] === "operators" && (parts[i + 2] === "OpenBot" || parts[i + 2] === "state");
    if (inTenantUsers || userDataLeaf || operatorLeaf) {
      throw new Error(
        "Shared skills are read-only mounts and are not copied into user directories.",
      );
    }
  }
}
