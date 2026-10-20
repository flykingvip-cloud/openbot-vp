import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { WorkbenchScheduleEntry } from "../gateway/workbench/schedule-read-model.js";

/**
 * Per-user `ScheduleEntry` store (Phase A1). The persistence layer behind the
 * deterministic schedule domain: the today-schedule read model (A0) reads
 * entries through this store, and the `schedule.entry.*` write RPCs mutate it.
 *
 * Keyed by `ownerUserId`: each user's entries live in their OWN file, so an
 * actor-scoped read/write touches exactly one user's data and cannot leak across
 * users by construction (the HYB cross-tenant lesson — isolation is structural,
 * not a filter we could forget). `tenantId` is stored on the entry for the read
 * model's tenant guard, but is NOT part of the storage key.
 *
 * The persisted shape is exactly `WorkbenchScheduleEntry` (the design's minimal
 * ScheduleEntry — no extra store metadata yet); cancellation is a status flip,
 * never a hard delete, so the read model can keep filtering cancelled items.
 */

type StoredScheduleEntries = {
  entries?: WorkbenchScheduleEntry[];
};

const SCHEDULE_ENTRY_KINDS = new Set<WorkbenchScheduleEntry["kind"]>([
  "personal",
  "reminder",
  "cron-derived",
  "meeting",
  "notice",
]);
const SCHEDULE_ENTRY_STATUSES = new Set<WorkbenchScheduleEntry["status"]>([
  "confirmed",
  "cancelled",
  "done",
]);

/**
 * Kinds a human-facing manual write (workbench UI or steward tool) may create.
 * `cron-derived` is synthetic (the read model derives it from cron jobs) and
 * `meeting` is owned by the meeting pipeline (Phase B), so neither is writable
 * through the manual path.
 */
export const WRITABLE_SCHEDULE_KINDS = new Set<WorkbenchScheduleEntry["kind"]>([
  "personal",
  "reminder",
]);

/**
 * Builds a manual `ScheduleEntry` from already-validated inputs, stamping the
 * owner/tenant (the caller must pass the resolved actor's ids — never the
 * client's) and coercing a non-writable kind to `personal`. Shared by the
 * `schedule.entry.upsert` RPC and the steward schedule tool so both produce an
 * identical entry shape (one write path, no V2 copy).
 */
export function buildManualScheduleEntry(input: {
  id?: string;
  ownerUserId: string;
  tenantId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone?: string;
  kind?: string;
}): WorkbenchScheduleEntry {
  const id = (input.id ?? "").trim();
  const kind = WRITABLE_SCHEDULE_KINDS.has(input.kind as WorkbenchScheduleEntry["kind"])
    ? (input.kind as WorkbenchScheduleEntry["kind"])
    : "personal";
  return {
    id,
    ownerUserId: input.ownerUserId,
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    title: input.title.trim(),
    startAtMs: input.startAtMs,
    ...(input.endAtMs !== undefined ? { endAtMs: input.endAtMs } : {}),
    timezone: input.timezone?.trim() || "UTC",
    kind,
    status: "confirmed",
    sourceRef: { kind: "manual", id: id || "manual" },
  };
}

/**
 * Builds a meeting-derived ScheduleEntry for one attendee (Phase B). The id is
 * deterministic per (meeting, attendee) so re-confirming a meeting replaces rather
 * than duplicates the attendee's entry, and cancelling can target it by id. The
 * owner is the attendee (the entry lands in THEIR per-user store); `sourceRef`
 * records the originating meeting for provenance.
 */
export function buildMeetingScheduleEntry(params: {
  meetingId: string;
  attendeeUserId: string;
  tenantId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone?: string;
  location?: string;
  joinUrl?: string;
}): WorkbenchScheduleEntry {
  const location = params.location?.trim();
  const joinUrl = params.joinUrl?.trim();
  return {
    id: meetingScheduleEntryId(params.meetingId, params.attendeeUserId),
    ownerUserId: params.attendeeUserId,
    ...(params.tenantId !== undefined ? { tenantId: params.tenantId } : {}),
    title: params.title.trim(),
    startAtMs: params.startAtMs,
    ...(params.endAtMs !== undefined ? { endAtMs: params.endAtMs } : {}),
    timezone: params.timezone?.trim() || "UTC",
    kind: "meeting",
    status: "confirmed",
    sourceRef: { kind: "meeting", id: params.meetingId },
    ...(location ? { location } : {}),
    ...(joinUrl ? { joinUrl } : {}),
  };
}

/** Deterministic ScheduleEntry id for a meeting attendee (stable across re-confirm). */
export function meetingScheduleEntryId(meetingId: string, attendeeUserId: string): string {
  return `meeting:${meetingId}:${attendeeUserId}`;
}

/**
 * Builds a CollabDispatch-derived ScheduleEntry for one user when the dispatch
 * has a time window (Sprint D3 §5.3). Kinds without a time window must use the
 * todo projection path instead — do not call this for timeless notices.
 */
