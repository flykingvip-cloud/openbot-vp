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
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { relocateTenantsVolumeUserPath } from "../workspace/operator-workspace-heal.js";
import {
  resolveCanonicalRobotWriteRoot,
  seatOwnedWriteOwnership,
  type CanonicalWriteOwnership,
} from "./canonical-write-root.js";
import { resolveRobotWriteRoot } from "./write-roots.js";

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

/**
 * Remount tenants/<tid>/users/<u>/… onto operators/<u>/… under shared
 * addressing so write cwd and preview Locator agree. Idempotent for operators
 * and collaboration/group paths (no users/ segment).
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
  return path.resolve(relocateTenantsVolumeUserPath(resolved, env));
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
