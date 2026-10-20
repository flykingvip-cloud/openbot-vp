/**
 * CollabDispatch store (Sprint D3/D4) — deploy / notice / summon adapters.
 *
 * Design: docs/design/org-collab-dispatch-dev-2026-09-27.md §3 / §4 / Sprint D3–D4.
 * Meeting remains its own store (D1/D2); these kinds reuse the same release →
 * deliver → organizer projection → recipient ack → recipient projection protocol
 * without exploding into separate root entities.
 *
 * No LLM. confirmationToken never appears here.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { inferMeetingRecipientKind, type MeetingRecipientKind } from "./meeting-store.js";

export type CollabDispatchKind = "deploy" | "notice" | "summon";
export type CollabDispatchStatus = "draft" | "pending_organizer_confirm" | "released" | "cancelled";
export type CollabDispatchAckStatus = "none" | "pending" | "acked" | "declined";
export type CollabDispatchDeliveryStatus = "pending" | "sent" | "failed";
export type CollabDispatchRecipientRole = "required" | "optional" | "organizer";
export type CollabDispatchRecipientKind = MeetingRecipientKind;
export type CollabDispatchAudienceMode = "roster" | "space" | "tenant";

export type CollabDispatchTimeWindow = {
  startAtMs: number;
  endAtMs?: number;
  timezone: string;
};

export type CollabDispatchRecipient = {
  id: string;
  kind: CollabDispatchRecipientKind;
  role?: CollabDispatchRecipientRole;
  deliveryStatus: CollabDispatchDeliveryStatus;
  ackStatus: CollabDispatchAckStatus;
  ackedAtMs?: number;
  /** Projection outcome (ScheduleEntry or todo) after eligible write. */
  scheduleProjection?: "none" | "ok" | "failed";
};

export type CollabDispatchProjection = {
  userId: string;
  status: "ok" | "failed";
  mode: "schedule" | "todo";
  error?: string;
  atMs: number;
};

export type CollabDispatch = {
  id: string;
  tenantId: string;
  kind: CollabDispatchKind;
  title: string;
  body: string;
  organizerUserId: string;
  timeWindow?: CollabDispatchTimeWindow;
  audience: {
    mode: CollabDispatchAudienceMode;
    spaceId?: string;
  };
  recipients: CollabDispatchRecipient[];
  status: CollabDispatchStatus;
  confirmation?: {
    proposalId: string;
    expiresAtMs: number;
  };
  sourceRef?: {
    kind: "manual" | "deploy";
    id: string;
  };
  /** Per-user projection outcomes (organizer on release; recipients after ack). */
  projections?: CollabDispatchProjection[];
  createdAt: string;
  updatedAt: string;
};

type StoredCollabDispatches = {
  dispatches?: CollabDispatch[];
};

export const COLLAB_DISPATCH_STATUS_TRANSITIONS: Record<
  CollabDispatchStatus,
  readonly CollabDispatchStatus[]
> = {
  draft: ["pending_organizer_confirm", "cancelled"],
  pending_organizer_confirm: ["released", "cancelled"],
  released: ["cancelled"],
  cancelled: [],
};

const KINDS = new Set<CollabDispatchKind>(["deploy", "notice", "summon"]);
const STATUSES = new Set<CollabDispatchStatus>([
  "draft",
  "pending_organizer_confirm",
  "released",
  "cancelled",
]);
const ACK_STATUSES = new Set<CollabDispatchAckStatus>(["none", "pending", "acked", "declined"]);
const DELIVERY_STATUSES = new Set<CollabDispatchDeliveryStatus>(["pending", "sent", "failed"]);

export class CollabDispatchTransitionError extends Error {}

function nowIso(now: Date | string | undefined): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function isCollabDispatchKind(value: unknown): value is CollabDispatchKind {
  return typeof value === "string" && KINDS.has(value as CollabDispatchKind);
}

export function inferCollabDispatchRecipientKind(userId: string): CollabDispatchRecipientKind {
  return inferMeetingRecipientKind(userId);
}

