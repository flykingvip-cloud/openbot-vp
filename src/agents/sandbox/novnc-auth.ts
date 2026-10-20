import crypto from "node:crypto";

export const NOVNC_PASSWORD_ENV_KEY = "OPENCLAW_BROWSER_NOVNC_PASSWORD"; // pragma: allowlist secret
const NOVNC_TOKEN_TTL_MS = 60 * 1000;
const NOVNC_PASSWORD_LENGTH = 8;
const NOVNC_PASSWORD_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

type NoVncObserverTokenEntry = {
  noVncPort: number;
  password?: string;
  expiresAt: number;
  /** When set, the bootstrap must open noVNC with view_only so this client cannot send input. */
  viewOnly?: boolean;
  /** Account-computer relay. The VNC password stays on the server; the page never receives it. */
  relay?: boolean;
  /** Account this token was minted for. The port is that account's single noVNC slot. */
  tenantId?: string;
  userId?: string;
};

export type NoVncObserverTokenPayload = {
  noVncPort: number;
  password?: string;
  viewOnly?: boolean;
  relay?: boolean;
};

/** How long a relay grant may wait for its single websocket. */
const NOVNC_RELAY_GRANT_TTL_MS = 3 * 60 * 1000;

export type NoVncRelayGrant = {
  token: string;
  noVncPort: number;
  password?: string;
  /**
   * Live flag on the object the open socket holds. Handoff sets this false
   * immediately. The map entry is removed at the same time, so a reconnect
   * cannot claim the grant again.
   */
  input: boolean;
  expiresAt: number;
  /** True after the one allowed websocket upgrade is accepted. */
  connected: boolean;
};

type NoVncStaticLease = {
  noVncPort: number;
  expiresAt: number;
};

export type NoVncObserverTokenDescription = {
  noVncPort: number;
  expiresAt: number;
  viewOnly: boolean;
  tenantId?: string;
  userId?: string;
};

const NO_VNC_OBSERVER_TOKENS = new Map<string, NoVncObserverTokenEntry>();
const NO_VNC_RELAY_GRANTS = new Map<string, NoVncRelayGrant>();
const NO_VNC_STATIC = new Map<string, NoVncStaticLease>();

function pruneExpiredNoVncObserverTokens(now: number) {
  for (const [token, entry] of NO_VNC_OBSERVER_TOKENS) {
    if (entry.expiresAt <= now) {
      NO_VNC_OBSERVER_TOKENS.delete(token);
    }
  }
}

/** Drop expired relay grants and static leases so a long-lived process does not keep them. */
function pruneExpiredNoVncRelayState(now: number) {
  for (const [token, grant] of NO_VNC_RELAY_GRANTS) {
    if (grant.expiresAt <= now) {
      grant.input = false;
      NO_VNC_RELAY_GRANTS.delete(token);
    }
  }
  for (const [token, lease] of NO_VNC_STATIC) {
    if (lease.expiresAt <= now) {
      NO_VNC_STATIC.delete(token);
    }
  }
}

export function isNoVncEnabled(params: { enableNoVnc: boolean; headless: boolean }) {
  return params.enableNoVnc && !params.headless;
}

export function generateNoVncPassword() {
  // VNC auth uses an 8-char password max.
  let out = "";
  for (let i = 0; i < NOVNC_PASSWORD_LENGTH; i += 1) {
    out += NOVNC_PASSWORD_ALPHABET[crypto.randomInt(0, NOVNC_PASSWORD_ALPHABET.length)];
  }
  return out;
}

export function buildNoVncDirectUrl(port: number) {
  return `http://127.0.0.1:${port}/vnc.html`;
}

export function issueNoVncObserverToken(params: {
  noVncPort: number;
  password?: string;
  ttlMs?: number;
  nowMs?: number;
  viewOnly?: boolean;
  relay?: boolean;
  tenantId?: string;
  userId?: string;
}): string {
  const now = params.nowMs ?? Date.now();
  pruneExpiredNoVncObserverTokens(now);
  pruneExpiredNoVncRelayState(now);
  const token = crypto.randomBytes(24).toString("hex");
  const tenantId = params.tenantId?.trim() || undefined;
  const userId = params.userId?.trim() || undefined;
  NO_VNC_OBSERVER_TOKENS.set(token, {
    noVncPort: params.noVncPort,
    password: params.password?.trim() || undefined,
    expiresAt: now + Math.max(1, params.ttlMs ?? NOVNC_TOKEN_TTL_MS),
    ...(params.viewOnly ? { viewOnly: true } : {}),
    ...(params.relay ? { relay: true } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
  });
  return token;
}

/** Drop an unconsumed token so a handed-off control URL cannot still grant input. */
export function revokeNoVncObserverToken(token: string) {
  const normalized = token.trim();
  if (!normalized) {
    return;
  }
  NO_VNC_OBSERVER_TOKENS.delete(normalized);
}

export function describeNoVncObserverToken(
  token: string,
  nowMs?: number,
): NoVncObserverTokenDescription | null {
  const now = nowMs ?? Date.now();
  pruneExpiredNoVncObserverTokens(now);
  const entry = NO_VNC_OBSERVER_TOKENS.get(token.trim());
  if (!entry || entry.expiresAt <= now) {
    return null;
  }
  return {
    noVncPort: entry.noVncPort,
    expiresAt: entry.expiresAt,
    viewOnly: entry.viewOnly === true,
    ...(entry.tenantId ? { tenantId: entry.tenantId } : {}),
    ...(entry.userId ? { userId: entry.userId } : {}),
  };
}

export function consumeNoVncObserverToken(
  token: string,
  nowMs?: number,
): NoVncObserverTokenPayload | null {
  const now = nowMs ?? Date.now();
  pruneExpiredNoVncObserverTokens(now);
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }
  const entry = NO_VNC_OBSERVER_TOKENS.get(normalized);
  if (!entry) {
    return null;
  }
  NO_VNC_OBSERVER_TOKENS.delete(normalized);
  if (entry.expiresAt <= now) {
    return null;
  }
  return {
    noVncPort: entry.noVncPort,
    password: entry.password,
    ...(entry.viewOnly ? { viewOnly: true } : {}),
    ...(entry.relay ? { relay: true } : {}),
  };
}

