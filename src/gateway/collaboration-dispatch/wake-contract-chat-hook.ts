/**
 * C2 follow-up — best-effort Wake Contract writers on the group chat.send path.
 *
 * Inventory gap (tip 数字人战队): wake-contract writers existed but human
 * structured / plain-text @ via chat.send did not append wake-events.
 *
 * Flag `collaboration.task.wakeContract` OFF → no writes (writers are no-ops).
 * Flag `collaboration.task.assistantMentionDispatch` gates assistant inline @
 * outcome; C3 consumer resolves bots → `dispatched` + same-round peer_ask edges
 * (see assistant-mention-dispatch.ts). Still not Floor live.
 *
 * Non-goals: Floor live, ui.*, second orchestrator, LIVE defaults, Admission.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { planAssistantMentionDispatch } from "./assistant-mention-dispatch.js";
import {
  resolveMentionResolution,
  type ExplicitMentionRef,
  type MentionHuman,
} from "./mention-resolution.js";
import {
  collectMentionTokens,
  hasBroadcastMention,
  normalizeAgentIdentifier,
  normalizeMentionIdentity,
} from "./mention-utils.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";
import {
  isCollabTaskWakeContractEnabled,
  observeAssistantInlineAtMentions,
  recordNudgeWake,
  recordStructuredMentionWake,
  recordWakeEventBestEffort,
} from "./wake-contract.js";

export type ChatSendWakeHookInput = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  fromAgentId: string;
  message: string;
  explicitMentions?: string[];
  explicitMentionRefs?: ExplicitMentionRef[];
  bots: readonly CollaborationBotTarget[];
  humans?: readonly MentionHuman[];
  /** chat.send clientRunId / round id */
  relatedId?: string;
  taskId?: string;
  /**
   * When true (default), multi-target soft催办 also records a `nudge` wake
   * alongside structured_mention — matches tip「multi-@ nudge」催办 evidence.
   */
  alsoRecordNudgeWhenMulti?: boolean;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Resolve wake targets from structured chips + plain-text @ via existing mention-resolution. */
export function resolveChatSendWakeTargets(input: {
  message: string;
  explicitMentions?: string[];
  explicitMentionRefs?: ExplicitMentionRef[];
  bots: readonly CollaborationBotTarget[];
  humans?: readonly MentionHuman[];
}): { targets: string[]; broadcast: boolean; matchedBotCount: number } {
  const bots = [...input.bots];
  const humans = [...(input.humans ?? [])];
  const resolution = resolveMentionResolution({
    message: input.message,
    explicitMentions: input.explicitMentions,
    explicitMentionRefs: input.explicitMentionRefs,
    bots,
    humans,
  });
  const tokens = collectMentionTokens(input.message, input.explicitMentions ?? []);
  const broadcast = hasBroadcastMention(tokens);
  const targets = [...resolution.matchedAgentIds];

  // Explicit human chips / plain-text @ that match group humans (not only bots).
  for (const ref of input.explicitMentionRefs ?? []) {
    const userId =
      normalizeMentionIdentity(ref.userId) ||
      (ref.targetKind === "human" ? normalizeMentionIdentity(ref.targetId) : null);
    if (userId && humans.some((h) => normalizeMentionIdentity(h.userId) === userId)) {
      targets.push(userId);
    }
  }
  for (const token of tokens) {
    const human = humans.find((h) => {
      const ids = [h.userId, h.name, h.email, h.handle]
        .map((v) => normalizeMentionIdentity(v))
        .filter(Boolean);
      return ids.some((id) => id === token || token.startsWith(id!));
    });
    if (human?.userId) {
      targets.push(compact(human.userId));
    }
  }

  if (broadcast && targets.length === 0) {
    for (const bot of bots) {
      const id = normalizeAgentIdentifier(bot.agentId);
      if (id) {
        targets.push(id);
      }
    }
  }

  return {
    targets: uniqueIds(targets),
    broadcast,
    matchedBotCount: resolution.matchedAgentIds.length,
  };
}

