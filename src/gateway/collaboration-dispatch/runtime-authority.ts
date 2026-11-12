import type { CollaborationRole } from "@openbot/collaboration-core";
/**
 * P0.1 — RuntimeAuthority / RuntimeFacts (Floor Runtime v2.1 §2.3 / §5.3, MUST 1).
 *
 * Type system is the first line of defense; lint:collab:runtime-authority is the second.
 * Runtime functions receive RuntimeAuthority + RuntimeFacts (+ input), never
 * CollaborationDispatchScope / OperatingState. P1-A5 lanes cleared all
 * transitional policy bypasses; facts carry only non-policy projections
 * (e.g. coordinatorBotId).
 *
 * Construction is allowed only at composition roots (chat.ts
 * buildGroupRuntimeAuthority, collaboration-learning task RPC, get-reply-run)
 * and in this module.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning/operating-state-types.js";
import type {
  CollaborationTenantResolution,
  CollaborationTenantTrustLevel,
} from "../collaboration-learning/trusted-tenant.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { resolveGovernanceLaneCoordinatorBotId } from "./policy-lane-governance.js";
import { type CollaborationPolicyV1 } from "./policy.js";
import {
  createRoundPolicySnapshotFromScope,
  type DeepReadonly,
  type RoundPolicySnapshot,
} from "./round-policy-snapshot.js";
import {
  buildRuntimeNamespace,
  isCollabRuntimeNamespaceEnabled,
  resolveRuntimeNamespace,
  type RuntimeNamespace,
  type RuntimeNamespaceProfile,
} from "./runtime-namespace.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

const AUTHORITY_BRAND: unique symbol = Symbol.for("openbot.RuntimeAuthority");
const FACTS_BRAND: unique symbol = Symbol.for("openbot.RuntimeFacts");

export type { RuntimeNamespace, RuntimeNamespaceProfile };

/** Doc alias: authority.namespace uses the P0.0a RuntimeNamespace shape. */
export type RuntimeAuthorityNamespace = RuntimeNamespace;

/** Member role row projected onto RuntimeFacts (roster / governance actor lookup). */
export type RuntimeFactsMemberRole = {
  memberId: string;
  memberKind: string;
  label?: string | null;
  governanceRole?: string | null;
  collaborationRole?: CollaborationRole | null;
  status?: string | null;
};

export type RuntimeFacts = DeepReadonly<{
  groupId: string;
  title: string;
  rawSessionKey: string;
  bots: CollaborationBotTarget[];
  humans: Array<{ userId: string; name?: string; handle?: string; email?: string }>;
  /** members.bots snapshot (display roster); duty roles live on roster. */
  memberBots: Array<{ agentId: string; name?: string }>;
  roster: Array<{ agentId: string; displayName: string; dutyRole?: CollaborationRole }>;
  activeContext: {
    currentMission?: string | null;
    summary?: string | null;
    currentOperatingPhase?: string | null;
    currentTaskId?: string | null;
  };
  purpose?: string | null;
  /** groupProfile.currentMission (directed-decision fallback). */
  profileMission?: string | null;
  recentAssistantBotIds: string[];
  /** Task / Handoff blocked agents (legacy name blockedAgentIds). */
  busyAgentIds: string[];
  memberRoleMap: RuntimeFactsMemberRole[];
  /**
   * Standing coordinator bot id resolved at the composition root (P1-A5 ③ BP-15/16).
   * Empty string when none. Not a policy bypass — factual projection of the
   * lane helper's legacy/effective choice at projectRuntimeFacts time.
   *
   * Storage note (P1-A5 final): the id is stored lowercased via
   * `normalizeAgentIdentifier` inside `resolveGovernanceLaneCoordinatorBotId`
   * (see policy-lane-governance.ts). Callers comparing agent ids must also
   * normalize; do not assume original casing is preserved.
   */
  coordinatorBotId: string;
}> & { readonly [FACTS_BRAND]: true };

export type RuntimeAuthority = Readonly<{
  policy: RoundPolicySnapshot;
  episodeId: string;
  tenantId: string | null;
  tenantTrust: CollaborationTenantTrustLevel;
  groupId: string;
  namespace: RuntimeAuthorityNamespace;
  readonly [AUTHORITY_BRAND]: true;
}>;

