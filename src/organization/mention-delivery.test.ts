import { describe, expect, it } from "vitest";
import { deliver, type MentionDeliveryMessage } from "./mention-delivery.js";
import { createMentionEventBus } from "./mention-events.js";
import type { MentionEvent, MentionMetadata } from "./mention-types.js";
import type { RuntimeAgentRef, RuntimeOrganizationContext } from "./runtime.js";

function makeMember(agentId: string, displayName?: string): RuntimeAgentRef {
  return {
    agentId,
    displayName: displayName ?? agentId,
    online: true,
  };
}

function makeContext(params?: {
  members?: RuntimeAgentRef[];
  coordinator?: RuntimeAgentRef;
  selfAgentId?: string;
}): RuntimeOrganizationContext {
  const selfId = params?.selfAgentId ?? "sender-agent";
  return {
    organization: { id: "org-1", name: "Test Org" },
    self: {
      agentId: selfId,
      displayName: selfId,
      organizationId: "org-1",
      permissions: ["receive_tasks", "report_status"],
      reachableAgents: [],
      identitySource: "fallback",
      capabilities: [],
    },
    coordinator: params?.coordinator,
    members: params?.members ?? [
      makeMember("alice"),
      makeMember("bob"),
      makeMember("sender-agent"),
    ],
  };
}

function makeMention(params: {
  agentId: string;
  displayName?: string;
  offset?: number;
  mentionId?: string;
}): MentionMetadata {
  const displayName = params.displayName ?? params.agentId;
  const offset = params.offset ?? 0;
  return {
    mention_id: params.mentionId ?? `mention-${params.agentId}-${offset}`,
    agentId: params.agentId,
    displayName,
    offset,
    length: displayName.length + 1,
  };
}

function createHarness() {
  const calls: MentionDeliveryMessage[] = [];
  const events: MentionEvent[] = [];
  const eventBus = createMentionEventBus();
  eventBus.subscribe({}, (event) => {
    events.push(event);
  });

  return {
    calls,
    events,
    eventBus,
    interAgentBus: {
      deliverMention(params: MentionDeliveryMessage) {
        calls.push(params);
      },
    },
  };
}