function normalizeRecipients(
  organizerUserId: string,
  raw: ReadonlyArray<{
    id: string;
    kind?: CollabDispatchRecipientKind;
    role?: CollabDispatchRecipientRole;
    deliveryStatus?: CollabDispatchDeliveryStatus;
    ackStatus?: CollabDispatchAckStatus;
    ackedAtMs?: number;
    scheduleProjection?: CollabDispatchRecipient["scheduleProjection"];
  }>,
): CollabDispatchRecipient[] {
  const organizerKey = normalizeIdentity(organizerUserId);
  const byId = new Map<string, CollabDispatchRecipient>();
  byId.set(organizerKey, {
    id: organizerUserId.trim(),
    kind: "human",
    role: "organizer",
    deliveryStatus: "pending",
    ackStatus: "acked",
  });
  for (const entry of raw) {
    const id = entry.id?.trim();
    if (!id) {
      continue;
    }
    const key = normalizeIdentity(id);
    if (key === organizerKey) {
      continue;
    }
    const kind =
      entry.kind === "agent" || entry.kind === "human"
        ? entry.kind
        : inferCollabDispatchRecipientKind(id);
    byId.set(key, {
      id,
      kind,
      role: entry.role === "optional" ? "optional" : "required",
      deliveryStatus:
        entry.deliveryStatus && DELIVERY_STATUSES.has(entry.deliveryStatus)
          ? entry.deliveryStatus
          : "pending",
      ackStatus: entry.ackStatus && ACK_STATUSES.has(entry.ackStatus) ? entry.ackStatus : "none",
      ...(entry.ackedAtMs !== undefined ? { ackedAtMs: entry.ackedAtMs } : {}),
      ...(entry.scheduleProjection ? { scheduleProjection: entry.scheduleProjection } : {}),
    });
  }
  return [...byId.values()];
}

export function createCollabDispatch(params: {
  organizerUserId: string;
  tenantId: string;
  kind: CollabDispatchKind;
  title: string;
  body?: string;
  timeWindow?: CollabDispatchTimeWindow;
  audience?: { mode?: CollabDispatchAudienceMode; spaceId?: string };
  recipients?: ReadonlyArray<{
    id: string;
    kind?: CollabDispatchRecipientKind;
    role?: CollabDispatchRecipientRole;
  }>;
  sourceRef?: CollabDispatch["sourceRef"];
  id?: string;
  now?: Date | string;
}): CollabDispatch {
  if (!isCollabDispatchKind(params.kind)) {
    throw new CollabDispatchTransitionError(
      `unsupported CollabDispatch kind: ${String(params.kind)}`,
    );
  }
  const createdAt = nowIso(params.now);
  const organizerUserId = params.organizerUserId.trim();
  const tenantId = params.tenantId.trim();
  if (!organizerUserId || !tenantId) {
    throw new CollabDispatchTransitionError("organizerUserId and tenantId are required");
  }
  const spaceId = params.audience?.spaceId?.trim();
  // D4: space|tenant only when explicitly set; default remains roster (§5.2).
  const audienceMode: CollabDispatchAudienceMode =
    params.audience?.mode === "space" || params.audience?.mode === "tenant"
      ? params.audience.mode
      : "roster";
  if (audienceMode === "space" && !spaceId) {
    throw new CollabDispatchTransitionError("audience.mode=space requires audience.spaceId");
  }
  const timeWindow = params.timeWindow
    ? {
        startAtMs: params.timeWindow.startAtMs,
        ...(params.timeWindow.endAtMs !== undefined ? { endAtMs: params.timeWindow.endAtMs } : {}),
        timezone: params.timeWindow.timezone?.trim() || "UTC",
      }
    : undefined;
  if (timeWindow && (!Number.isFinite(timeWindow.startAtMs) || timeWindow.startAtMs <= 0)) {
    throw new CollabDispatchTransitionError("timeWindow.startAtMs must be a positive epoch-ms");
  }
  if (
    timeWindow?.endAtMs !== undefined &&
    (!Number.isFinite(timeWindow.endAtMs) || timeWindow.endAtMs < timeWindow.startAtMs)
  ) {
    throw new CollabDispatchTransitionError("timeWindow.endAtMs must be >= startAtMs");
  }
  return {
    id: params.id?.trim() || randomUUID(),
    tenantId,
    kind: params.kind,
    title: params.title.trim(),
    body: (params.body ?? "").trim(),
    organizerUserId,
    ...(timeWindow ? { timeWindow } : {}),
    audience: {
      mode: audienceMode,
      ...(spaceId ? { spaceId } : {}),
    },
    recipients: normalizeRecipients(organizerUserId, params.recipients ?? []),
    status: "draft",
    ...(params.sourceRef ? { sourceRef: params.sourceRef } : {}),
    createdAt,
    updatedAt: createdAt,
  };
}