export type DecideInput = {
  message: string;
  roundId: string;
  explicitMentions?: string[];
  explicitMentionRefs?: import("./mention-resolution.js").ExplicitMentionRef[];
  recentGroupMessages?: unknown[];
  senderLabel?: string | null;
  nowMs?: number;
  /**
   * Real group operatingState from the composition-root scope (P1-A5 ①:
   * participation lane legacy BP-01/02 reads). Required so callers cannot silently
   * drop the OS and fall back to a synthetic scopeView that loses L2 broad.
   * Pass `null` only when there is genuinely no operating state.
   */
  operatingState:
    | import("../collaboration-learning.js").GatewayCollaborationGroupOperatingState
    | null;
};

export type BeatExecutionInput = {
  /** Human interaction lifecycle; absent on already-bound internal task wakes. */
  lifecycle?: "turn" | "long_task";
  decision: import("./types.js").ParticipationDecision;
  message: string;
  sessionKey: string;
  /** Preferred abort surface (§2.2); falls back to isAborted when absent. */
  signal?: AbortSignal;
  isAborted?: () => boolean;
  runBot: (params: {
    bot: CollaborationBotTarget;
    role: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
    dispatchId: string;
    isWrapTurn: boolean;
    edge?: import("./collab-edge.js").CollabEdge;
  }) => Promise<{ text?: string; rawText?: string; publicReplyCommitted?: boolean } | undefined>;
  skipRoundIds?: Iterable<string>;
  inboundDepth?: "chat" | "retrieve" | "act";
  contextScopeRequest?: import("../context-scope/types.js").ContextScopeRequest;
  contextScope?: import("../context-scope/request.js").ChatContextScopePayload;
  onPrimaryDeadline?: () => void;
  /** Optional V1 policy override (legacy); prefer authority.policy. */
  policy?: CollaborationPolicyV1;
  eventKey?: import("./collaboration-event-key.js").CollaborationEventKey | null;
  roundsDir?: string;
  /**
   * P0 G8. This input drives one Legacy Primary/Supplement round inside
   * `executeCollaborationRound`. It is not an Episode Beat Controller.
   * Omitted keeps that legacy executor; any other id is refused.
   */
  productionExecutor?: string;
  /**
   * Authenticated inbound message id (stable across retries). When present with
   * discussToTaskActor, composition roots may pre-run controlledDiscussToTask
   * and pass formalTaskEstablish for diagnosis — round-runtime does not invent ids.
   */
  sourceMessageId?: string;
  discussToTaskActor?: string;
  /** Precomputed formal-task establish diagnosis from composition root. */
  formalTaskEstablish?: import("./supplement-denial-diagnosis.js").FormalTaskEstablishDiagnosis;
};

function brandAuthority(value: Omit<RuntimeAuthority, typeof AUTHORITY_BRAND>): RuntimeAuthority {
  return Object.freeze({ ...value, [AUTHORITY_BRAND]: true as const }) as RuntimeAuthority;
}

function brandFacts(value: Omit<RuntimeFacts, typeof FACTS_BRAND>): RuntimeFacts {
  return Object.freeze({ ...value, [FACTS_BRAND]: true as const }) as RuntimeFacts;
}

/**
 * Project a composition-root scope into a RuntimeFacts view (scope's only exit).
 * Must only be called from composition roots / this module / tests.
 */