/**
 * After decideParticipants on human group chat.send: record structured_mention
 * (and optional multi nudge). Never throws into the chat hot path.
 */
export async function recordChatSendMentionWakesBestEffort(
  input: ChatSendWakeHookInput,
): Promise<{ recorded: boolean; targetCount: number }> {
  try {
    if (!isCollabTaskWakeContractEnabled(input.cfg, input.groupId, input.authority.tenantId)) {
      return { recorded: false, targetCount: 0 };
    }
    const fromAgentId = compact(input.fromAgentId);
    const groupId = compact(input.groupId);
    if (!fromAgentId || !groupId) {
      return { recorded: false, targetCount: 0 };
    }
    const { targets } = resolveChatSendWakeTargets({
      message: input.message,
      explicitMentions: input.explicitMentions,
      explicitMentionRefs: input.explicitMentionRefs,
      bots: input.bots,
      humans: input.humans,
    });
    if (targets.length === 0) {
      return { recorded: false, targetCount: 0 };
    }
    const options = { cfg: input.cfg };
    await recordStructuredMentionWake(
      input.authority,
      {
        groupId,
        fromAgentId,
        toAgentIds: targets,
        taskId: input.taskId,
        relatedId: input.relatedId,
      },
      options,
    );
    const alsoNudge = input.alsoRecordNudgeWhenMulti !== false && targets.length >= 2;
    if (alsoNudge) {
      await recordNudgeWake(
        input.authority,
        {
          groupId,
          fromAgentId,
          toAgentIds: targets,
          taskId: input.taskId,
          reason: "multi_mention_soft_nudge",
        },
        options,
      );
    }
    return { recorded: true, targetCount: targets.length };
  } catch {
    return { recorded: false, targetCount: 0 };
  }
}

/**
 * After an assistant collaboration reply is visible: observe inline @ tokens.
 * Flag-off wakeContract → no write. assistantMentionDispatch gates outcome.
 * When bots are provided and flag ON, C3 consumer resolves @ → agentIds and
 * records outcome `dispatched` (edges attach separately in round-runtime).
 */
export async function observeAssistantReplyWakeBestEffort(input: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  fromAgentId: string;
  text: string;
  relatedId?: string;
  taskId?: string;
  /** Group roster for C3 consumer resolution (optional; omit → eligible only). */
  bots?: readonly CollaborationBotTarget[];
}): Promise<void> {
  try {
    if (!isCollabTaskWakeContractEnabled(input.cfg, input.groupId, input.authority.tenantId)) {
      return;
    }
    const text = compact(input.text);
    const fromAgentId = compact(input.fromAgentId);
    const groupId = compact(input.groupId);
    if (!text || !fromAgentId || !groupId) {
      return;
    }
    let resolvedAgentIds: string[] | undefined;
    if (input.bots && input.bots.length > 0) {
      const plan = planAssistantMentionDispatch({
        text,
        fromAgentId,
        bots: input.bots,
        cfg: input.cfg,
      });
      if (plan.allowed && plan.targets.length > 0) {
        resolvedAgentIds = plan.targets.map((bot) => bot.agentId);
      }
    }
    await observeAssistantInlineAtMentions(
      input.authority,
      {
        groupId,
        fromAgentId,
        text,
        taskId: input.taskId,
        relatedId: input.relatedId,
        ...(resolvedAgentIds ? { resolvedAgentIds } : {}),
      },
      { cfg: input.cfg },
    );
  } catch {
    // best-effort
  }
}

/** Test helper: flag-off path via recordWakeEventBestEffort (no disk). */
export async function wakeWritersNoopWhenFlagOff(
  authority: RuntimeAuthority,
  cfg: OpenBotConfig,
): Promise<boolean> {
  const event = await recordWakeEventBestEffort(
    authority,
    {
      groupId: "grp_hook",
      fromAgentId: "human",
      toAgentIds: ["bot_a"],
      source: "structured_mention",
    },
    { cfg },
  );
  return event === null;
}
