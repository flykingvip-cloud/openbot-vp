import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import type { MentionEventType, MentionState } from "./mention-types.js";
import { isMentionState } from "./mention-types.js";
import {
  resolveManagedOrganizationMemoryDir,
  resolveOrganizationMemoryDir,
} from "./task-assignment.js";

export type MentionStateJournalEvent =
  | {
      type: "mention.created";
      state: MentionState;
      timestamp?: string;
    }
  | {
      type: Exclude<MentionEventType, "mention.created">;
      mention_id: string;
      timestamp: string;
      organization_id?: string;
      source_agent_id?: string;
      target_agent_id?: string;
      payload?: Record<string, unknown>;
    };

export interface MentionStateJournalScope {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
}

export interface MentionStateQuery extends MentionStateJournalScope {
  source_agent_id?: string;
  target_agent_id?: string;
  acknowledged?: boolean;
  limit?: number;
}

export interface MentionJournalMigrationResult {
  migrated: boolean;
  sqlitePath: string;
  journalPath: string;
  eventsMigrated: number;
}

function getMentionsJournalFile(memoryDir: string): string {
  return path.join(memoryDir, "mentions.jsonl");
}

function getMentionsSqliteFile(memoryDir: string): string {
  return path.join(memoryDir, "mentions.sqlite");
}

function eventHash(event: MentionStateJournalEvent): string {
  return crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function isCreatedEvent(
  value: unknown,
): value is Extract<MentionStateJournalEvent, { type: "mention.created" }> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Record<string, unknown>).type === "mention.created" &&
    isMentionState((value as Record<string, unknown>).state)
  );
}

function isTransitionEvent(
  value: unknown,
): value is Exclude<MentionStateJournalEvent, { type: "mention.created" }> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    record.type.startsWith("mention.") &&
    record.type !== "mention.created" &&
    typeof record.mention_id === "string" &&
    typeof record.timestamp === "string"
  );
}

function isJournalEvent(value: unknown): value is MentionStateJournalEvent {
  return isCreatedEvent(value) || isTransitionEvent(value);
}

