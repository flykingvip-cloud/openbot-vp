import type { OpenBotConfig } from "../config/config.js";
import { mentionEventBus, type MentionEventBus } from "./mention-events.js";
import {
  appendMentionEvent,
  replayJournal,
  type MentionStateJournalScope,
} from "./mention-state-journal.js";
import type { MentionEventType, MentionState } from "./mention-types.js";

export type MentionStateTransition = "acknowledge" | "respond" | "resolve";
type MentionStateTransitionEventType = Exclude<
  MentionEventType,
  "mention.created" | "mention.escalated"
>;

export interface MentionStateTrackerScope extends MentionStateJournalScope {
  eventBus?: MentionEventBus;
}

export interface CreateMentionStateParams {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  mention_id: string;
  source_message_id: string;
  source_agent_id: string;
  target_agent_id: string;
  now?: Date | string;
  eventBus?: MentionEventBus;
  emitEvent?: boolean;
  payload?: Record<string, unknown>;
}

export interface TransitionMentionStateParams extends MentionStateTrackerScope {
  mention_id: string;
  transition: MentionStateTransition;
  now?: Date | string;
}

function nowIso(now: Date | string | undefined): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

function transitionToEventType(
  transition: MentionStateTransition,
): MentionStateTransitionEventType {
  if (transition === "acknowledge") {
    return "mention.acknowledged";
  }
  if (transition === "respond") {
    return "mention.responded";
  }
  return "mention.resolved";
}

function scopeFromParams(params: MentionStateTrackerScope): MentionStateJournalScope {
  return {
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    organizationId: params.organizationId,
  };
}

function emitStateEvent(params: {
  eventBus: MentionEventBus;
  type: MentionEventType;
  state: MentionState;
  timestamp: string;
  payload?: Record<string, unknown>;
}): void {
  params.eventBus.emit({
    type: params.type,
    mention_id: params.state.mention_id,
    source_agent_id: params.state.source_agent_id,
    target_agent_id: params.state.target_agent_id,
    organization_id: params.state.organization_id,
    timestamp: params.timestamp,
    payload: params.payload,
  });
}

function applyTransition(
  state: MentionState,
  transition: MentionStateTransition,
  timestamp: string,
): MentionState {
  if (transition === "acknowledge") {
    return {
      ...state,
      acknowledged: true,
      updated_at: timestamp,
      acknowledged_at: state.acknowledged_at ?? timestamp,
    };
  }
  if (transition === "respond") {
    return {
      ...state,
      responded: true,
      updated_at: timestamp,
      responded_at: state.responded_at ?? timestamp,
    };
  }
  return {
    ...state,
    resolved: true,
    updated_at: timestamp,
    resolved_at: state.resolved_at ?? timestamp,
  };
}

export async function createMentionState(params: CreateMentionStateParams): Promise<MentionState> {
  const timestamp = nowIso(params.now);
  const state: MentionState = {
    mention_id: params.mention_id,
    source_message_id: params.source_message_id,
    source_agent_id: params.source_agent_id,
    target_agent_id: params.target_agent_id,
    organization_id: params.organizationId,
    acknowledged: false,
    responded: false,
    resolved: false,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await appendMentionEvent({
    ...scopeFromParams(params),
    event: {
      type: "mention.created",
      state,
      timestamp,
    },
  });
  if (params.emitEvent !== false) {
    emitStateEvent({
      eventBus: params.eventBus ?? mentionEventBus,
      type: "mention.created",
      state,
      timestamp,
      payload: {
        source_message_id: params.source_message_id,
        ...params.payload,
      },
    });
  }
  return state;
}

export async function transitionMentionState(
  params: TransitionMentionStateParams,
): Promise<MentionState | null> {
  const timestamp = nowIso(params.now);
  const states = await replayJournal(scopeFromParams(params));
  const current = states.get(params.mention_id);
  if (!current) {
    return null;
  }

  const next = applyTransition(current, params.transition, timestamp);
  const eventType = transitionToEventType(params.transition);
  await appendMentionEvent({
    ...scopeFromParams(params),
    event: {
      type: eventType,
      mention_id: params.mention_id,
      timestamp,
      organization_id: current.organization_id,
      source_agent_id: current.source_agent_id,
      target_agent_id: current.target_agent_id,
    },
  });
  emitStateEvent({
    eventBus: params.eventBus ?? mentionEventBus,
    type: eventType,
    state: next,
    timestamp,
  });
  return next;
}

export async function checkEscalation(
  params: MentionStateTrackerScope & {
    timeoutMs?: number;
    now?: Date | string;
  },
): Promise<MentionState[]> {
  const timestamp = nowIso(params.now);
  const nowMs = Date.parse(timestamp);
  const timeoutMs = Math.max(0, params.timeoutMs ?? 5 * 60 * 1000);
  const states = await replayJournal(scopeFromParams(params));
  const escalated: MentionState[] = [];

  for (const state of states.values()) {
    if (state.acknowledged || state.resolved) {
      continue;
    }
    const createdAtMs = Date.parse(state.created_at);
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs < timeoutMs) {
      continue;
    }
    const next = {
      ...state,
      updated_at: timestamp,
    };
    await appendMentionEvent({
      ...scopeFromParams(params),
      event: {
        type: "mention.escalated",
        mention_id: state.mention_id,
        timestamp,
        organization_id: state.organization_id,
        source_agent_id: state.source_agent_id,
        target_agent_id: state.target_agent_id,
      },
    });
    emitStateEvent({
      eventBus: params.eventBus ?? mentionEventBus,
      type: "mention.escalated",
      state: next,
      timestamp,
    });
    escalated.push(next);
  }

  return escalated;
}

export const MentionStateTracker = {
  createMentionState,
  transitionMentionState,
  checkEscalation,
};
