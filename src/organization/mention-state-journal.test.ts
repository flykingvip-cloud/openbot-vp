import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendMentionEvent,
  compactMentionJournal,
  migrateMentionJournalToSqlite,
  queryMentionStates,
  replayJournal,
  type MentionStateJournalScope,
} from "./mention-state-journal.js";
import type { MentionState } from "./mention-types.js";

function state(overrides: Partial<MentionState> = {}): MentionState {
  const mention_id = overrides.mention_id ?? "mention-1";
  const created_at = overrides.created_at ?? "2026-05-12T00:00:00.000Z";
  return {
    mention_id,
    source_message_id: overrides.source_message_id ?? `message-${mention_id}`,
    source_agent_id: overrides.source_agent_id ?? "agent-source",
    target_agent_id: overrides.target_agent_id ?? "agent-target",
    organization_id: overrides.organization_id ?? "org-1",
    acknowledged: overrides.acknowledged ?? false,
    responded: overrides.responded ?? false,
    resolved: overrides.resolved ?? false,
    created_at,
    updated_at: overrides.updated_at ?? created_at,
    acknowledged_at: overrides.acknowledged_at,
    responded_at: overrides.responded_at,
    resolved_at: overrides.resolved_at,
  };
}

async function createScope(): Promise<MentionStateJournalScope & { root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-journal-"));
  return {
    root,
    cfg: { collaboration: { defaults: { workspace: root } } },
    workspaceDir: root,
    organizationId: "org-1",
  };
}

function workspaceJournalPath(root: string): string {
  return path.join(root, "groups", "org-1", "memory", "mentions.jsonl");
}

function workspaceSqlitePath(root: string): string {
  return path.join(root, "groups", "org-1", "memory", "mentions.sqlite");
}

describe("mention state journal", () => {
  it("appends events to SQLite and replays mention state transitions", async () => {
    const scope = await createScope();
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.created",
        state: state(),
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.acknowledged",
        mention_id: "mention-1",
        timestamp: "2026-05-12T00:01:00.000Z",
      },
    });

    await expect(fs.access(workspaceSqlitePath(scope.root))).resolves.toBeUndefined();

    const states = await replayJournal(scope);
    expect(states.get("mention-1")).toMatchObject({
      acknowledged: true,
      responded: false,
      resolved: false,
      updated_at: "2026-05-12T00:01:00.000Z",
      acknowledged_at: "2026-05-12T00:01:00.000Z",
    });
  });

  it("migrates legacy JSONL events to SQLite and compacts the journal snapshot", async () => {
    const scope = await createScope();
    const journalPath = workspaceJournalPath(scope.root);
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(
      journalPath,
      [
        JSON.stringify({
          type: "mention.created",
          state: state(),
        }),
        JSON.stringify({
          type: "mention.acknowledged",
          mention_id: "mention-1",
          timestamp: "2026-05-12T00:01:00.000Z",
        }),
      ].join("\n") + "\n",
    );

    const migrated = await migrateMentionJournalToSqlite(scope);
    expect(migrated).toMatchObject({
      migrated: true,
      eventsMigrated: 2,
      sqlitePath: workspaceSqlitePath(scope.root),
      journalPath,
    });

    const states = await replayJournal(scope);
    expect(states.get("mention-1")).toMatchObject({
      acknowledged: true,
      acknowledged_at: "2026-05-12T00:01:00.000Z",
    });

    const compacted = (await fs.readFile(journalPath, "utf8")).trim().split("\n");
    expect(compacted).toHaveLength(1);
    expect(JSON.parse(compacted[0])).toMatchObject({
      type: "mention.created",
      state: { mention_id: "mention-1", acknowledged: true },
    });
  });

  it("compacts legacy journals to current mention state snapshots", async () => {
    const scope = await createScope();
    const journalPath = workspaceJournalPath(scope.root);
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(
      journalPath,
      [
        JSON.stringify({
          type: "mention.created",
          state: state(),
        }),
        JSON.stringify({
          type: "mention.responded",
          mention_id: "mention-1",
          timestamp: "2026-05-12T00:02:00.000Z",
        }),
      ].join("\n") + "\n",
    );

    await compactMentionJournal(scope);

    const compacted = (await fs.readFile(journalPath, "utf8")).trim().split("\n");
    expect(compacted).toHaveLength(1);
    expect(JSON.parse(compacted[0])).toMatchObject({
      state: {
        mention_id: "mention-1",
        responded: true,
        responded_at: "2026-05-12T00:02:00.000Z",
      },
    });
  });

  it("keeps lifecycle transitions monotonic while replaying repeated events", async () => {
    const scope = await createScope();
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.created",
        state: state(),
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.responded",
        mention_id: "mention-1",
        timestamp: "2026-05-12T00:02:00.000Z",
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.responded",
        mention_id: "mention-1",
        timestamp: "2026-05-12T00:03:00.000Z",
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.resolved",
        mention_id: "mention-1",
        timestamp: "2026-05-12T00:04:00.000Z",
      },
    });

    const replayed = await replayJournal(scope);
    expect(replayed.get("mention-1")).toMatchObject({
      responded: true,
      resolved: true,
      responded_at: "2026-05-12T00:02:00.000Z",
      resolved_at: "2026-05-12T00:04:00.000Z",
      updated_at: "2026-05-12T00:04:00.000Z",
    });
  });

  it("queries mention states by source, target, acknowledgement, and limit", async () => {
    const scope = await createScope();
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.created",
        state: state({
          mention_id: "mention-a",
          source_agent_id: "agent-source",
          target_agent_id: "agent-a",
          created_at: "2026-05-12T00:00:00.000Z",
        }),
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.created",
        state: state({
          mention_id: "mention-b",
          source_agent_id: "agent-source",
          target_agent_id: "agent-b",
          created_at: "2026-05-12T00:01:00.000Z",
        }),
      },
    });
    await appendMentionEvent({
      ...scope,
      event: {
        type: "mention.acknowledged",
        mention_id: "mention-b",
        timestamp: "2026-05-12T00:03:00.000Z",
      },
    });

    const acknowledged = await queryMentionStates({
      ...scope,
      source_agent_id: "agent-source",
      acknowledged: true,
    });
    expect(acknowledged.map((entry) => entry.mention_id)).toEqual(["mention-b"]);

    const limited = await queryMentionStates({
      ...scope,
      source_agent_id: "agent-source",
      limit: 1,
    });
    expect(limited.map((entry) => entry.mention_id)).toEqual(["mention-b"]);

    const target = await queryMentionStates({
      ...scope,
      target_agent_id: "agent-a",
    });
    expect(target.map((entry) => entry.mention_id)).toEqual(["mention-a"]);
  });
});