describe("mention delivery", () => {
  it("delivers direct mention to a valid member", async () => {
    const harness = createHarness();
    const context = makeContext({ coordinator: makeMember("coordinator-bot") });
    const message = "@alice please review";

    const result = await deliver({
      messageId: "msg-1",
      messageText: message,
      mentions: [makeMention({ agentId: "alice", displayName: "alice", offset: 0 })],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context,
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(result.errors).toEqual([]);
    expect(result.delivered).toEqual([
      { mention_id: "mention-alice-0", agentId: "alice", status: "delivered" },
    ]);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.mentionContext).toMatchObject({
      isMentioned: true,
      mentionType: "direct",
      mentionSourceAgentId: "sender-agent",
      coordinatorVisible: true,
      priority: "normal",
      mentionIds: ["mention-alice-0"],
    });
  });

  it("emits mention.created events with MentionContext payload", async () => {
    const harness = createHarness();

    await deliver({
      messageId: "msg-1",
      messageText: "@alice please review",
      mentions: [makeMention({ agentId: "alice", displayName: "alice", offset: 0 })],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext({ coordinator: makeMember("coordinator-bot") }),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
      now: () => new Date("2026-05-11T00:00:00.000Z"),
    });

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      type: "mention.created",
      mention_id: "mention-alice-0",
      source_agent_id: "sender-agent",
      target_agent_id: "alice",
      organization_id: "org-1",
      timestamp: "2026-05-11T00:00:00.000Z",
      payload: {
        messageId: "msg-1",
        mentionType: "direct",
        mentionIds: ["mention-alice-0"],
        intentSuggestion: {
          intent: "review_request",
          confidence: 0.8,
          reasoning: "Message asks a mentioned member to review something.",
        },
        mentionContext: {
          isMentioned: true,
          mentionType: "direct",
          mentionSourceAgentId: "sender-agent",
          coordinatorVisible: true,
          priority: "normal",
          mentionIds: ["mention-alice-0"],
        },
      },
    });
  });

  it("uses the state tracker as the mention.created source when provided", async () => {
    const harness = createHarness();
    const createdStates: unknown[] = [];

    await deliver({
      messageId: "msg-1",
      messageText: "@alice please review",
      mentions: [makeMention({ agentId: "alice", displayName: "alice", offset: 0 })],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext({ coordinator: makeMember("coordinator-bot") }),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
      stateTracker: {
        createMentionState(entry) {
          createdStates.push(entry);
        },
      },
      now: () => new Date("2026-05-11T00:00:00.000Z"),
    });

    expect(harness.events).toEqual([]);
    expect(createdStates).toHaveLength(1);
    expect(createdStates[0]).toMatchObject({
      mention_id: "mention-alice-0",
      source_message_id: "msg-1",
      payload: {
        intentSuggestion: expect.objectContaining({ intent: "review_request" }),
      },
    });
  });

  it("sets coordinatorVisible false when no coordinator exists", async () => {
    const harness = createHarness();

    await deliver({
      messageId: "msg-1",
      messageText: "@alice hi",
      mentions: [makeMention({ agentId: "alice", displayName: "alice", offset: 0 })],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext(),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(harness.calls[0]?.mentionContext.coordinatorVisible).toBe(false);
  });

  it("broadcasts __all__ to every organization member", async () => {
    const harness = createHarness();
    const context = makeContext({
      members: [makeMember("alice"), makeMember("bob"), makeMember("sender-agent")],
    });

    const result = await deliver({
      messageId: "msg-1",
      messageText: "@所有人 meeting now",
      mentions: [makeMention({ agentId: "__all__", displayName: "所有人", offset: 0 })],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context,
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(result.errors).toEqual([]);
    expect(result.delivered.map((item) => item.agentId).toSorted()).toEqual([
      "alice",
      "bob",
      "sender-agent",
    ]);
    expect(harness.calls.map((call) => call.mentionContext.mentionType)).toEqual([
      "broadcast",
      "broadcast",
      "broadcast",
    ]);
  });

  it("skips unknown agents without raising a delivery error", async () => {
    const harness = createHarness();

    const result = await deliver({
      messageId: "msg-1",
      messageText: "@alice hi @unknown check",
      mentions: [
        makeMention({ agentId: "alice", displayName: "alice", offset: 0 }),
        makeMention({ agentId: "unknown", displayName: "unknown", offset: 10 }),
      ],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext({ members: [makeMember("alice"), makeMember("sender-agent")] }),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(result.errors).toEqual([]);
    expect(result.delivered).toEqual([
      { mention_id: "mention-unknown-10", agentId: "unknown", status: "skipped" },
      { mention_id: "mention-alice-0", agentId: "alice", status: "delivered" },
    ]);
    expect(harness.calls.map((call) => call.targetAgentId)).toEqual(["alice"]);
  });

  it("delivers multiple mentions to different agents", async () => {
    const harness = createHarness();

    const result = await deliver({
      messageId: "msg-1",
      messageText: "@alice and @bob please review",
      mentions: [
        makeMention({ agentId: "alice", displayName: "alice", offset: 0 }),
        makeMention({ agentId: "bob", displayName: "bob", offset: 11 }),
      ],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext(),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(result.delivered.map((item) => item.agentId).toSorted()).toEqual(["alice", "bob"]);
    expect(harness.events).toHaveLength(2);
  });

  it("groups multiple mentions to the same agent into one delivery call", async () => {
    const harness = createHarness();

    await deliver({
      messageId: "msg-1",
      messageText: "@alice first @alice second",
      mentions: [
        makeMention({ agentId: "alice", displayName: "alice", offset: 0, mentionId: "m1" }),
        makeMention({ agentId: "alice", displayName: "alice", offset: 13, mentionId: "m2" }),
      ],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext(),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.mentionContext.mentionIds).toEqual(["m1", "m2"]);
    expect(harness.events.map((event) => event.mention_id)).toEqual(["m1", "m2"]);
  });

  it("continues when one target delivery fails", async () => {
    const result = await deliver({
      messageId: "message-1",
      messageText: "@alice @bob",
      mentions: [
        makeMention({ agentId: "alice", displayName: "alice", offset: 0 }),
        makeMention({ agentId: "bob", displayName: "bob", offset: 7 }),
      ],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext(),
      interAgentBus: {
        deliverMention(params) {
          if (params.targetAgentId === "alice") {
            throw new Error("target unavailable");
          }
        },
      },
    });

    expect(result.delivered).toEqual([
      { mention_id: "mention-bob-7", agentId: "bob", status: "delivered" },
    ]);
    expect(result.errors).toEqual([
      {
        mention_id: "mention-alice-0",
        agentId: "alice",
        reason: "target unavailable",
      },
    ]);
  });

  it("returns empty result for empty mentions array", async () => {
    const harness = createHarness();

    const result = await deliver({
      messageId: "msg-1",
      messageText: "hello",
      mentions: [],
      sourceAgentId: "sender-agent",
      organizationId: "org-1",
      context: makeContext(),
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
    });

    expect(result).toEqual({ delivered: [], errors: [] });
    expect(harness.events).toEqual([]);
    expect(harness.calls).toEqual([]);
  });

  it("notifies humans without fan-out to agents", async () => {
    const harness = createHarness();
    const notified: Array<{ mentionId: string; targetUserId: string }> = [];
    const context = makeContext();
    context.humans = [{ userId: "alice", displayName: "Alice", status: "active" }];

    const result = await deliver({
      messageId: "msg-human",
      messageText: "@Alice please review",
      mentions: [
        {
          mention_id: "m-human",
          displayName: "Alice",
          offset: 0,
          length: 6,
          target: { kind: "human", userId: "alice" },
        },
      ],
      sourceAgentId: "sender-agent",
      sourceUserId: "bob",
      groupId: "g1",
      sessionKey: "agent:main:space:g1",
      tenantId: "tenant-1",
      organizationId: "org-1",
      context,
      eventBus: harness.eventBus,
      interAgentBus: harness.interAgentBus,
      notifyHuman: async (notification) => {
        notified.push({
          mentionId: notification.mentionId,
          targetUserId: notification.targetUserId,
        });
      },
    });

    expect(harness.calls).toEqual([]);
    expect(notified).toEqual([{ mentionId: "m-human", targetUserId: "alice" }]);
    expect(result.delivered).toEqual([
      {
        mention_id: "m-human",
        agentId: "",
        targetKind: "human",
        status: "notified",
      },
    ]);
  });

  it("records human notify failures without throwing", async () => {
    const context = makeContext();
    context.humans = [{ userId: "alice", displayName: "Alice", status: "active" }];

    const result = await deliver({
      messageId: "msg-human-fail",
      messageText: "@Alice",
      mentions: [
        {
          mention_id: "m-fail",
          displayName: "Alice",
          offset: 0,
          length: 6,
          target: { kind: "human", userId: "alice" },
        },
      ],
      sourceAgentId: "sender-agent",
      sourceUserId: "bob",
      groupId: "g1",
      sessionKey: "space:g1",
      tenantId: "tenant-1",
      organizationId: "org-1",
      context,
      interAgentBus: { deliverMention() {} },
      notifyHuman: async () => {
        throw new Error("store unavailable");
      },
    });

    expect(result.delivered).toEqual([]);
    expect(result.errors).toEqual([
      {
        mention_id: "m-fail",
        agentId: "",
        targetKind: "human",
        reason: "store unavailable",
      },
    ]);
  });
});
