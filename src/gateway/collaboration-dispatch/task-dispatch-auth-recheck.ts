/**
 * U2 — current-authorization recheck before wake / heartbeat dispatch.
 *
 * Lives beside the U1 stop preflight position. Stop check and auth recheck are
 * independent: passing one never substitutes for the other.
 *
 * When a task carries duty binding (responsibility owner/executors) and/or the
 * group has a membership surface, re-read live membership and refuse dispatch
 * if targeted actors are no longer mapped. Paths with neither duty nor
 * membership SoT stay unchanged (no false revoke).
 */
import type { Task } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import {
  hasDeliveryMembershipSurface,
  isMappedDeliveryIdentity,
} from "../collaboration-learning/delivery-actor-binding.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
} from "../collaboration-learning/shared.js";
import { asGovernedTask } from "./task-runtime.js";

export type DispatchAuthRecheckFailure = {
  ok: false;
  reason: "auth_revoked" | "auth_source_unreadable";
  revokedActorIds: string[];
  detail: string;
};

export type DispatchAuthRecheckResult = { ok: true } | DispatchAuthRecheckFailure;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** System / infra actors are not membership-bound delivery identities. */
export function isSystemDispatchActor(actorId: string): boolean {
  const id = compact(actorId).toLowerCase();
  return !id || id.startsWith("system:") || id === "system";
}

function uniqueMappedCandidates(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = compact(raw);
    if (!id || isSystemDispatchActor(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Re-read operating-state membership and (optional) task duty binding.
 * Enforce only when duty binding and/or a membership surface exists.
 */
export async function recheckCurrentDispatchAuthorization(params: {
  groupId: string;
  taskId?: string | null;
  targetActorIds?: readonly string[] | null;
  cfg?: OpenBotConfig;
  /**
   * Test-only: force operating-state membership read to throw.
   * Production callers omit this. Must not be treated as ok:true.
   */
  _testForceOperatingStateReadError?: Error | (() => Error);
}): Promise<DispatchAuthRecheckResult> {
  const groupId = compact(params.groupId);
  if (!groupId) {
    return { ok: true };
  }

  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  let operatingState: Parameters<typeof isMappedDeliveryIdentity>[0] = null;
  try {
    if (params._testForceOperatingStateReadError) {
      const forced = params._testForceOperatingStateReadError;
      throw typeof forced === "function" ? forced() : forced;
    }
    operatingState = await readGroupOperatingState({ fileStore, groupId });
  } catch (err) {
    // Unreadable membership cannot prove revoke OR continued authorization.
    // Fail closed: refuse / unknown — never ok:true (T39/T40 residual).
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "auth_source_unreadable",
      revokedActorIds: [],
      detail: `operating_state_unreadable:${message}`,
    };
  }

  const targetCandidates = uniqueMappedCandidates(params.targetActorIds ?? []);
  const dutyCandidates: string[] = [];
  const taskId = compact(params.taskId);
  if (taskId) {
    try {
      const current = await objectStorage.readObject<Task>(groupId, "task", taskId);
      if (current) {
        const governed = asGovernedTask(current);
        dutyCandidates.push(
          ...uniqueMappedCandidates([
            compact(governed.responsibility?.owner),
            ...(governed.responsibility?.executors ?? []).map((id) => compact(id)),
            compact(governed.ownerMemberId),
          ]),
        );
      }
    } catch {
      // Task read failure: fall through with targets only.
    }
  }

  const membershipSurface = hasDeliveryMembershipSurface(operatingState);
  if (dutyCandidates.length === 0 && !membershipSurface) {
    return { ok: true };
  }

  const candidates =
    dutyCandidates.length > 0
      ? uniqueMappedCandidates([...dutyCandidates, ...targetCandidates])
      : targetCandidates;

  if (candidates.length === 0) {
    return { ok: true };
  }

  const revokedActorIds = candidates.filter((id) => !isMappedDeliveryIdentity(operatingState, id));
  if (revokedActorIds.length > 0) {
    return {
      ok: false,
      reason: "auth_revoked",
      revokedActorIds,
      detail: `dispatch targets not currently mapped: ${revokedActorIds.join(",")}`,
    };
  }
  return { ok: true };
}
