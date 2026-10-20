import { html, nothing, type TemplateResult } from "lit";
import type { MentionEventBus } from "../../../../../src/organization/mention-events.js";
import type {
  MentionEvent,
  MentionMetadata,
} from "../../../../../src/organization/mention-types.js";
import { parseInternalAnchors } from "./mention-serializer.js";

const MENTION_ALL_AGENT_ID = "__all__";

export type MentionRenderState = "awaiting" | "acknowledged" | "taskAccepted" | "escalated";

export type MentionStateLookup =
  | ReadonlyMap<string, MentionRenderState>
  | Record<string, MentionRenderState | undefined>;

export interface MentionRendererProps {
  text: string;
  mentions?: MentionMetadata[];
  currentAgentId?: string | null;
  currentUserId?: string | null;
  removedAgentIds?: Iterable<string>;
  removedUserIds?: Iterable<string>;
  mentionStates?: MentionStateLookup;
}

export interface MentionRenderPart {
  type: "text" | "mention";
  text: string;
  mention?: MentionMetadata;
}

export interface MentionRenderStateTracker {
  getState(mention_id: string): MentionRenderState | undefined;
  snapshot(): ReadonlyMap<string, MentionRenderState>;
  dispose(): void;
}

export interface MentionRenderStateTrackerParams {
  eventBus: MentionEventBus;
  targetAgentId?: string;
  organizationId?: string;
  onChange?: (mention_id: string, state: MentionRenderState, event: MentionEvent) => void;
}

function stateFromEvent(event: MentionEvent): MentionRenderState {
  if (event.type === "mention.acknowledged") {
    return "acknowledged";
  }
  if (event.type === "mention.responded" || event.type === "mention.resolved") {
    return "taskAccepted";
  }
  if (event.type === "mention.escalated") {
    return "escalated";
  }
  return "awaiting";
}

export function createMentionRenderStateTracker(
  params: MentionRenderStateTrackerParams,
): MentionRenderStateTracker {
  const states = new Map<string, MentionRenderState>();
  const unsubscribe = params.eventBus.subscribe(
    {
      target_agent_id: params.targetAgentId,
      organization_id: params.organizationId,
    },
    (event) => {
      const state = stateFromEvent(event);
      states.set(event.mention_id, state);
      params.onChange?.(event.mention_id, state, event);
    },
  );

  return {
    getState(mention_id: string) {
      return states.get(mention_id);
    },
    snapshot() {
      return new Map(states);
    },
    dispose() {
      unsubscribe();
    },
  };
}

function getMentionState(
  lookup: MentionStateLookup | undefined,
  mention_id: string,
): MentionRenderState | undefined {
  if (!lookup) {
    return undefined;
  }
  if (isMentionStateMap(lookup)) {
    return lookup.get(mention_id);
  }
  return lookup[mention_id];
}

function isMentionStateMap(
  lookup: MentionStateLookup,
): lookup is ReadonlyMap<string, MentionRenderState> {
  return typeof (lookup as { get?: unknown }).get === "function";
}

function toRemovedAgentSet(removedAgentIds: Iterable<string> | undefined): Set<string> {
  return new Set(removedAgentIds ?? []);
}

function normalizeMentionsFromAnchors(
  text: string,
  mentions: MentionMetadata[],
): { text: string; mentions: MentionMetadata[] } {
  if (!text.includes("<mention")) {
    return { text, mentions };
  }

  const knownMentions = new Map(mentions.map((mention) => [mention.mention_id, mention]));
  const parsed = parseInternalAnchors(text, {
    resolveAgentId(anchor) {
      return knownMentions.get(anchor.mention_id)?.agentId;
    },
  });

  return {
    text: parsed.text,
    mentions: parsed.mentions.map((mention) => {
      const knownMention = knownMentions.get(mention.mention_id);
      return knownMention
        ? {
            ...mention,
            agentId: knownMention.agentId,
            displayName: knownMention.displayName,
          }
        : mention;
    }),
  };
}

