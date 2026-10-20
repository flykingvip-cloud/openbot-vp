/**
 * P0.0b / P0.1 — CollaborationEventKey (Floor Runtime v2.1 §2.4 / §5.2 / §5.3).
 *
 * `eventKeyOf` accepts RuntimeAuthority (P0.1) or the minimal carrier kept for
 * callers that only have a snapshot + ids.
 */
import type { RoundPolicySnapshot } from "./round-policy-snapshot.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

export type CollaborationEventKey = Readonly<{
  tenantId: string | null;
  groupId: string;
  episodeId: string;
  beatId: string | null;
  policySnapshotId: string;
  policyHash: string;
  compilerRevision: string;
}>;

/** Minimal carrier for eventKeyOf when a full RuntimeAuthority is not available. */
export type EventKeyAuthorityCarrier = Readonly<{
  tenantId: string | null;
  groupId: string;
  episodeId: string;
  policy: Pick<RoundPolicySnapshot, "policySnapshotId" | "policyHash" | "compilerRevision">;
}>;

/** episodeId = "ep_" + clientRunId (legacy single-beat, §2.4). */
export function episodeIdForClientRun(clientRunId: string): string {
  const id = clientRunId.trim();
  if (!id) {
    throw new Error("collaboration event key: clientRunId is required");
  }
  return id.startsWith("ep_") ? id : `ep_${id}`;
}

/** beatId = episodeId + ":b" + n. Beat 0 keeps roundId === clientRunId. */
export function beatIdForEpisode(episodeId: string, beatIndex: number = 0): string {
  const n = Math.max(0, Math.floor(beatIndex));
  return `${episodeId}:b${n}`;
}

export function eventKeyOf(
  authority: RuntimeAuthority | EventKeyAuthorityCarrier,
  beatId: string | null,
): CollaborationEventKey {
  return {
    tenantId: authority.tenantId,
    groupId: authority.groupId,
    episodeId: authority.episodeId,
    beatId,
    policySnapshotId: authority.policy.policySnapshotId,
    policyHash: authority.policy.policyHash,
    compilerRevision: authority.policy.compilerRevision,
  };
}

export function buildCollaborationEventKey(params: {
  tenantId?: string | null;
  groupId: string;
  episodeId: string;
  beatId?: string | null;
  snapshot: RoundPolicySnapshot;
}): CollaborationEventKey {
  return eventKeyOf(
    {
      tenantId: params.tenantId ?? null,
      groupId: params.groupId,
      episodeId: params.episodeId,
      policy: params.snapshot,
    },
    params.beatId === undefined ? null : params.beatId,
  );
}

/** True when all 7 required key fields are present and non-empty (except nullable ones). */
export function isCompleteCollaborationEventKey(
  key: CollaborationEventKey | null | undefined,
): key is CollaborationEventKey {
  if (!key) {
    return false;
  }
  return (
    typeof key.groupId === "string" &&
    key.groupId.length > 0 &&
    typeof key.episodeId === "string" &&
    key.episodeId.length > 0 &&
    typeof key.policySnapshotId === "string" &&
    key.policySnapshotId.length > 0 &&
    typeof key.policyHash === "string" &&
    key.policyHash.length > 0 &&
    typeof key.compilerRevision === "string" &&
    key.compilerRevision.length > 0 &&
    (key.tenantId === null || typeof key.tenantId === "string") &&
    (key.beatId === null || typeof key.beatId === "string")
  );
}