export function projectRuntimeFacts(
  scope: CollaborationDispatchScope,
  options?: { effective?: EffectiveCollaborationPolicy },
): RuntimeFacts {
  const operatingState = scope.operatingState ?? null;
  const humans = (scope.members?.humans ?? []).map((human) => {
    const extras = human as {
      userId: string;
      name?: string;
      handle?: string;
      email?: string;
    };
    return {
      userId: extras.userId,
      ...(extras.name ? { name: extras.name } : {}),
      ...(extras.handle ? { handle: extras.handle } : {}),
      ...(extras.email ? { email: extras.email } : {}),
    };
  });
  const memberBots = (scope.members?.bots ?? []).map((bot) => ({
    agentId: bot.agentId,
    ...(bot.name ? { name: bot.name } : {}),
  }));
  const memberRoleMap: RuntimeFactsMemberRole[] = (operatingState?.memberRoleMap ?? []).map(
    (entry) => ({
      memberId: entry.memberId,
      memberKind: String(entry.memberKind),
      label: entry.label ?? null,
      governanceRole: entry.governanceRole ?? null,
      collaborationRole: entry.collaborationRole ?? null,
      status: entry.status ?? null,
    }),
  );
  const roster = scope.bots.map((bot) => {
    const role = memberRoleMap.find(
      (entry) =>
        entry.memberKind === "bot" &&
        (entry.memberId === bot.agentId ||
          entry.memberId === `bot:${bot.agentId}` ||
          entry.memberId.endsWith(`:${bot.agentId}`) ||
          entry.label === bot.agentId),
    );
    return {
      agentId: bot.agentId,
      displayName: bot.name,
      ...(role?.collaborationRole ? { dutyRole: role.collaborationRole } : {}),
    };
  });
  return brandFacts({
    groupId: scope.groupId,
    title: scope.title,
    rawSessionKey: scope.rawSessionKey,
    bots: scope.bots,
    humans,
    memberBots,
    roster,
    activeContext: {
      currentMission: operatingState?.activeContext.currentMission ?? null,
      summary: operatingState?.activeContext.summary ?? null,
      currentOperatingPhase: operatingState?.activeContext.currentOperatingPhase ?? null,
      currentTaskId: operatingState?.activeContext.currentTaskId ?? null,
    },
    purpose: operatingState?.groupProfile.purpose ?? scope.groupProfile?.purpose ?? null,
    profileMission:
      scope.groupProfile?.currentMission ?? operatingState?.groupProfile.currentMission ?? null,
    recentAssistantBotIds: [...(scope.recentAssistantBotIds ?? [])],
    busyAgentIds: [...(scope.blockedAgentIds ?? [])],
    memberRoleMap,
    // P1-A5 ③: standing coordinator via governance lane (legacy = scope.coordinatorBotId
    // or OS/profile fallback — same order as pre-lane coordinatorCandidates).
    coordinatorBotId: resolveGovernanceLaneCoordinatorBotId({
      legacyCoordinatorBotId: scope.coordinatorBotId,
      operatingState: operatingState,
      groupProfile: scope.groupProfile,
      effective: options?.effective ?? null,
    }).coordinatorBotId,
  });
}

function resolveAuthorityNamespace(params: {
  groupId: string;
  tenant: CollaborationTenantResolution;
  profile: RuntimeNamespaceProfile;
  cfg: OpenBotConfig;
}): RuntimeNamespace {
  // Flag off: authority.namespace.root must match the legacy group runtime
  // layout (same root rounds/ledger already use via resolveCollaborationRuntimeFactPaths).
  // Otherwise managed_enterprise + tenantId still resolves under tenants/<id>/... and
  // board-claims / executor-todolists miss tip data written under ~/.openbot/collaboration.
  // P0 G7: flag on keeps fail-closed managed resolution below (no host legacy fallback).
  if (!isCollabRuntimeNamespaceEnabled(params.cfg)) {
    return buildRuntimeNamespace({
      profile: "personal_local",
      tenantId: null,
      groupId: params.groupId,
      groupLocator: resolveTrustedGroupLocator({
        groupId: params.groupId,
        tenantId: null,
        profile: "personal_local",
        cfg: params.cfg,
      }),
    });
  }
  return resolveRuntimeNamespace({
    tenantId: params.tenant.tenantId,
    tenantTrust: params.tenant.trust,
    groupId: params.groupId,
    profile: params.profile,
    cfg: params.cfg,
  });
}

