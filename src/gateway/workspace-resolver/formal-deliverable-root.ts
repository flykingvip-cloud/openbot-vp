/**
 * Formal deliverable root resolver (PR A).
 *
 * Invariant: write and preview share one binding + relative path for
 * personal / seat / group. `group-file.read` / `steward-file.read` are read
 * entrypoints over that same root — not alternate storage.
 *
 * Missing or conflicting formal bindings fail closed (no silent operators
 * fallback onto the chatting user).
 */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { normalizeOperatorId } from "../../config/operator-state-scope.js";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTenantsRoot } from "../tenant-store-paths.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { relocateTenantsVolumeUserPath } from "../workspace/operator-workspace-heal.js";
import {
  resolveCanonicalRobotWriteRoot,
  seatOwnedWriteOwnership,
  type CanonicalWriteOwnership,
} from "./canonical-write-root.js";
import {
  resolvePlacedFilesystemWriteRoot,
  resolveRobotOwnWriteRoot,
  resolveRobotWriteRoot,
} from "./write-roots.js";

export type FormalResourceKind = "personal" | "seat" | "group";

export type FormalResourceIdentity =
  | { kind: "personal"; ownerUserId: string; agentId: string }
  | {
      kind: "seat";
      seatId: string;
      agentId: string;
      stickyLocator?: string | null;
      hostUserId?: string | null;
      agentAssetId?: string;
    }
  | { kind: "group"; groupId: string };

export type FormalDeliverableRootSuccess = {
  ok: true;
  kind: FormalResourceKind;
  rootPath: string;
  /** Stable binding label for audits (not a catalog id when catalog absent). */
  bindingId: string;
  resourceIdentity: string;
};

export type FormalDeliverableRootFailure = {
  ok: false;
  kind?: FormalResourceKind;
  code: "missing_binding" | "invalid_identity" | "unresolvable" | "conflict";
  reason: string;
};

export type FormalDeliverableRootResult =
  | FormalDeliverableRootSuccess
  | FormalDeliverableRootFailure;

type BotWorkspaceShape = {
  shape: "operators" | "tenants";
  userId: string;
  agentId: string;
};

/**
 * Classify a bot workspace root. Group / collaboration paths are not bot
 * spaces and stay untouched. Only the workspace directory itself matches —
 * a file nested under it does not, so align cannot collapse a file path.
 */
function classifyBotWorkspaceRoot(absPath: string): BotWorkspaceShape | null {
  const parts = path
    .resolve(absPath)
    .split(path.sep)
    .filter((part) => part.length > 0);
  if (parts.at(-1) !== "workspace") {
    return null;
  }
  for (let i = 0; i < parts.length - 5; i += 1) {
    if (
      parts[i] === "operators" &&
      parts[i + 2] === "OpenBot" &&
      parts[i + 3] === "agents" &&
      parts[i + 5] === "workspace" &&
      i + 5 === parts.length - 1
    ) {
      const userId = parts[i + 1] ?? "";
      const agentId = parts[i + 4] ?? "";
      if (!userId || !agentId) {
        return null;
      }
      return { shape: "operators", userId, agentId };
    }
  }
  for (let i = 0; i < parts.length - 7; i += 1) {
    if (
      parts[i] === "tenants" &&
      parts[i + 2] === "users" &&
      parts[i + 4] === "OpenBot" &&
      parts[i + 5] === "agents" &&
      parts[i + 7] === "workspace" &&
      i + 7 === parts.length - 1
    ) {
      const userId = parts[i + 3] ?? "";
      const agentId = parts[i + 6] ?? "";
      if (!userId || !agentId) {
        return null;
      }
      return { shape: "tenants", userId, agentId };
    }
  }
  return null;
}

