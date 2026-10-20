import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMentionEventBus } from "./mention-events.js";
import { replayJournal, type MentionStateJournalScope } from "./mention-state-journal.js";
import {
  checkEscalation,
  createMentionState,
  transitionMentionState,
} from "./mention-state-tracker.js";

async function createScope(): Promise<MentionStateJournalScope & { root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-tracker-"));
  return {
    root,
    cfg: { collaboration: { defaults: { workspace: root } } },
    workspaceDir: root,
    organizationId: "org-1",
  };
}

describe("mention state tracker", () => {
  it("creates mention state records and emits created events", async () => {
    const scope = await createScope();
    const eventBus = createMentionEventBus();
    const handler = vi.fn();
    eventBus.subscribe({ type: "mention.created" }, handler);

    const state = await createMentionState({
      ...scope,
      mention_id: "mention-1",
      source_message_id: "message-1",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
      eventBus,
    });

    expect(state).toMatchObject({
      mention_id: "mention-1",
      acknowledged: false,
      responded: false,
      resolved: false,
      created_at: "2026-05-12T00:00:00.000Z",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mention.created",
        mention_id: "mention-1",
        target_agent_id: "agent-target",
      }),
    );
    expect((await replayJournal(scope)).get("mention-1")).toMatchObject(state);
  });

  it("transitions mention states monotonically with first transition timestamps", async () => {
    const scope = await createScope();
    await createMentionState({
      ...scope,
      mention_id: "mention-1",
      source_message_id: "message-1",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
    });

    const acknowledged = await transitionMentionState({
      ...scope,
      mention_id: "mention-1",
      transition: "acknowledge",
      now: "2026-05-12T00:01:00.000Z",
    });
    const acknowledgedAgain = await transitionMentionState({
      ...scope,
      mention_id: "mention-1",
      transition: "acknowledge",
      now: "2026-05-12T00:02:00.000Z",
    });
    const responded = await transitionMentionState({
      ...scope,
      mention_id: "mention-1",
      transition: "respond",
      now: "2026-05-12T00:03:00.000Z",
    });
    const resolved = await transitionMentionState({
      ...scope,
      mention_id: "mention-1",
      transition: "resolve",
      now: "2026-05-12T00:04:00.000Z",
    });

    expect(acknowledged).toMatchObject({
      acknowledged: true,
      acknowledged_at: "2026-05-12T00:01:00.000Z",
    });
    expect(acknowledgedAgain).toMatchObject({
      acknowledged: true,
      acknowledged_at: "2026-05-12T00:01:00.000Z",
      updated_at: "2026-05-12T00:02:00.000Z",
    });
    expect(responded).toMatchObject({
      acknowledged: true,
      responded: true,
      responded_at: "2026-05-12T00:03:00.000Z",
    });
    expect(resolved).toMatchObject({
      acknowledged: true,
      responded: true,
      resolved: true,
      resolved_at: "2026-05-12T00:04:00.000Z",
    });

    expect((await replayJournal(scope)).get("mention-1")).toMatchObject({
      acknowledged: true,
      responded: true,
      resolved: true,
      acknowledged_at: "2026-05-12T00:01:00.000Z",
      responded_at: "2026-05-12T00:03:00.000Z",
      resolved_at: "2026-05-12T00:04:00.000Z",
    });
  });

  it("emits transition events and ignores unknown mentions", async () => {
    const scope = await createScope();
    const eventBus = createMentionEventBus();
    const handler = vi.fn();
    eventBus.subscribe({}, handler);
    await createMentionState({
      ...scope,
      mention_id: "mention-1",
      source_message_id: "message-1",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
      eventBus,
    });

    expect(
      await transitionMentionState({
        ...scope,
        mention_id: "missing",
        transition: "acknowledge",
        now: "2026-05-12T00:01:00.000Z",
        eventBus,
      }),
    ).toBeNull();

    await transitionMentionState({
      ...scope,
      mention_id: "mention-1",
      transition: "acknowledge",
      now: "2026-05-12T00:02:00.000Z",
      eventBus,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mention.acknowledged",
        mention_id: "mention-1",
        timestamp: "2026-05-12T00:02:00.000Z",
      }),
    );
  });

  it("detects and emits escalations for unacknowledged mentions past timeout", async () => {
    const scope = await createScope();
    const eventBus = createMentionEventBus();
    const handler = vi.fn();
    eventBus.subscribe({ type: "mention.escalated" }, handler);
    await createMentionState({
      ...scope,
      mention_id: "mention-old",
      source_message_id: "message-1",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
    });
    await createMentionState({
      ...scope,
      mention_id: "mention-acked",
      source_message_id: "message-2",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
    });
    await transitionMentionState({
      ...scope,
      mention_id: "mention-acked",
      transition: "acknowledge",
      now: "2026-05-12T00:01:00.000Z",
    });

    const escalated = await checkEscalation({
      ...scope,
      timeoutMs: 5 * 60 * 1000,
      now: "2026-05-12T00:06:00.000Z",
      eventBus,
    });

    expect(escalated.map((state) => state.mention_id)).toEqual(["mention-old"]);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mention.escalated",
        mention_id: "mention-old",
      }),
    );
  });
});
