import type { GatewayCollaborationOperatingPhase } from "../collaboration-learning/operating-state-types.js";
import type {
  GatewayCollaborationSpaceSnapshot,
  GatewayCollaborationSpacesListResult,
} from "../collaboration-learning/snapshot-types.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning/space-store.js";

/** Why a collaboration space needs the actor right now (derived from phase). */
export type WorkbenchUpcomingCollaborationKind = "decision" | "review" | "response";

export type WorkbenchUpcomingCollaborationItem = {
  /** Collaboration group id. */
  id: string;
  title: string;
  /** decision (decide phase) / review (review phase) / response (other phases). */
  kind: WorkbenchUpcomingCollaborationKind;
  phase: GatewayCollaborationOperatingPhase;
  /** Operating-state summary line, when present. */
  summary?: string;
  updatedAtMs?: number;
};

export type WorkbenchUpcomingCollaborationResult = {
  /** Spaces in the actor's scope currently waiting for a human response. */
  needsResponseCount: number;
  /** Waiting spaces whose current phase is a decision. */
  decisionCount: number;
  /** Waiting spaces whose current phase is a review. */
  reviewCount: number;
  /** Spaces the actor is in that are active (in-progress) but NOT waiting on a human. */
  activeCount: number;
  items: WorkbenchUpcomingCollaborationItem[];
};

/**
 * Injected data source — default reads the real collaboration space store; tests
 * override it. Deterministic (no LLM).
 */
export type WorkbenchUpcomingCollaborationDeps = {
  listSpaces: () => Promise<GatewayCollaborationSpacesListResult>;
};

export type WorkbenchUpcomingCollaborationParams = {
  userId: string;
  userEmail?: string | null;
  /** Group/space ids the actor owns or is seated in (employee seat scope). */
  seatSpaceIds?: string[];
  /** Max items returned (counts are NOT capped). */
  limit?: number;
  deps?: Partial<WorkbenchUpcomingCollaborationDeps>;
};

const DEFAULT_ITEM_LIMIT = 12;
const KIND_PRIORITY: Record<WorkbenchUpcomingCollaborationKind, number> = {
  decision: 0,
  review: 1,
  response: 2,
};

function defaultDeps(): WorkbenchUpcomingCollaborationDeps {
  return { listSpaces: () => listGatewayCollaborationSpaces() };
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isArchivedSpace(space: GatewayCollaborationSpaceSnapshot): boolean {
  return normalizeIdentity(space.operatingState?.groupProfile?.lifecycleStatus) === "archived";
}

/** A space is in the actor's scope if it is seat-granted/owned, or the actor is
 * an active human member of it (mirrors pending-tasks-read-model scoping). */
function actorBelongsToSpace(
  space: GatewayCollaborationSpaceSnapshot,
  seatSpaceIdSet: Set<string>,
  actorIdentities: Set<string>,
): boolean {
  const groupIdentity =
    normalizeIdentity(space.groupId) || normalizeIdentity(space.id.replace(/^space:/, ""));
  if (groupIdentity && seatSpaceIdSet.has(groupIdentity)) {
    return true;
  }
  for (const human of space.members?.humans ?? []) {
    const status = normalizeIdentity(human.status);
    if (status === "removed" || status === "revoked") {
      continue;
    }
    if (actorIdentities.has(normalizeIdentity(human.userId))) {
      return true;
    }
  }
  return false;
}

function phaseToKind(
  phase: GatewayCollaborationOperatingPhase,
): WorkbenchUpcomingCollaborationKind {
  if (phase === "decide") {
    return "decision";
  }
  if (phase === "review") {
    return "review";
  }
  return "response";
}

/**
 * Deterministic "upcoming collaboration" projection for the employee home 即将协作
 * card (M3). Surfaces the collaboration spaces in the actor's scope that are
 * currently waiting for a human response (operating-state `waitingForHuman`),
 * categorized by phase (decide → decision, review → review, else → response).
 * Spaces the actor is in that are active but NOT waiting are counted separately
 * (`activeCount`) for context. Scope is bounded by the actor's seat spaces /
 * active human membership, so a brand-new member with no spaces resolves to zero.
 *
 * NOTE: an "unread messages" signal is intentionally out of scope here — the
 * operating-state snapshot carries no per-user unread counter; that would need a
 * separate session-unread source and is deferred.
 */
export async function buildWorkbenchUpcomingCollaboration(
  params: WorkbenchUpcomingCollaborationParams,
): Promise<WorkbenchUpcomingCollaborationResult> {
  const deps = { ...defaultDeps(), ...params.deps };
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_ITEM_LIMIT, 100));
  const seatSpaceIdSet = new Set(
    (params.seatSpaceIds ?? []).map((id) => normalizeIdentity(id)).filter(Boolean),
  );
  const actorIdentities = new Set(
    [params.userId, params.userEmail].map((value) => normalizeIdentity(value)).filter(Boolean),
  );

  let spaces: GatewayCollaborationSpaceSnapshot[] = [];
  try {
    const result = await deps.listSpaces();
    spaces = result.spaces ?? [];
  } catch {
    spaces = [];
  }

  const items: WorkbenchUpcomingCollaborationItem[] = [];
  let activeCount = 0;
  for (const space of spaces) {
    if (isArchivedSpace(space)) {
      continue;
    }
    if (!actorBelongsToSpace(space, seatSpaceIdSet, actorIdentities)) {
      continue;
    }
    const activeContext = space.operatingState?.activeContext;
    if (!activeContext) {
      continue;
    }
    if (activeContext.waitingForHuman) {
      const phase = activeContext.currentOperatingPhase;
      items.push({
        id: space.groupId,
        title: space.title || space.groupId,
        kind: phaseToKind(phase),
        phase,
        summary: activeContext.summary?.trim() || undefined,
        updatedAtMs: activeContext.updatedAtMs,
      });
    } else {
      // In the actor's scope and not archived, but not waiting on a human.
      activeCount += 1;
    }
  }

  const decisionCount = items.filter((item) => item.kind === "decision").length;
  const reviewCount = items.filter((item) => item.kind === "review").length;
  // Surface the most urgent first (decision > review > response), then recency.
  const sortedItems = items
    .toSorted((left, right) => {
      const priorityDelta = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0);
    })
    .slice(0, limit);

  return {
    needsResponseCount: items.length,
    decisionCount,
    reviewCount,
    activeCount,
    items: sortedItems,
  };
}
