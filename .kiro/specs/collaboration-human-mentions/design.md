# Design: Collaboration Human Mentions

## Protocol

```ts
type MentionTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "human"; userId: string }
  | { kind: "all" };

type MentionMetadata = {
  mention_id: string;
  displayName: string;
  offset: number;
  length: number;
  /** Canonical target. Prefer this over legacy agentId. */
  target?: MentionTarget;
  /** Legacy: agent id or "__all__". Still accepted on input. */
  agentId?: string;
};
```

Normalization:

- legacy `{ agentId: "__all__" }` → `{ target: { kind: "all" }, agentId: "__all__" }`
- legacy `{ agentId: "bot-x" }` → `{ target: { kind: "agent", agentId: "bot-x" }, agentId: "bot-x" }`
- new human `{ target: { kind: "human", userId } }` → keep; do not invent agentId

Server never trusts client `displayName` for authorization; roster lookup provides canonical display name for notifications.

## Validation

`RuntimeOrganizationContext` gains `humans: RuntimeHumanRef[]` loaded from the collaboration space roster (active only for candidate validity; history may still render removed).

Invalid when human is missing / invited / removed / inactive / not in group.

## Delivery

- agent / all→bots: existing inter-agent bus + mention journal
- human / all→humans: `human-mention-notifications` store (tenant-scoped, mentionId idempotent)
- mention delivery failures log + skip; never fail `chat.send`

## Notifications

Store: tenant control-plane `human-mention-notifications.json` keyed by mentionId.

Fields: mentionId, targetUserId, sourceUserId, groupId, sessionKey, sourceMessageId, excerpt, createdAt, readAt.

RPCs: `workbench.humanMentions.list` / `workbench.humanMentions.ack` (self-scoped).

## UI

`buildCurrentMentionCandidates` merges active humans + bots + all; serializer emits human targets; renderer supports human + muted removed.
