/**
 * Knowledge Vault Sync gateway events — revision availability only (no blobs).
 */

import { VAULT_SYNC_REVISIONS_EVENT } from "../../../../src/vault-sync/events.ts";
import type { AppPortState } from "../app-port-state.ts";
import { noteKnowledgeUniverseVaultRevisionsAvailable } from "../controllers/knowledge-universe-vault-sync.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export function handleVaultSyncGatewayEvent(host: GatewayHost, evt: GatewayEventFrame): boolean {
  if (evt.event !== VAULT_SYNC_REVISIONS_EVENT) {
    return false;
  }
  const payload = evt.payload as
    | {
        type?: string;
        vaultId?: string;
        cursor?: string;
        revisionIds?: string[];
      }
    | undefined;
  if (payload?.type && payload.type !== "revisions_available") {
    return false;
  }
  noteKnowledgeUniverseVaultRevisionsAvailable(host as unknown as AppPortState, {
    vaultId: payload?.vaultId,
    cursor: payload?.cursor,
    revisionIds: payload?.revisionIds,
  });
  return true;
}
