// @vitest-environment node
// CollabDispatch Sprint D2 — Delivery adapter + retry + status progress.

import { describe, expect, it, vi } from "vitest";
import {
  type CollabDispatchDeliveryAdapters,
  deliverCollabDispatchRoster,
  listCollabDispatchDeliveryTargets,
  listFailedOrPendingDeliveryRecipientIds,
  resolveCollabDispatchOrganizationId,
  summarizeMeetingDeliveryProgress,
} from "./collab-dispatch-delivery.js";
import { createMeeting, type Meeting } from "./meeting-store.js";

function meetingFixture(overrides?: Partial<Meeting>): Meeting {
  const base = createMeeting({
    organizerUserId: "user-1",
    title: "Kickoff",
    startAtMs: Date.now() + 60_000,
    id: "m-d2",
    tenantId: "tenant-a",
    spaceId: "space-a",
    attendees: [
      { userId: "user-2", kind: "human" },
      { userId: "agent-bot-1", kind: "agent" },
    ],
  });
  return { ...base, ...overrides, attendees: overrides?.attendees ?? base.attendees };
}

describe("collab-dispatch-delivery helpers", () => {
  it("resolves organizationId from spaceId then tenantId", () => {
    expect(resolveCollabDispatchOrganizationId({ spaceId: "s1", tenantId: "t1" })).toBe("s1");
    expect(resolveCollabDispatchOrganizationId({ tenantId: "t1" })).toBe("t1");
    expect(resolveCollabDispatchOrganizationId({})).toBeUndefined();
  });

  it("lists non-organizer targets with human/agent kinds", () => {
    const meeting = meetingFixture();
    expect(listCollabDispatchDeliveryTargets(meeting)).toEqual([
      { recipientId: "user-2", kind: "human" },
      { recipientId: "agent-bot-1", kind: "agent" },
    ]);
  });

  it("summarizes delivery progress from attendee deliveryStatus", () => {
    const meeting = meetingFixture({
      attendees: [
        { userId: "user-1", role: "organizer", rsvpStatus: "accepted", kind: "human" },
        {
          userId: "user-2",
          role: "required",
          rsvpStatus: "invited",
          kind: "human",
          deliveryStatus: "sent",
        },
        {
          userId: "user-3",
          role: "required",
          rsvpStatus: "invited",
          kind: "human",
          deliveryStatus: "failed",
        },
        {
          userId: "user-4",
          role: "optional",
          rsvpStatus: "invited",
          kind: "human",
          deliveryStatus: "pending",
        },
      ],
    });
    expect(summarizeMeetingDeliveryProgress(meeting)).toEqual({
      totalRecipients: 3,
      deliveredCount: 1,
      failedCount: 1,
      pendingCount: 1,
    });
    expect(listFailedOrPendingDeliveryRecipientIds(meeting).toSorted()).toEqual([
      "user-3",
      "user-4",
    ]);
  });
});

describe("deliverCollabDispatchRoster", () => {
  it("routes human→workbench and agent→agent-bus; records per-recipient status", async () => {
    const deliverHuman = vi.fn(async () => ({ ok: true as const }));
    const deliverAgent = vi.fn(async () => ({ ok: true as const }));
    const adapters: CollabDispatchDeliveryAdapters = { deliverHuman, deliverAgent };

    const batch = await deliverCollabDispatchRoster({
      payload: {
        dispatchId: "m-d2",
        kind: "meeting",
        title: "Kickoff",
        organizerUserId: "user-1",
        spaceId: "space-a",
        tenantId: "tenant-a",
      },
      recipients: [
        { recipientId: "user-2", kind: "human" },
        { recipientId: "agent-bot-1", kind: "agent" },
      ],
      adapters,
    });

    expect(deliverHuman).toHaveBeenCalledTimes(1);
    expect(deliverAgent).toHaveBeenCalledTimes(1);
    expect(batch.deliveredCount).toBe(2);
    expect(batch.failedCount).toBe(0);
    expect(batch.results).toEqual([
      { recipientId: "user-2", kind: "human", status: "sent", channel: "workbench" },
      { recipientId: "agent-bot-1", kind: "agent", status: "sent", channel: "agent-bus" },
    ]);
  });

  it("records partial failure without blocking successes", async () => {
    const adapters: CollabDispatchDeliveryAdapters = {
      deliverHuman: async ({ recipientUserId }) =>
        recipientUserId === "user-fail" ? { ok: false, error: "channel down" } : { ok: true },
      deliverAgent: async () => ({ ok: true }),
    };

    const batch = await deliverCollabDispatchRoster({
      payload: {
        dispatchId: "m-partial",
        kind: "meeting",
        title: "Partial",
        organizerUserId: "user-1",
        tenantId: "tenant-a",
      },
      recipients: [
        { recipientId: "user-ok", kind: "human" },
        { recipientId: "user-fail", kind: "human" },
        { recipientId: "agent-bot-1", kind: "agent" },
      ],
      adapters,
    });

    expect(batch.deliveredCount).toBe(2);
    expect(batch.failedCount).toBe(1);
    expect(batch.results.find((r) => r.recipientId === "user-ok")?.status).toBe("sent");
    expect(batch.results.find((r) => r.recipientId === "user-fail")).toMatchObject({
      status: "failed",
      error: "channel down",
    });
    expect(batch.results.find((r) => r.recipientId === "agent-bot-1")?.status).toBe("sent");
  });

  it("fails agent delivery when no organization scope is available", async () => {
    const deliverAgent = vi.fn(async () => ({ ok: true as const }));
    const adapters: CollabDispatchDeliveryAdapters = {
      deliverHuman: async () => ({ ok: true }),
      deliverAgent,
    };
    const batch = await deliverCollabDispatchRoster({
      payload: {
        dispatchId: "m-no-org",
        kind: "meeting",
        title: "No org",
        organizerUserId: "user-1",
      },
      recipients: [{ recipientId: "agent-bot-1", kind: "agent" }],
      adapters,
    });
    expect(batch.failedCount).toBe(1);
    expect(batch.results[0]).toMatchObject({
      recipientId: "agent-bot-1",
      status: "failed",
      channel: "agent-bus",
    });
    expect(deliverAgent).not.toHaveBeenCalled();
  });

  it("retries only the requested recipient subset", async () => {
    const deliverHuman = vi.fn(async () => ({ ok: true as const }));
    const adapters: CollabDispatchDeliveryAdapters = {
      deliverHuman,
      deliverAgent: async () => ({ ok: true }),
    };
    const batch = await deliverCollabDispatchRoster({
      payload: {
        dispatchId: "m-retry",
        kind: "meeting",
        title: "Retry",
        organizerUserId: "user-1",
        tenantId: "tenant-a",
      },
      recipients: [
        { recipientId: "user-2", kind: "human" },
        { recipientId: "user-3", kind: "human" },
      ],
      onlyRecipientIds: new Set(["user-3"]),
      adapters,
    });
    expect(deliverHuman).toHaveBeenCalledTimes(1);
    const firstHumanCall = deliverHuman.mock.calls[0] as unknown as
      | [{ recipientUserId?: string }]
      | undefined;
    expect(firstHumanCall?.[0]?.recipientUserId).toBe("user-3");
    expect(batch.results).toHaveLength(1);
    expect(batch.results[0]?.recipientId).toBe("user-3");
  });
});
