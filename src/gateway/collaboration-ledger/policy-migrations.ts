/**
 * P1-A2 — PolicyMigrationEvent ledger I/O (Floor Runtime v2.1 §4.2).
 *
 * Events live in the canonical collaboration ledger (`kind: "policy_migration"`),
 * resolved through the same P0.0a namespace rules as every other ledger kind.
 * Read-only query: `readCollaborationPolicyMigrations` (latest 50, optional field
 * filter). The existing read-only RPC `collaboration.ledger.list` with
 * `kinds: ["policy_migration"]` exposes the same records under the existing
 * ledger read permission.
 */
import {
  selectPolicyMigrations,
  type PolicyMigrationEvent,
} from "../collaboration-dispatch/policy-migration-event.js";
import { readCollaborationLedgerArchive } from "./reader.js";
import type { CollaborationPolicyMigrationRecord } from "./types.js";
import { appendCollaborationPolicyMigrationRecord } from "./writer.js";

async function readAllPolicyMigrationRecords(params: {
  groupId: string;
  tenantId?: string | null;
}): Promise<CollaborationPolicyMigrationRecord[]> {
  const archive = await readCollaborationLedgerArchive({
    groupId: params.groupId,
    kinds: ["policy_migration"],
    limit: 1000,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
  });
  return archive.records.filter(
    (record): record is CollaborationPolicyMigrationRecord => record.kind === "policy_migration",
  );
}

export async function readCollaborationPolicyMigrations(params: {
  groupId: string;
  tenantId?: string | null;
  field?: string | null;
  limit?: number | null;
}): Promise<CollaborationPolicyMigrationRecord[]> {
  const records = await readAllPolicyMigrationRecords(params);
  return selectPolicyMigrations(records, { field: params.field, limit: params.limit });
}

/** Idempotent append: events whose eventId is already in the ledger are skipped. */
export async function appendCollaborationPolicyMigrationEvents(params: {
  groupId: string;
  tenantId?: string | null;
  events: readonly PolicyMigrationEvent[];
}): Promise<{ appended: number; skipped: number }> {
  for (const event of params.events) {
    if (event.groupId !== params.groupId) {
      throw new Error(
        `policy migration event ${event.eventId} belongs to ${event.groupId}, not ${params.groupId}`,
      );
    }
  }
  const existing = new Set(
    (await readAllPolicyMigrationRecords(params)).map((record) => record.eventId),
  );
  let appended = 0;
  let skipped = 0;
  for (const event of params.events) {
    if (existing.has(event.eventId)) {
      skipped += 1;
      continue;
    }
    await appendCollaborationPolicyMigrationRecord({ event, tenantId: params.tenantId });
    existing.add(event.eventId);
    appended += 1;
  }
  return { appended, skipped };
}