export function buildCollabDispatchScheduleEntry(params: {
  dispatchId: string;
  ownerUserId: string;
  tenantId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone?: string;
}): WorkbenchScheduleEntry {
  return {
    id: collabDispatchScheduleEntryId(params.dispatchId, params.ownerUserId),
    ownerUserId: params.ownerUserId,
    ...(params.tenantId !== undefined ? { tenantId: params.tenantId } : {}),
    title: params.title.trim(),
    startAtMs: params.startAtMs,
    ...(params.endAtMs !== undefined ? { endAtMs: params.endAtMs } : {}),
    timezone: params.timezone?.trim() || "UTC",
    kind: "notice",
    status: "confirmed",
    sourceRef: { kind: "collab-dispatch", id: params.dispatchId },
  };
}

/** Deterministic ScheduleEntry id for a CollabDispatch recipient (stable across re-release). */
export function collabDispatchScheduleEntryId(dispatchId: string, ownerUserId: string): string {
  return `collab:${dispatchId}:${ownerUserId}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function resolveScheduleDir(userId: string): string {
  return path.join(resolveStateDir(), "schedule", encodePathSegment(userId.trim()));
}

function getEntriesFile(userId: string): string {
  return path.join(resolveScheduleDir(userId), "entries.json");
}

function isScheduleEntry(value: unknown): value is WorkbenchScheduleEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const sourceRef = record.sourceRef as Record<string, unknown> | undefined;
  return (
    typeof record.id === "string" &&
    typeof record.ownerUserId === "string" &&
    typeof record.title === "string" &&
    typeof record.startAtMs === "number" &&
    Number.isFinite(record.startAtMs) &&
    typeof record.timezone === "string" &&
    typeof record.kind === "string" &&
    SCHEDULE_ENTRY_KINDS.has(record.kind as WorkbenchScheduleEntry["kind"]) &&
    typeof record.status === "string" &&
    SCHEDULE_ENTRY_STATUSES.has(record.status as WorkbenchScheduleEntry["status"]) &&
    Boolean(sourceRef) &&
    typeof sourceRef?.kind === "string" &&
    typeof sourceRef?.id === "string"
  );
}

/**
 * Reads a single user's schedule entries. A missing or corrupt file yields an
 * empty list (never throws) so a not-yet-created store degrades to "no schedule"
 * rather than an error.
 */
export async function readUserScheduleEntries(userId: string): Promise<WorkbenchScheduleEntry[]> {
  if (!userId.trim()) {
    return [];
  }
  try {
    const value = JSON.parse(await fs.readFile(getEntriesFile(userId), "utf8")) as
      | StoredScheduleEntries
      | unknown[];
    const entries: unknown[] = Array.isArray(value)
      ? value
      : Array.isArray(value.entries)
        ? (value.entries ?? [])
        : [];
    // Only return entries that actually belong to this user (defensive: a
    // hand-edited or migrated file must never hand one user another's rows).
    const normalizedOwner = userId.trim().toLowerCase();
    return entries
      .filter(isScheduleEntry)
      .filter((entry) => entry.ownerUserId.trim().toLowerCase() === normalizedOwner);
  } catch {
    return [];
  }
}

export async function writeUserScheduleEntries(
  userId: string,
  entries: WorkbenchScheduleEntry[],
): Promise<void> {
  const dir = resolveScheduleDir(userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getEntriesFile(userId), `${JSON.stringify({ entries }, null, 2)}\n`);
}

/**
 * Inserts or replaces an entry in its owner's file (keyed by `entry.id`). A
 * missing id is assigned a fresh UUID. Returns the persisted entry.
 */
export async function upsertScheduleEntry(
  entry: WorkbenchScheduleEntry,
): Promise<WorkbenchScheduleEntry> {
  const persisted: WorkbenchScheduleEntry = {
    ...entry,
    id: entry.id.trim() || randomUUID(),
  };
  const existing = await readUserScheduleEntries(persisted.ownerUserId);
  const byId = new Map(existing.map((item) => [item.id, item]));
  byId.set(persisted.id, persisted);
  await writeUserScheduleEntries(persisted.ownerUserId, [...byId.values()]);
  return persisted;
}

/**
 * Marks an entry cancelled (soft delete — a status flip, never a hard delete).
 * Idempotent: cancelling an already-cancelled entry returns it unchanged.
 * Returns null when no entry with that id exists for the user.
 */
export async function cancelScheduleEntry(params: {
  userId: string;
  id: string;
}): Promise<WorkbenchScheduleEntry | null> {
  const id = params.id.trim();
  if (!id) {
    return null;
  }
  const existing = await readUserScheduleEntries(params.userId);
  const target = existing.find((item) => item.id === id);
  if (!target) {
    return null;
  }
  if (target.status === "cancelled") {
    return target;
  }
  const cancelled: WorkbenchScheduleEntry = { ...target, status: "cancelled" };
  const next = existing.map((item) => (item.id === id ? cancelled : item));
  await writeUserScheduleEntries(params.userId, next);
  return cancelled;
}
