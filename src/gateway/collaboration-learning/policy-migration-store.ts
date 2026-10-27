/**
 * P1-A2 — workspace-backed PolicyMigrationTxnIo (Floor Runtime v2.1 §4.2 / §7.2).
 *
 * Binds the pure txn protocol in collaboration-dispatch/policy-migration-event.ts to:
 *   - operating state: `<group>/operating-state.json` (readGroupOperatingState /
 *     writeGroupOperatingState, unchanged paths);
 *   - txn marker: `<group>/policy-migration.txn.json` (null when no txn is pending);
 *   - events: canonical collaboration ledger, kind "policy_migration", idempotent by eventId.
 *
 * Infrastructure only: nothing in the gateway calls this in P1-A2. Running a migration
 * against real groups needs a maintenance window and Owner authorisation (§7.1/§7.2).
 */
import type {
  PolicyMigrationTxn,
  PolicyMigrationTxnIo,
} from "../collaboration-dispatch/policy-migration-event.js";
import { appendCollaborationPolicyMigrationEvents } from "../collaboration-ledger/policy-migrations.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";

export const POLICY_MIGRATION_TXN_FILENAME = "policy-migration.txn.json";

export function createWorkspacePolicyMigrationTxnIo(params: {
  groupId: string;
  tenantId?: string | null;
  fileStore?: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
}): PolicyMigrationTxnIo {
  const fileStore = params.fileStore ?? createWorkspaceCollaborationStores().fileStore;
  const { groupId } = params;
  return {
    readState: async () => await readGroupOperatingState({ fileStore, groupId }),
    writeState: async (state) => {
      await writeGroupOperatingState({ fileStore, groupId, state });
    },
    readTxn: async () =>
      await fileStore.readGroupFile<PolicyMigrationTxn>({
        groupId,
        filename: POLICY_MIGRATION_TXN_FILENAME,
      }),
    writeTxn: async (txn) =>
      await fileStore.writeGroupFile({
        groupId,
        filename: POLICY_MIGRATION_TXN_FILENAME,
        data: txn,
      }),
    clearTxn: async () =>
      await fileStore.writeGroupFile({
        groupId,
        filename: POLICY_MIGRATION_TXN_FILENAME,
        data: null,
      }),
    appendEvents: async (events) => {
      await appendCollaborationPolicyMigrationEvents({
        groupId,
        tenantId: params.tenantId ?? null,
        events,
      });
    },
  };
}
