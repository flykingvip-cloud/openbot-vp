/**
 * Owner scope for “我的资产” (personal skill accumulation).
 *
 * The skill-asset store is machine-global. Listing without an owner floods every
 * caller with other users' drafts, knowledge collects, and auto-captured deliverables.
 * Generation paths must stamp ownerUserId; the list/detail RPCs fail-closed on it.
 *
 * Identity is server-stamped on the connected client. ConnectParams may carry an
 * optional claimed `user` (Control UI trusted-proxy email bootstrap); that field
 * is never an authenticated subject for personal-asset ownership. Clients
 * authenticate with `auth.token`, `auth.deviceToken`, or `auth.password`.
 * After handshake the gateway sets:
 * - `client.user` — session email (trusted-proxy or platform cookie)
 * - `client.platformUserId` — platform user id from that session
 * - `client.pairedDeviceId` — device id the handshake verified and stored.
 *   Personal-asset owner lookup uses only this field, then the pairing store's
 *   `ownerId`. `connect.device.id` is client-supplied and is ignored.
 * A handshake with neither session user nor a server-set paired device is not a
 * personal-asset user. RPC params must not supply an owner.
 *
 * Platform user id (when present) and client email are aliases of the same person.
 * Assets stamped with either must remain visible to that caller.
 */

import { getPairedDevice } from "../infra/device-pairing.js";
import { resolveKnowledgeSourceContext } from "./knowledge/context.js";
import type { GatewayClient } from "./server-methods/types.js";
import {
  getPersonalSkillAssetDetail,
  listPersonalSkillAssets,
  SkillAssetStoreError,
  type EmployeeSkillDetail,
  type EmployeeSkillSummary,
} from "./skill-lifecycle-store.js";

/** Conversation outputs and knowledge-library documents are not 我的资产. */
const EXCLUDED_FROM_MY_ASSETS_CATEGORIES = new Set(["对话成果", "知识收录", "上传文档"]);
const SYSTEM_MATERIALIZED_LINEAGE_PREFIXES = ["enterprise-capability:", "pack-install:"] as const;

export type MyAccumulationAsset = EmployeeSkillSummary;

function normalizeOwnerUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return null;
  }
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

/** Session email stamped by the gateway. Connect params are not an identity source. */
function clientSessionEmail(client: GatewayClient | null | undefined): string | null {
  const direct = typeof client?.user === "string" ? client.user.trim() : "";
  return direct ? normalizeOwnerUserId(direct) : null;
}

/** Server-stamped device id from the verified handshake. Connect device id is not trusted. */
function authenticatedDeviceId(client: GatewayClient): string {
  return client.pairedDeviceId?.trim() || "";
}

/**
 * Device-token connects often have no session email. The pairing record for the
 * server-set `pairedDeviceId` stores the approving user's platform id.
 */
async function fillPlatformUserIdFromAuthenticatedDevice(client: GatewayClient): Promise<void> {
  if (client.platformUserId?.trim()) {
    return;
  }
  const deviceId = authenticatedDeviceId(client);
  if (!deviceId) {
    return;
  }
  try {
    const ownerId = (await getPairedDevice(deviceId))?.ownerId?.trim();
    if (ownerId) {
      client.platformUserId = ownerId;
    }
  } catch {
    // Pairing store is optional; session email can still identify the caller.
  }
}

function uniqueOwnerIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const normalized = normalizeOwnerUserId(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

/**
 * All identities that may own personal assets for this caller.
 * Platform user id is first when present; email is always included as an alias
 * so assets stamped before platform hydration remain reachable.
 */
export async function resolvePersonalAssetOwnerIdentities(
  client: GatewayClient | null | undefined,
): Promise<string[]> {
  if (!client) {
    return [];
  }
  await fillPlatformUserIdFromAuthenticatedDevice(client);
  const platformUserId = normalizeOwnerUserId(client.platformUserId);
  const email = clientSessionEmail(client);
  let knowledgeUserId: string | null = null;
  try {
    const context = await resolveKnowledgeSourceContext(client);
    knowledgeUserId = normalizeOwnerUserId(context.userId);
  } catch {
    // Local tests often have email or platformUserId only.
  }
  // Platform user id is the preferred stamp. Knowledge id and email stay aliases.
  return uniqueOwnerIds([platformUserId, knowledgeUserId, email]);
}

/** Preferred stamp identity: platform user id, else authenticated email. */
export async function resolvePersonalAssetOwnerUserId(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  const ids = await resolvePersonalAssetOwnerIdentities(client);
  return ids[0] ?? null;
}

/**
 * True when the skill belongs in 我的资产 (installable, executable capability).
 * Knowledge documents, auto-captured 成果, and enterprise/pack install copies
 * are stored as skills for other surfaces and must not pollute this list.
 */
export function isEmployeeMyAccumulationAsset(asset: {
  profile: { category?: string; assetType?: string };
  sourceLineageId?: string | null;
}): boolean {
  if (asset.profile.assetType?.trim() === "knowledge") {
    return false;
  }
  const category = asset.profile.category?.trim() ?? "";
  if (EXCLUDED_FROM_MY_ASSETS_CATEGORIES.has(category)) {
    return false;
  }
  const lineage = asset.sourceLineageId?.trim() ?? "";
  return !SYSTEM_MATERIALIZED_LINEAGE_PREFIXES.some((prefix) => lineage.startsWith(prefix));
}

export function listMyAccumulationSkillAssets(ownerIds: string | string[]): EmployeeSkillSummary[] {
  const aliases = new Set(uniqueOwnerIds(Array.isArray(ownerIds) ? ownerIds : [ownerIds]));
  if (aliases.size === 0) {
    return [];
  }
  return listPersonalSkillAssets()
    .filter((skill) => {
      const owner = normalizeOwnerUserId(skill.ownerUserId);
      return Boolean(owner && aliases.has(owner));
    })
    .filter(isEmployeeMyAccumulationAsset);
}

export function requireOwnedPersonalSkill(params: {
  skillId: string;
  ownerUserId?: string | null;
  ownerIds?: string[] | null;
}): EmployeeSkillDetail {
  const aliases = new Set(uniqueOwnerIds([...(params.ownerIds ?? []), params.ownerUserId]));
  if (aliases.size === 0) {
    throw new SkillAssetStoreError("authenticated user required for personal asset access");
  }
  const detail = getPersonalSkillAssetDetail(params.skillId);
  const assetOwner = normalizeOwnerUserId(detail.ownerUserId);
  if (!assetOwner || !aliases.has(assetOwner)) {
    throw new SkillAssetStoreError("personal asset is not accessible to this user");
  }
  return detail;
}

export function requirePersonalAssetOwner(ownerUserId: string | null | undefined): string {
  const owner = normalizeOwnerUserId(ownerUserId);
  if (!owner) {
    throw new SkillAssetStoreError("authenticated user required to save personal assets");
  }
  return owner;
}