function openMentionDatabase(dbPath: string): import("node:sqlite").DatabaseSync {
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mention_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      mention_id TEXT,
      event_timestamp TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mention_events_timestamp_idx
      ON mention_events(event_timestamp);
    CREATE INDEX IF NOT EXISTS mention_events_mention_id_idx
      ON mention_events(mention_id);
  `);
  return db;
}

function eventMentionId(event: MentionStateJournalEvent): string | null {
  return event.type === "mention.created" ? event.state.mention_id : event.mention_id;
}

async function appendSqliteEvent(dbPath: string, event: MentionStateJournalEvent): Promise<void> {
  const db = openMentionDatabase(dbPath);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO mention_events
        (event_hash, event_type, mention_id, event_timestamp, event_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      eventHash(event),
      event.type,
      eventMentionId(event),
      eventTimestamp(event),
      JSON.stringify(event),
    );
  } finally {
    db.close();
  }
}

async function readSqliteEvents(dbPath: string): Promise<MentionStateJournalEvent[]> {
  try {
    await fs.access(dbPath);
  } catch {
    return [];
  }
  const db = openMentionDatabase(dbPath);
  try {
    return db
      .prepare("SELECT event_json FROM mention_events ORDER BY event_timestamp ASC, id ASC")
      .all()
      .map((row) => {
        try {
          return JSON.parse(String((row as { event_json?: unknown }).event_json)) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isJournalEvent);
  } finally {
    db.close();
  }
}

async function readJournalFile(filePath: string): Promise<MentionStateJournalEvent[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isJournalEvent);
  } catch {
    return [];
  }
}

function eventTimestamp(event: MentionStateJournalEvent): string {
  return event.type === "mention.created"
    ? (event.timestamp ?? event.state.created_at)
    : event.timestamp;
}

function applyTransition(
  state: MentionState,
  event: Exclude<MentionStateJournalEvent, { type: "mention.created" }>,
): MentionState {
  if (event.type === "mention.acknowledged") {
    return {
      ...state,
      acknowledged: true,
      updated_at: event.timestamp,
      acknowledged_at: state.acknowledged_at ?? event.timestamp,
    };
  }
  if (event.type === "mention.responded") {
    return {
      ...state,
      responded: true,
      updated_at: event.timestamp,
      responded_at: state.responded_at ?? event.timestamp,
    };
  }
  if (event.type === "mention.resolved") {
    return {
      ...state,
      resolved: true,
      updated_at: event.timestamp,
      resolved_at: state.resolved_at ?? event.timestamp,
    };
  }
  return {
    ...state,
    updated_at: event.timestamp,
  };
}

function replayEvents(events: MentionStateJournalEvent[]): Map<string, MentionState> {
  const states = new Map<string, MentionState>();
  const orderedEvents = events.toSorted((left, right) =>
    eventTimestamp(left).localeCompare(eventTimestamp(right)),
  );

  for (const event of orderedEvents) {
    if (event.type === "mention.created") {
      states.set(event.state.mention_id, event.state);
      continue;
    }
    const current = states.get(event.mention_id);
    if (!current) {
      continue;
    }
    states.set(event.mention_id, applyTransition(current, event));
  }

  return states;
}

export async function appendMentionEvent(
  params: MentionStateJournalScope & {
    event: MentionStateJournalEvent;
  },
): Promise<void> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  await fs.mkdir(memoryDir, { recursive: true });
  try {
    await appendSqliteEvent(getMentionsSqliteFile(memoryDir), params.event);
  } catch {
    const journalPath = getMentionsJournalFile(memoryDir);
    await fs.appendFile(journalPath, `${JSON.stringify(params.event)}\n`);
    await compactMentionJournalIfNeeded(params);
  }
}

export async function replayJournal(
  params: MentionStateJournalScope,
): Promise<Map<string, MentionState>> {
  const workspaceMemoryDir = resolveOrganizationMemoryDir(params);
  const managedMemoryDir = resolveManagedOrganizationMemoryDir(params.organizationId);
  const workspaceSqlite = getMentionsSqliteFile(workspaceMemoryDir);
  const managedSqlite = getMentionsSqliteFile(managedMemoryDir);
  const workspaceJournal = getMentionsJournalFile(workspaceMemoryDir);
  const managedJournal = getMentionsJournalFile(managedMemoryDir);
  const [managedSqliteEvents, workspaceSqliteEvents] = await Promise.all([
    readSqliteEvents(managedSqlite),
    readSqliteEvents(workspaceSqlite),
  ]);
  const [managedEvents, workspaceEvents] = await Promise.all([
    managedSqliteEvents.length > 0 ? managedSqliteEvents : readJournalFile(managedJournal),
    workspaceSqliteEvents.length > 0 ? workspaceSqliteEvents : readJournalFile(workspaceJournal),
  ]);
  return replayEvents([...managedEvents, ...workspaceEvents]);
}

export async function migrateMentionJournalToSqlite(
  params: MentionStateJournalScope,
): Promise<MentionJournalMigrationResult> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  await fs.mkdir(memoryDir, { recursive: true });
  const journalPath = getMentionsJournalFile(memoryDir);
  const sqlitePath = getMentionsSqliteFile(memoryDir);
  const legacyEvents = await readJournalFile(journalPath);
  if (legacyEvents.length === 0) {
    return {
      migrated: false,
      sqlitePath,
      journalPath,
      eventsMigrated: 0,
    };
  }

  const db = openMentionDatabase(sqlitePath);
  try {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO mention_events
        (event_hash, event_type, mention_id, event_timestamp, event_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const event of legacyEvents) {
      insert.run(
        eventHash(event),
        event.type,
        eventMentionId(event),
        eventTimestamp(event),
        JSON.stringify(event),
      );
    }
  } finally {
    db.close();
  }

  await compactMentionJournal(params);
  return {
    migrated: true,
    sqlitePath,
    journalPath,
    eventsMigrated: legacyEvents.length,
  };
}

export async function compactMentionJournal(params: MentionStateJournalScope): Promise<void> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  const journalPath = getMentionsJournalFile(memoryDir);
  const events = await readJournalFile(journalPath);
  if (events.length === 0) {
    return;
  }
  const states = replayEvents(events);
  const compacted = [...states.values()]
    .toSorted((left, right) => left.created_at.localeCompare(right.created_at))
    .map(
      (entry): MentionStateJournalEvent => ({
        type: "mention.created",
        state: entry,
        timestamp: entry.updated_at,
      }),
    );
  const tmpPath = `${journalPath}.tmp`;
  const content =
    compacted.length > 0 ? `${compacted.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
  await fs.writeFile(compacted.length > 0 ? tmpPath : journalPath, content);
  if (compacted.length > 0) {
    await fs.rename(tmpPath, journalPath);
  }
}

async function compactMentionJournalIfNeeded(params: MentionStateJournalScope): Promise<void> {
  const memoryDir = resolveOrganizationMemoryDir(params);
  const journalPath = getMentionsJournalFile(memoryDir);
  const raw = await fs.readFile(journalPath, "utf8").catch(() => "");
  const lineCount = raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  if (lineCount >= 200) {
    await compactMentionJournal(params);
  }
}

export async function queryMentionStates(params: MentionStateQuery): Promise<MentionState[]> {
  const states = await replayJournal(params);
  const limit = Math.max(0, Math.trunc(params.limit ?? Number.POSITIVE_INFINITY));
  const filtered = [...states.values()]
    .filter((state) =>
      params.source_agent_id ? state.source_agent_id === params.source_agent_id : true,
    )
    .filter((state) =>
      params.target_agent_id ? state.target_agent_id === params.target_agent_id : true,
    )
    .filter((state) =>
      typeof params.acknowledged === "boolean" ? state.acknowledged === params.acknowledged : true,
    )
    .toSorted((left, right) => right.updated_at.localeCompare(left.updated_at));

  return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}