/** Only allowed at composition roots (chat.ts / learning RPC / get-reply-run). */
export function createRuntimeAuthority(input: {
  snapshot: RoundPolicySnapshot;
  episodeId: string;
  tenant: CollaborationTenantResolution;
  groupId: string;
  profile: RuntimeNamespaceProfile;
  cfg?: OpenBotConfig;
}): RuntimeAuthority {
  const cfg = input.cfg ?? loadConfig();
  const groupId = input.groupId.trim();
  if (!groupId) {
    throw new Error("createRuntimeAuthority: groupId is required");
  }
  const episodeId = input.episodeId.trim();
  if (!episodeId) {
    throw new Error("createRuntimeAuthority: episodeId is required");
  }
  const namespace = resolveAuthorityNamespace({
    groupId,
    tenant: input.tenant,
    profile: input.profile,
    cfg,
  });
  return brandAuthority({
    policy: input.snapshot,
    episodeId,
    tenantId: input.tenant.tenantId,
    tenantTrust: input.tenant.trust,
    groupId,
    namespace,
  });
}

/**
 * Composition-root helper (chat.ts). Always builds an in-memory RoundPolicySnapshot
 * so authority.policy is populated; persistence / event-key stamping remain gated
 * by collaboration.policySnapshot (P0.0b).
 */
export function buildGroupRuntimeAuthority(params: {
  scope: CollaborationDispatchScope;
  episodeId: string;
  snapshot?: RoundPolicySnapshot | null;
  cfg?: OpenBotConfig;
  tenantTrust?: CollaborationTenantTrustLevel;
}): { authority: RuntimeAuthority; facts: RuntimeFacts; snapshot: RoundPolicySnapshot } {
  const cfg = params.cfg ?? loadConfig();
  const profile = resolveSecurityProfile(cfg).profile;
  const snapshot = params.snapshot ?? createRoundPolicySnapshotFromScope(params.scope, { cfg });
  const tenantId = params.scope.tenantId?.trim() || null;
  const tenant: CollaborationTenantResolution = {
    tenantId,
    trust:
      params.tenantTrust ??
      (tenantId ? ("actor_fallback" satisfies CollaborationTenantTrustLevel) : "none"),
  };
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: params.episodeId,
    tenant,
    groupId: params.scope.groupId,
    profile,
    cfg,
  });
  const facts = projectRuntimeFacts(params.scope, {
    effective: snapshot.effective as EffectiveCollaborationPolicy,
  });
  return { authority, facts, snapshot };
}

/** Type guard: value carries the authority brand. */
export function isRuntimeAuthority(value: unknown): value is RuntimeAuthority {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[AUTHORITY_BRAND] === true
  );
}

/** Type guard: value carries the facts brand. */
export function isRuntimeFacts(value: unknown): value is RuntimeFacts {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[FACTS_BRAND] === true
  );
}

/**
 * Test / migration bridge: rebuild a CollaborationDispatchScope-shaped view from
 * facts + authority for call sites not yet rewritten. Not for *runtime*.ts.
 *
 * Multi-source rebuild difference (P1-A5 final doc):
 * - Live chat.ts resolves standing coordinator from 4 sources (org → managedSpace →
 *   OS.governance → groupProfile) via the governance lane helper, then projects the
 *   single winner onto `facts.coordinatorBotId`.
 * - This rebuild puts that ONE id back onto BOTH `scope.coordinatorBotId` and
 *   `operatingState.governance.coordinatorBotId` / `groupProfile.coordinatorBotId`.
 *   It does NOT reconstitute the original 4-source vector. Tests that need the
 *   pre-projection multi-source shape must pass a real scope, not a scopeView.
 * - `collaborationMode` is always `authority.policy.effective.strategy.id`
 *   (never null/unknown) — see runtime-authority.types.test.ts contract.
 * - Doc only (no behavior change): live OS `groupProfile.collaborationMode` may
 *   historically hold a free-form / seed literal; the compiler maps that onto
 *   `effective.strategy.id`. scopeView always writes the strategy.id string back,
 *   so a round-trip through scopeView cannot preserve a non-template literal that
 *   differed from strategy.id. Callers that need the pre-compile literal must keep
 *   the original operatingState, not a scopeView rebuild.
 */
