/** P1-A2 test fixtures: operating-state matrix for composition-root / migration tests. */
import type { GatewayCollaborationGroupOperatingState } from "../../collaboration-learning.js";

type State = GatewayCollaborationGroupOperatingState;

export function makeOperatingState(overrides?: {
  groupId?: string;
  collaborationMode?: unknown;
  policy?: Record<string, unknown> | null;
  governance?: Partial<State["governance"]>;
  policyRevision?: number;
}): State {
  const state = {
    groupId: overrides?.groupId ?? "grp-p1a2",
    groupProfile: {
      displayName: "P1-A2 Group",
      expectedOutputs: ["task"],
      successCriteria: [],
      ...(overrides && "collaborationMode" in overrides
        ? { collaborationMode: overrides.collaborationMode }
        : {}),
    },
    governance: {
      ownerUserId: "user-1",
      adminUserIds: [],
      coordinatorBotId: "bot-c",
      ...overrides?.governance,
    },
    collaborationPolicy:
      overrides?.policy === null
        ? undefined
        : {
            humanStartsNewRound: true,
            mentionHumanNotifiesOnly: true,
            openDiscussionWithoutMention: false,
            botMaySelfAdvanceWithoutHuman: false,
            entersWaitingForHumanAfterVisibleTurnsExhausted: true,
            ...overrides?.policy,
          },
    memberRoleMap: [],
    activeContext: {
      currentOperatingPhase: "explore",
      waitingForHuman: false,
      summary: "",
      updatedAtMs: 1,
    },
    onboardingStatus: { initialized: true },
    groupMemoryRefs: { latestCapsuleIds: [] },
    updatedAtMs: 1,
    ...(overrides?.policyRevision !== undefined
      ? { policyRevision: overrides.policyRevision }
      : {}),
  };
  return state as unknown as State;
}

const MODES: unknown[] = [
  undefined,
  null,
  "",
  "   ",
  "discussion_driven",
  "task_driven",
  " review_driven ",
  "bogus_mode",
];
const MENTIONS: unknown[] = [undefined, null, true, false];
const MAX_VISIBLE: unknown[] = [undefined, null, 1, 3, 5, 12, 40, 0, Number.NaN, "3"];
const OPEN: unknown[] = [undefined, true, false];

/** Cartesian matrix over the Q5-relevant fields (+ openDiscussion as a control). */
export function operatingStateMatrix(): State[] {
  const out: State[] = [];
  let n = 0;
  for (const mode of MODES) {
    for (const mention of MENTIONS) {
      for (const max of MAX_VISIBLE) {
        for (const open of OPEN) {
          const policy: Record<string, unknown> = {};
          if (mention !== undefined) {
            policy.mentionBotMustRespond = mention;
          }
          if (max !== undefined) {
            policy.maxVisibleBotRepliesPerRound = max;
          }
          if (open !== undefined) {
            policy.openDiscussionWithoutMention = open;
          }
          out.push(
            makeOperatingState({
              groupId: `grp-m${n++}`,
              collaborationMode: mode,
              policy,
            }),
          );
        }
      }
    }
  }
  return out;
}