/** `$STATE_DIR/operators/<user>/OpenBot/agents/<agent>/workspace`. */
function operatorsFormalRoot(
  userId: string,
  agentId: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const operatorId = normalizeOperatorId(userId);
  if (!operatorId) {
    return null;
  }
  return path.resolve(
    resolveStateDir(env),
    "operators",
    operatorId,
    "OpenBot",
    "agents",
    normalizeAgentId(agentId),
    "workspace",
  );
}

/**
 * Env copy that pins OPENBOT_STATE_DIR when the caller has an explicit state
 * directory (tests, per-request state). Does not mutate `base`.
 */
export function formalAddressingEnv(
  stateDir?: string | null,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const trimmed = stateDir?.trim();
  if (!trimmed || base.OPENBOT_STATE_DIR === trimmed) {
    return base;
  }
  return { ...base, OPENBOT_STATE_DIR: trimmed };
}

/**
 * Remount a bot workspace onto the single formal root.
 *
 * When managed shared addressing is on, both path shapes of one
 * `(tenant, user, agent)` — the tenants volume AND `$STATE_DIR/tenants/…` —
 * resolve to `$STATE_DIR/operators/<user>/OpenBot/agents/<agent>/workspace`.
 * `relocateTenantsVolumeUserPath` only rewrites paths under OPENBOT_TENANTS_ROOT;
 * a state-dir tenants formula outside that volume used to stay put, so settle
 * read an empty tree while tool cwd had already remounted onto operators.
 *
 * Operators paths and collaboration/group paths are unchanged.
 */
export function alignFormalRootForManagedAddressing(
  rootPath: string,
  options?: { config?: OpenBotConfig | null; env?: NodeJS.ProcessEnv },
): string {
  const env = options?.env ?? process.env;
  const resolved = path.resolve(rootPath);
  if (!isSharedTenantAddressingEnabled(options?.config ?? undefined, env)) {
    return resolved;
  }
  const relocated = path.resolve(relocateTenantsVolumeUserPath(resolved, env));
  if (relocated !== resolved) {
    return relocated;
  }
  const shape = classifyBotWorkspaceRoot(resolved);
  if (!shape || shape.shape === "operators") {
    return resolved;
  }
  return operatorsFormalRoot(shape.userId, shape.agentId, env) ?? resolved;
}

/**
 * Other on-disk shapes of the same bot workspace. Read-only skew probe.
 * Never a write target. The formal root itself is omitted.
 */