export function scopeViewFromRuntimeFacts(
  authority: RuntimeAuthority,
  facts: RuntimeFacts,
): CollaborationDispatchScope {
  const operatingState = {
    groupId: facts.groupId,
    groupProfile: {
      displayName: facts.title,
      purpose: facts.purpose ?? null,
      currentMission: facts.profileMission ?? facts.activeContext.currentMission ?? null,
      expectedOutputs: [] as string[],
      successCriteria: [] as string[],
      // P1-A5 ②: collaborationMode from effective.strategy.id.
      collaborationMode: authority.policy.effective.strategy.id,
    },
    governance: {
      adminUserIds: [] as string[],
      coordinatorBotId: facts.coordinatorBotId || null,
      finalDecisionPolicy: null,
    },
    collaborationPolicy: {
      humanStartsNewRound: true,
      // P1-A5 ①/②: mentionBotMustRespond from effective.participation.
      mentionBotMustRespond: authority.policy.effective.participation.mentionBotMustRespond,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: true,
      // P1-A5 ①: BP-01/02 from effective.participation. Reflect compiled ceiling;
      // broad only when L2-set.
      maxVisibleBotRepliesPerRound:
        authority.policy.effective.participation.maxVisibleBotRepliesPerRound,
      ...(authority.policy.effective.provenance.segments.participation.rollCall.ceiling.source ===
      "l2"
        ? {
            maxVisibleBotRepliesPerRoundBroad:
              authority.policy.effective.participation.rollCall.ceiling,
          }
        : {}),
      botMaySelfAdvanceWithoutHuman: false,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      // P1-A5 ⑤: BP-14 from effective.presentation. Only explicit L2 reflected.
      ...(authority.policy.effective.provenance.segments.presentation.replyLanguage.source === "l2"
        ? { replyLanguage: authority.policy.effective.presentation.replyLanguage }
        : {}),
    },
    memberRoleMap: facts.memberRoleMap.map((entry) => ({
      memberId: entry.memberId,
      memberKind: entry.memberKind,
      label: entry.label ?? null,
      governanceRole: (entry.governanceRole ?? "member") as "admin" | "member" | "observer",
      collaborationRole: entry.collaborationRole ?? null,
      status: (entry.status ?? "active") as "active" | "invited" | "removed",
    })),
    activeContext: {
      currentOperatingPhase: (facts.activeContext.currentOperatingPhase ??
        "explore") as GatewayCollaborationGroupOperatingState["activeContext"]["currentOperatingPhase"],
      currentMission: facts.activeContext.currentMission ?? null,
      currentTaskId: facts.activeContext.currentTaskId ?? null,
      waitingForHuman: false,
      summary: facts.activeContext.summary ?? "",
      updatedAtMs: 0,
    },
    onboardingStatus: { initialized: false },
    groupMemoryRefs: { latestCapsuleIds: [] },
    updatedAtMs: 0,
  } as GatewayCollaborationGroupOperatingState;

  return {
    groupId: facts.groupId,
    rawSessionKey: facts.rawSessionKey,
    title: facts.title,
    coordinatorBotId: facts.coordinatorBotId || null,
    groupProfile: {
      groupId: facts.groupId,
      updatedAtMs: 0,
      collaborationMode: authority.policy.effective.strategy.id as
        | "open_discussion"
        | "task_driven"
        | "decision_driven"
        | undefined,
      currentMission: facts.profileMission ?? undefined,
      purpose: facts.purpose ?? undefined,
      coordinatorBotId: facts.coordinatorBotId || undefined,
    } as CollaborationDispatchScope["groupProfile"],
    members: {
      humans: facts.humans.map((h) => ({
        userId: h.userId,
        name: h.name,
        ...(h.handle ? { handle: h.handle } : {}),
        ...(h.email ? { email: h.email } : {}),
      })),
      bots: facts.memberBots.map((b) => ({ agentId: b.agentId, name: b.name })),
    } as CollaborationDispatchScope["members"],
    operatingState,
    recentAssistantBotIds: [...facts.recentAssistantBotIds],
    blockedAgentIds: [...facts.busyAgentIds],
    bots: facts.bots as CollaborationBotTarget[],
    tenantId: authority.tenantId,
  };
}