export function canTransitionCollabDispatch(
  from: CollabDispatchStatus,
  to: CollabDispatchStatus,
): boolean {
  return COLLAB_DISPATCH_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionCollabDispatch(
  dispatch: CollabDispatch,
  to: CollabDispatchStatus,
  opts?: { now?: Date | string; confirmation?: CollabDispatch["confirmation"] },
): CollabDispatch {
  if (!canTransitionCollabDispatch(dispatch.status, to)) {
    throw new CollabDispatchTransitionError(
      `illegal CollabDispatch transition: ${dispatch.status} -> ${to}`,
    );
  }
  return {
    ...dispatch,
    status: to,
    updatedAt: nowIso(opts?.now),
    ...(opts?.confirmation !== undefined ? { confirmation: opts.confirmation } : {}),
    ...(to === "released" || to === "cancelled" ? { confirmation: undefined } : {}),
  };
}

export function updateCollabDispatchRecipient(
  dispatch: CollabDispatch,
  recipientId: string,
  patch: Partial<
    Pick<
      CollabDispatchRecipient,
      "deliveryStatus" | "ackStatus" | "ackedAtMs" | "scheduleProjection" | "kind" | "role"
    >
  >,
  now?: Date | string,
): CollabDispatch {
  const key = normalizeIdentity(recipientId);
  if (!key) {
    throw new CollabDispatchTransitionError("recipient id is required");
  }
  const organizerKey = normalizeIdentity(dispatch.organizerUserId);
  let found = false;
  const recipients = dispatch.recipients.map((recipient) => {
    if (normalizeIdentity(recipient.id) !== key) {
      return recipient;
    }
    found = true;
    if (key === organizerKey) {
      return {
        ...recipient,
        role: "organizer" as const,
        ackStatus: "acked" as const,
        ...(patch.deliveryStatus ? { deliveryStatus: patch.deliveryStatus } : {}),
        ...(patch.scheduleProjection ? { scheduleProjection: patch.scheduleProjection } : {}),
      };
    }
    return {
      ...recipient,
      ...patch,
    };
  });
  if (!found) {
    throw new CollabDispatchTransitionError(`recipient not on dispatch roster: ${recipientId}`);
  }
  return {
    ...dispatch,
    recipients,
    updatedAt: nowIso(now),
  };
}

/** On release: non-organizer humans/agents become ack-pending. */
export function markCollabDispatchRecipientsAckPending(
  dispatch: CollabDispatch,
  now?: Date | string,
): CollabDispatch {
  const organizerKey = normalizeIdentity(dispatch.organizerUserId);
  const recipients = dispatch.recipients.map((recipient) => {
    if (normalizeIdentity(recipient.id) === organizerKey) {
      return {
        ...recipient,
        role: "organizer" as const,
        ackStatus: "acked" as const,
      };
    }
    if (recipient.ackStatus === "acked" || recipient.ackStatus === "declined") {
      return recipient;
    }
    return {
      ...recipient,
      ackStatus: "pending" as const,
      deliveryStatus: recipient.deliveryStatus ?? "pending",
    };
  });
  return {
    ...dispatch,
    recipients,
    updatedAt: nowIso(now),
  };
}

function isCollabDispatch(value: unknown): value is CollabDispatch {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.tenantId === "string" &&
    typeof record.organizerUserId === "string" &&
    typeof record.title === "string" &&
    typeof record.body === "string" &&
    typeof record.kind === "string" &&
    KINDS.has(record.kind as CollabDispatchKind) &&
    typeof record.status === "string" &&
    STATUSES.has(record.status as CollabDispatchStatus) &&
    Array.isArray(record.recipients)
  );
}