export function listFormalRootSkewSiblings(params: {
  formalRoot: string;
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  stateDir?: string | null;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = formalAddressingEnv(params.stateDir, params.env ?? process.env);
  const formal = path.resolve(params.formalRoot);
  const classified = classifyBotWorkspaceRoot(formal);
  const userId = params.userId?.trim() || classified?.userId || "";
  const agentId = params.agentId?.trim() || classified?.agentId || "";
  if (!userId || !agentId) {
    return [];
  }
  const stateDir = params.stateDir?.trim() || resolveStateDir(env);
  const tenantId = params.tenantId?.trim() || "";
  const candidates: string[] = [];
  const operators = operatorsFormalRoot(userId, agentId, env);
  if (operators) {
    candidates.push(operators);
  }
  if (tenantId) {
    try {
      candidates.push(
        resolveRobotOwnWriteRoot({
          stateDir,
          tenantId,
          userId,
          agentId,
        }),
      );
    } catch {
      // A user id that cannot form the tenants formula is not a sibling.
    }
    const operatorId = normalizeOperatorId(userId);
    const normalizedAgent = normalizeAgentId(agentId);
    if (operatorId) {
      const volume = path.resolve(resolveTenantsRoot(env));
      candidates.push(
        path.join(
          volume,
          tenantId,
          "users",
          operatorId,
          "OpenBot",
          "agents",
          normalizedAgent,
          "workspace",
        ),
      );
      if (userId !== operatorId) {
        candidates.push(
          path.join(
            volume,
            tenantId,
            "users",
            userId,
            "OpenBot",
            "agents",
            normalizedAgent,
            "workspace",
          ),
        );
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved === formal || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Formal workspace for one bot. When shared addressing is on, this is the
 * operators remount and it does not create the tenants twin.
 */
export function resolveFormalAgentWorkspace(params: {
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  cfg?: OpenBotConfig | null;
  env?: NodeJS.ProcessEnv;
  ensureDirectory?: boolean;
}): { rootPath: string; siblingRoots: string[] } | null {
  const env = formalAddressingEnv(params.stateDir, params.env ?? process.env);
  const cfg = params.cfg ?? undefined;
  const shared = isSharedTenantAddressingEnabled(cfg, env);
  const userId = params.userId?.trim() || "";
  const tenantId = params.tenantId?.trim() || "";
  let root: string | null = null;
  if (shared && userId && tenantId) {
    try {
      const stateDir = params.stateDir?.trim() || resolveStateDir(env);
      const synthetic = resolveRobotOwnWriteRoot({
        stateDir,
        tenantId,
        userId,
        agentId: params.agentId,
      });
      root = alignFormalRootForManagedAddressing(synthetic, { config: cfg, env });
    } catch {
      root = null;
    }
  }
  if (!root) {
    const placed = resolvePlacedFilesystemWriteRoot({
      agentId: params.agentId,
      tenantId: params.tenantId,
      userId: params.userId,
      sessionKey: params.sessionKey,
      stateDir: params.stateDir,
      ensureDirectory: params.ensureDirectory,
    });
    root = placed ? alignFormalRootForManagedAddressing(placed, { config: cfg, env }) : null;
  }
  // A personal-local host may deliberately configure an execution workspace
  // without an employee/tenant placement. Use the same trusted config as the
  // runner; never invent an owner or apply this fallback to managed traffic.
  if (
    !root &&
    cfg &&
    !shared &&
    !tenantId &&
    !userId &&
    resolveSecurityProfile(cfg, env).profile === "personal_local" &&
    listAgentIds(cfg).includes(normalizeAgentId(params.agentId))
  ) {
    root = resolveAgentWorkspaceDir(cfg, params.agentId);
  }
  if (!root) {
    return null;
  }
  if (params.ensureDirectory) {
    fs.mkdirSync(root, { recursive: true });
  }
  return {
    rootPath: root,
    siblingRoots: listFormalRootSkewSiblings({
      formalRoot: root,
      tenantId,
      userId,
      agentId: params.agentId,
      stateDir: params.stateDir,
      env,
    }),
  };
}

function identityLabel(identity: FormalResourceIdentity): string {
  if (identity.kind === "personal") {
    return `personal:${identity.ownerUserId}`;
  }
  if (identity.kind === "seat") {
    return `seat:${identity.seatId}`;
  }
  return `group:${identity.groupId}`;
}

/**
 * Resolve the single formal filesystem root for a resource identity.
 * Callers pass the same relative path to write tools and preview RPCs.
 */
export function resolveFormalDeliverableRoot(params: {
  tenantId?: string | null;
  resourceIdentity: FormalResourceIdentity;
  /** Required for group trusted locator. */
  cfg?: OpenBotConfig | null;
  profile?: "personal_local" | "managed_enterprise";
  stateDir?: string;
  sessionKey?: string | null;
  ensureDirectory?: boolean;
  /** Optional pre-merged seat ownership (catalog sticky). */
  ownership?: CanonicalWriteOwnership;
  env?: NodeJS.ProcessEnv;
}): FormalDeliverableRootResult {
  const identity = params.resourceIdentity;
  const label = identityLabel(identity);

  if (identity.kind === "personal") {
    const owner = identity.ownerUserId.trim();
    const agentId = identity.agentId.trim();
    if (!owner || !agentId) {
      return {
        ok: false,
        kind: "personal",
        code: "invalid_identity",
        reason: "personal formal root requires authenticated ownerUserId and agentId",
      };
    }
    const root = resolveRobotWriteRoot({
      agentId,
      tenantId: params.tenantId,
      userId: owner,
      sessionKey: params.sessionKey,
      stateDir: params.stateDir,
    });
    if (!root) {
      return {
        ok: false,
        kind: "personal",
        code: "unresolvable",
        reason: `personal formal root unresolvable for ${label}`,
      };
    }
    const aligned = alignFormalRootForManagedAddressing(root, {
      config: params.cfg,
      env: params.env,
    });
    if (params.ensureDirectory) {
      fs.mkdirSync(aligned, { recursive: true });
    }
    return {
      ok: true,
      kind: "personal",
      rootPath: aligned,
      bindingId: `formal:${label}:${agentId}`,
      resourceIdentity: label,
    };
  }

  if (identity.kind === "seat") {
    const seatId = identity.seatId.trim();
    const agentId = identity.agentId.trim();
    if (!seatId || !agentId) {
      return {
        ok: false,
        kind: "seat",
        code: "invalid_identity",
        reason: "seat formal root requires seatId and agentId",
      };
    }
    const ownership =
      params.ownership?.kind === "seat_owned"
        ? params.ownership
        : seatOwnedWriteOwnership({
            seatId,
            stickyLocator: identity.stickyLocator,
            hostUserId: identity.hostUserId,
            agentAssetId: identity.agentAssetId ?? agentId,
          });
    const raw = resolveCanonicalRobotWriteRoot({
      agentId,
      tenantId: params.tenantId,
      // Chatting user must not fork the path.
      chattingUserId: null,
      sessionKey: params.sessionKey,
      stateDir: params.stateDir,
      ownership,
      ensureDirectory: false,
    });
    if (!raw) {
      return {
        ok: false,
        kind: "seat",
        code: "missing_binding",
        reason: `seat formal root missing sticky/host binding for ${label}`,
      };
    }
    const aligned = alignFormalRootForManagedAddressing(raw, {
      config: params.cfg,
      env: params.env,
    });
    if (params.ensureDirectory) {
      fs.mkdirSync(aligned, { recursive: true });
    }
    return {
      ok: true,
      kind: "seat",
      rootPath: aligned,
      bindingId: `formal:${label}:${agentId}`,
      resourceIdentity: label,
    };
  }

  const groupId = identity.groupId.trim();
  if (!groupId) {
    return {
      ok: false,
      kind: "group",
      code: "invalid_identity",
      reason: "group formal root requires groupId",
    };
  }
  if (!params.cfg) {
    return {
      ok: false,
      kind: "group",
      code: "unresolvable",
      reason: "group formal root requires cfg for trusted locator",
    };
  }
  const profile = params.profile ?? "personal_local";
  if (profile === "managed_enterprise" && !params.tenantId?.trim()) {
    return {
      ok: false,
      kind: "group",
      code: "missing_binding",
      reason: `group formal root missing tenantId for managed ${label}`,
    };
  }
  let locator: string;
  try {
    locator = resolveTrustedGroupLocator({
      groupId,
      tenantId: params.tenantId?.trim() || null,
      profile,
      cfg: params.cfg,
    });
  } catch (err) {
    return {
      ok: false,
      kind: "group",
      code: "unresolvable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  const aligned = path.resolve(locator);
  if (params.ensureDirectory) {
    fs.mkdirSync(aligned, { recursive: true });
  }
  return {
    ok: true,
    kind: "group",
    rootPath: aligned,
    bindingId: `formal:${label}`,
    resourceIdentity: label,
  };
}

/** Build a workspace-relative formal file ref under a resolved root. */
export function buildFormalFileRef(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Preview must open the same absolute path write used.
 */
export function resolveFormalPreviewAbsolutePath(params: {
  formalRoot: FormalDeliverableRootSuccess;
  relativePath: string;
}): string {
  const rel = buildFormalFileRef(params.relativePath);
  return path.resolve(params.formalRoot.rootPath, rel);
}