function retireInputGrants() {
  for (const [token, grant] of NO_VNC_RELAY_GRANTS) {
    if (!grant.input) {
      continue;
    }
    grant.input = false;
    NO_VNC_RELAY_GRANTS.delete(token);
  }
}

export function openNoVncRelayGrant(params: {
  token: string;
  noVncPort: number;
  password?: string;
  input: boolean;
  ttlMs?: number;
  nowMs?: number;
}): NoVncRelayGrant {
  const now = params.nowMs ?? Date.now();
  pruneExpiredNoVncRelayState(now);
  if (params.input) {
    retireInputGrants();
  }
  const grant: NoVncRelayGrant = {
    token: params.token,
    noVncPort: params.noVncPort,
    password: params.password?.trim() || undefined,
    input: params.input,
    expiresAt: now + Math.max(1, params.ttlMs ?? NOVNC_RELAY_GRANT_TTL_MS),
    connected: false,
  };
  NO_VNC_RELAY_GRANTS.set(params.token, grant);
  NO_VNC_STATIC.set(params.token, { noVncPort: params.noVncPort, expiresAt: grant.expiresAt });
  return grant;
}

/** Accept the single websocket for this grant. A second call returns null. */
export function claimNoVncRelayGrant(token: string, nowMs?: number): NoVncRelayGrant | null {
  const now = nowMs ?? Date.now();
  pruneExpiredNoVncRelayState(now);
  const normalized = token.trim();
  const grant = NO_VNC_RELAY_GRANTS.get(normalized);
  if (!grant) {
    return null;
  }
  if (grant.connected || grant.expiresAt <= now) {
    if (grant.expiresAt <= now) {
      grant.input = false;
      NO_VNC_RELAY_GRANTS.delete(normalized);
    }
    return null;
  }
  grant.connected = true;
  return grant;
}

/** Drop the map entry when its one websocket closes. The socket object is already finished. */
export function releaseNoVncRelayGrant(grant: NoVncRelayGrant) {
  if (NO_VNC_RELAY_GRANTS.get(grant.token) === grant) {
    NO_VNC_RELAY_GRANTS.delete(grant.token);
  }
}

export function readNoVncStaticPort(token: string, nowMs?: number): number | null {
  const now = nowMs ?? Date.now();
  pruneExpiredNoVncRelayState(now);
  const normalized = token.trim();
  const lease = NO_VNC_STATIC.get(normalized);
  if (!lease || lease.expiresAt <= now) {
    if (lease) {
      NO_VNC_STATIC.delete(normalized);
    }
    return null;
  }
  return lease.noVncPort;
}

/**
 * Previous controller keeps the socket object, but further key and pointer
 * messages are dropped, and the same grant id cannot connect again.
 */
export function disarmNoVncRelayGrant(token: string) {
  const normalized = token.trim();
  const grant = NO_VNC_RELAY_GRANTS.get(normalized);
  if (grant) {
    grant.input = false;
    NO_VNC_RELAY_GRANTS.delete(normalized);
  }
  NO_VNC_STATIC.delete(normalized);
}

export function buildNoVncObserverTokenUrl(baseUrl: string, token: string) {
  const query = new URLSearchParams({ token });
  const path = `/sandbox/novnc?${query.toString()}`;
  const base = baseUrl.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function resetNoVncObserverTokensForTests() {
  NO_VNC_OBSERVER_TOKENS.clear();
  NO_VNC_RELAY_GRANTS.clear();
  NO_VNC_STATIC.clear();
}

/** Test-only sizes so expiry pruning can be asserted without reading the maps. */
export function novncRelayStateSizeForTests(): { grants: number; staticLeases: number } {
  return { grants: NO_VNC_RELAY_GRANTS.size, staticLeases: NO_VNC_STATIC.size };
}