function resolveDispatchesDir(organizerUserId: string): string {
  return path.join(
    resolveStateDir(),
    "collab-dispatches",
    encodePathSegment(organizerUserId.trim()),
  );
}

function getDispatchesFile(organizerUserId: string): string {
  return path.join(resolveDispatchesDir(organizerUserId), "dispatches.json");
}

export async function readOrganizerCollabDispatches(
  organizerUserId: string,
): Promise<CollabDispatch[]> {
  if (!organizerUserId.trim()) {
    return [];
  }
  try {
    const value = JSON.parse(await fs.readFile(getDispatchesFile(organizerUserId), "utf8")) as
      | StoredCollabDispatches
      | unknown[];
    const dispatches: unknown[] = Array.isArray(value)
      ? value
      : Array.isArray(value.dispatches)
        ? (value.dispatches ?? [])
        : [];
    const ownerKey = normalizeIdentity(organizerUserId);
    return dispatches
      .filter(isCollabDispatch)
      .filter((row) => normalizeIdentity(row.organizerUserId) === ownerKey);
  } catch {
    return [];
  }
}

export async function writeOrganizerCollabDispatches(
  organizerUserId: string,
  dispatches: CollabDispatch[],
): Promise<void> {
  const dir = resolveDispatchesDir(organizerUserId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    getDispatchesFile(organizerUserId),
    `${JSON.stringify({ dispatches }, null, 2)}\n`,
  );
}

export async function upsertCollabDispatch(dispatch: CollabDispatch): Promise<CollabDispatch> {
  const persisted: CollabDispatch = { ...dispatch, id: dispatch.id.trim() || randomUUID() };
  const existing = await readOrganizerCollabDispatches(persisted.organizerUserId);
  const byId = new Map(existing.map((item) => [item.id, item]));
  byId.set(persisted.id, persisted);
  await writeOrganizerCollabDispatches(persisted.organizerUserId, [...byId.values()]);
  return persisted;
}

export async function listAllCollabDispatches(): Promise<CollabDispatch[]> {
  const root = path.join(resolveStateDir(), "collab-dispatches");
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(root);
  } catch {
    return [];
  }
  const all: CollabDispatch[] = [];
  for (const dir of dirEntries) {
    let organizerUserId: string;
    try {
      organizerUserId = decodeURIComponent(dir);
    } catch {
      continue;
    }
    all.push(...(await readOrganizerCollabDispatches(organizerUserId)));
  }
  return all;
}

export async function findCollabDispatchById(dispatchId: string): Promise<CollabDispatch | null> {
  const id = dispatchId.trim();
  if (!id) {
    return null;
  }
  const all = await listAllCollabDispatches();
  return all.find((row) => row.id === id) ?? null;
}

/** Resolve org scope for todos / agent bus (space → tenant → organizer-scoped). */
export function resolveCollabDispatchOrganizationId(dispatch: CollabDispatch): string {
  return (
    dispatch.audience.spaceId?.trim() ||
    dispatch.tenantId.trim() ||
    `user:${dispatch.organizerUserId.trim()}`
  );
}

export function collabDispatchHasTimeWindow(dispatch: CollabDispatch): boolean {
  return Boolean(dispatch.timeWindow && Number.isFinite(dispatch.timeWindow.startAtMs));
}
