/**
 * Item 5 deploy helpers shared by registry rebind and production Catalog write.
 */
import { createHash } from "node:crypto";
import type { AuthorityCandidateRow } from "./phase1b-classified-persist.js";

const USER_OWNED_ASSET = /^ws:[^:]+:user:[^:]+:asset:/;

export function hashOpaqueId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function isUserOwnedAgentPrimaryCandidate(row: AuthorityCandidateRow): boolean {
  return (
    row.workspaceKind === "agent_primary" &&
    row.ownerType === "membership" &&
    row.classification === "classified" &&
    typeof row.userId === "string" &&
    Boolean(row.userId.trim()) &&
    typeof row.agentAssetId === "string" &&
    Boolean(row.agentAssetId.trim()) &&
    typeof row.resourceId === "string" &&
    USER_OWNED_ASSET.test(row.resourceId)
  );
}