export function buildMentionRenderParts(props: MentionRendererProps): MentionRenderPart[] {
  const normalized = normalizeMentionsFromAnchors(props.text, props.mentions ?? []);
  const mentions = normalized.mentions
    .filter((mention) => mention.offset >= 0 && mention.length > 0)
    .filter((mention) => mention.offset + mention.length <= normalized.text.length)
    .toSorted((left, right) => left.offset - right.offset);
  const parts: MentionRenderPart[] = [];
  let cursor = 0;

  for (const mention of mentions) {
    if (mention.offset < cursor) {
      continue;
    }
    if (mention.offset > cursor) {
      parts.push({
        type: "text",
        text: normalized.text.slice(cursor, mention.offset),
      });
    }
    parts.push({
      type: "mention",
      text: normalized.text.slice(mention.offset, mention.offset + mention.length),
      mention,
    });
    cursor = mention.offset + mention.length;
  }

  if (cursor < normalized.text.length) {
    parts.push({
      type: "text",
      text: normalized.text.slice(cursor),
    });
  }

  return parts.length > 0 ? parts : [{ type: "text", text: normalized.text }];
}

function renderStateIndicator(
  state: MentionRenderState | undefined,
): TemplateResult | typeof nothing {
  if (!state) {
    return nothing;
  }

  const label =
    state === "awaiting"
      ? "等待确认"
      : state === "acknowledged"
        ? "已确认"
        : state === "taskAccepted"
          ? "任务已接收"
          : "已升级";
  const symbol =
    state === "awaiting"
      ? "⏳"
      : state === "acknowledged"
        ? "✅"
        : state === "taskAccepted"
          ? "📌"
          : "!";

  return html`
    <span class=${`mention-renderer__state mention-renderer__state--${state}`} aria-label=${label}>
      ${symbol}
    </span>
  `;
}

function renderMentionPart(params: {
  text: string;
  mention: MentionMetadata;
  currentAgentId?: string | null;
  currentUserId?: string | null;
  removedAgentIds: Set<string>;
  removedUserIds?: Set<string>;
  state?: MentionRenderState;
}): TemplateResult {
  const targetKind =
    params.mention.target?.kind ??
    params.mention.targetKind ??
    (params.mention.agentId === MENTION_ALL_AGENT_ID
      ? "all"
      : params.mention.agentId
        ? "agent"
        : "human");
  const isAll = targetKind === "all";
  const isHuman = targetKind === "human";
  const isPlugin = targetKind === "plugin";
  const humanUserId =
    params.mention.target?.kind === "human"
      ? params.mention.target.userId
      : params.mention.targetKind === "human"
        ? params.mention.targetId
        : undefined;
  const agentId = params.mention.agentId ?? "";
  const isSelf = isHuman
    ? Boolean(
        params.currentUserId &&
        humanUserId &&
        params.currentUserId.trim().toLowerCase() === humanUserId.trim().toLowerCase(),
      )
    : isPlugin
      ? false
      : params.currentAgentId === agentId || (isAll && Boolean(params.currentAgentId));
  const isRemoved = isHuman
    ? Boolean(humanUserId && params.removedUserIds?.has(humanUserId))
    : isPlugin
      ? false
      : Boolean(agentId && params.removedAgentIds.has(agentId));
  const classes = [
    "mention-renderer__mention",
    "mention-chip",
    isAll
      ? "mention-chip--all"
      : isHuman
        ? "mention-chip--human"
        : isPlugin
          ? "mention-chip--plugin"
          : "mention-chip--agent",
    isSelf ? "is-self-mentioned" : "",
    isRemoved ? "is-removed is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <span
      class=${classes}
      data-mention-id=${params.mention.mention_id}
      data-agent-id=${agentId || nothing}
      data-user-id=${humanUserId || nothing}
      data-target-kind=${targetKind}
      title=${isRemoved ? "成员已移除" : params.mention.displayName}
    >
      <span class="mention-chip__text">${params.text}</span>
      ${
        isSelf
          ? html`
              <span class="mention-renderer__self-indicator" aria-label="Mentioned you">你</span>
            `
          : nothing
      }
      ${renderStateIndicator(params.state)}
    </span>
  `;
}

export function renderMentionedMessage(props: MentionRendererProps): TemplateResult {
  const removedAgentIds = toRemovedAgentSet(props.removedAgentIds);
  const removedUserIds = new Set(props.removedUserIds ?? []);
  return html`
    <span class="mention-renderer">
      ${buildMentionRenderParts(props).map((part) => {
        if (part.type === "text" || !part.mention) {
          return html`${part.text}`;
        }
        return renderMentionPart({
          text: part.text,
          mention: part.mention,
          currentAgentId: props.currentAgentId,
          currentUserId: props.currentUserId,
          removedAgentIds,
          removedUserIds,
          state: getMentionState(props.mentionStates, part.mention.mention_id),
        });
      })}
    </span>
  `;
}
