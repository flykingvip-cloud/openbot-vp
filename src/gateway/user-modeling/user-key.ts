import crypto from "node:crypto";
import type { MsgContext } from "../../auto-reply/templating.js";
import type { TemplateContext } from "../../auto-reply/templating.js";
import type { OpenBotConfig } from "../../config/config.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveUserModelingTenantId } from "./tenant-membership.js";

export type UserModelingKey = {
  /** Canonical stable user id (identityLinks merge or channel:peerId). */
  canonicalId: string;
  tenantId: string | null;
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function resolveLinkedCanonicalId(params: {
  identityLinks?: Record<string, string[]>;
  channel: string;
  peerId: string;
}): string | null {
  const identityLinks = params.identityLinks;
  if (!identityLinks) {
    return null;
  }
  const peerId = params.peerId.trim();
  if (!peerId) {
    return null;
  }
  const candidates = new Set<string>();
  const rawCandidate = normalizeToken(peerId);
  if (rawCandidate) {
    candidates.add(rawCandidate);
  }
  const channel = normalizeToken(params.channel);
  if (channel) {
    const scopedCandidate = normalizeToken(`${channel}:${peerId}`);
    if (scopedCandidate) {
      candidates.add(scopedCandidate);
    }
  }
  if (candidates.size === 0) {
    return null;
  }
  for (const [canonical, ids] of Object.entries(identityLinks)) {
    const canonicalName = canonical.trim();
    if (!canonicalName || !Array.isArray(ids)) {
      continue;
    }
    for (const id of ids) {
      const normalized = normalizeToken(id);
      if (normalized && candidates.has(normalized)) {
        return canonicalName;
      }
    }
  }
  return null;
}

export function resolveUserModelingKey(input: {
  channel?: string | null;
  peerId?: string | null;
  tenantId?: string | null;
  identityLinks?: Record<string, string[]>;
}): UserModelingKey | null {
  const peerId = (input.peerId ?? "").trim();
  if (!peerId || peerId.toLowerCase() === "unknown") {
    return null;
  }
  const channel = (input.channel ?? "").trim().toLowerCase() || "unknown";
  const linked = resolveLinkedCanonicalId({
    identityLinks: input.identityLinks,
    channel,
    peerId,
  });
  const canonicalId = linked ?? `${channel}:${peerId}`;
  const tenantRaw = (input.tenantId ?? "").trim();
  return {
    canonicalId,
    tenantId: tenantRaw.length > 0 ? tenantRaw : null,
  };
}

export function hashUserKey(key: UserModelingKey): string {
  const material = `${key.tenantId ?? "_local"}:${key.canonicalId}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export function extractPeerIdFromSessionKey(sessionKey: string): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return null;
  }
  const match = parsed.rest.match(/(?:^|:)direct:([^:]+)$/);
  return match?.[1]?.trim() || null;
}

export function resolveUserModelingKeyFromContext(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  sessionCtx: Pick<
    TemplateContext,
    "SenderId" | "OriginatingChannel" | "Provider" | "GatewayClientUser"
  >;
  ctx: Pick<MsgContext, "OriginatingChannel" | "Provider" | "GatewayClientUser">;
  tenantId?: string | null;
}): UserModelingKey | null {
  const channel = (
    params.ctx.OriginatingChannel ??
    params.sessionCtx.OriginatingChannel ??
    params.ctx.Provider ??
    params.sessionCtx.Provider ??
    "unknown"
  )
    .trim()
    .toLowerCase();

  let peerId =
    params.sessionCtx.SenderId?.trim() || extractPeerIdFromSessionKey(params.sessionKey) || "";

  if (!peerId || peerId.toLowerCase() === "unknown") {
    const webUser =
      params.ctx.GatewayClientUser?.trim() || params.sessionCtx.GatewayClientUser?.trim();
    if (webUser) {
      return resolveUserModelingKey({
        channel: channel === "unknown" ? "webchat" : channel,
        peerId: webUser.toLowerCase(),
        tenantId: params.tenantId ?? null,
        identityLinks: params.cfg.session?.identityLinks,
      });
    }
    return null;
  }

  return resolveUserModelingKey({
    channel,
    peerId,
    tenantId: params.tenantId ?? null,
    identityLinks: params.cfg.session?.identityLinks,
  });
}

/** Async reply-path resolver: enriches webchat keys with authoritative tenant membership. */
export async function resolveUserModelingKeyForReply(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  sessionCtx: Pick<
    TemplateContext,
    "SenderId" | "OriginatingChannel" | "Provider" | "GatewayClientUser"
  >;
  ctx: Pick<MsgContext, "OriginatingChannel" | "Provider" | "GatewayClientUser">;
}): Promise<UserModelingKey | null> {
  const base = resolveUserModelingKeyFromContext({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    sessionCtx: params.sessionCtx,
    ctx: params.ctx,
    tenantId: null,
  });
  if (!base || base.tenantId) {
    return base;
  }
  const webUser =
    params.ctx.GatewayClientUser?.trim().toLowerCase() ||
    params.sessionCtx.GatewayClientUser?.trim().toLowerCase();
  if (!webUser) {
    return base;
  }
  const tenantId = await resolveUserModelingTenantId({ user: webUser } as GatewayClient);
  if (!tenantId) {
    return base;
  }
  return { ...base, tenantId };
}

export async function resolveUserModelingKeyForClient(
  client: GatewayClient | null,
  cfg: OpenBotConfig,
): Promise<UserModelingKey | null> {
  const email = client?.user?.trim().toLowerCase();
  if (!email) {
    return null;
  }
  const tenantId = await resolveUserModelingTenantId(client);
  return resolveUserModelingKey({
    channel: "webchat",
    peerId: email,
    tenantId,
    identityLinks: cfg.session?.identityLinks,
  });
}
