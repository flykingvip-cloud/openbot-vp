import { createHash, randomUUID } from "node:crypto";
import {
  assertPromotionEnvelopeHygiene,
  type CloudPromotionEnvelope,
} from "./promotion-envelope.js";

/**
 * CW2-P5-02 CloudIntelligenceClient — auth binding, anti-replay, idempotency.
 * Fake/InMemory client for Gate P5; real HTTP deferred.
 */

export type CloudAuthContext = {
  /** Authoritative tenant — never taken from envelope for authz. */
  tenantId: string;
  deviceId: string;
  credential: string;
};

export type CloudPushInput = {
  idempotencyKey: string;
  envelope: CloudPromotionEnvelope;
  /** Optional client-claimed tenant — ignored for authz (must match auth or be absent). */
  claimedTenantId?: string;
  nonce: string;
  timestampMs: number;
};

export type CloudDeleteTombstoneInput = {
  idempotencyKey: string;
  atomId: string;
  atomVersion: number;
  claimedTenantId?: string;
  nonce: string;
  timestampMs: number;
};

export type CloudPullInput = {
  /** Opaque device cursor from prior pull (absent = full snapshot). */
  cursor?: string;
  claimedTenantId?: string;
  nonce: string;
  timestampMs: number;
  limit?: number;
};

export type CloudPullItem =
  | {
      kind: "live";
      envelope: CloudPromotionEnvelope;
      etag: string;
      cloudObjectId: string;
    }
  | {
      kind: "tombstone";
      atomId: string;
      atomVersion: number;
      etag: string;
      cloudObjectId: string;
    };

export type CloudPullResult =
  | {
      ok: true;
      items: CloudPullItem[];
      nextCursor: string;
      /** True when server returned a full tenant snapshot (ignore prior local cursor). */
      fullSnapshot: boolean;
    }
  | { ok: false; code: CloudRejectCode; message: string };

export type CloudOpResult =
  | { ok: true; cloudObjectId: string }
  | { ok: false; code: CloudRejectCode; message: string };

export type CloudRejectCode =
  | "UNAUTHENTICATED"
  | "TENANT_MISMATCH"
  | "ANTI_REPLAY"
  | "ENVELOPE_HYGIENE"
  | "RATE_LIMITED";

export interface CloudIntelligenceClient {
  push(input: CloudPushInput, auth: CloudAuthContext): Promise<CloudOpResult>;
  deleteTombstone(input: CloudDeleteTombstoneInput, auth: CloudAuthContext): Promise<CloudOpResult>;
  pull(input: CloudPullInput, auth: CloudAuthContext): Promise<CloudPullResult>;
}

export type InMemoryCloudClientOptions = {
  validCredentials?: ReadonlySet<string> | ReadonlyArray<string>;
  replayWindowMs?: number;
  nowMs?: () => number;
  /** Per-device rate limit for tests (0 = disabled). */
  maxOpsPerDevice?: number;
};

export function createCloudIdempotencyKey(input: {
  atomId: string;
  operation: "push" | "delete_tombstone";
  atomVersion: number;
}): string {
  return createHash("sha256")
    .update(`${input.atomId}\0${input.operation}\0${input.atomVersion}`)
    .digest("hex")
    .slice(0, 32);
}

export function createCloudNonce(): string {
  return randomUUID();
}

export class InMemoryCloudIntelligenceClient implements CloudIntelligenceClient {
  private readonly credentials: Set<string>;
  private readonly replayWindowMs: number;
  private readonly nowMs: () => number;
  private readonly maxOpsPerDevice: number;
  private readonly usedNonces = new Set<string>();
  private readonly idempotency = new Map<string, CloudOpResult>();
  private readonly pushed = new Map<
    string,
    { tenantId: string; envelope: CloudPromotionEnvelope }
  >();
  private readonly deleted = new Map<string, { tenantId: string; atomVersion: number }>();
  private readonly deviceOps = new Map<string, number>();

  constructor(options?: InMemoryCloudClientOptions) {
    const creds = options?.validCredentials;
    this.credentials = new Set(creds instanceof Set ? creds : (creds ?? ["test-credential"]));
    this.replayWindowMs = options?.replayWindowMs ?? 5 * 60 * 1000;
    this.nowMs = options?.nowMs ?? (() => Date.now());
    this.maxOpsPerDevice = options?.maxOpsPerDevice ?? 0;
  }

  getPushed(atomId: string) {
    return this.pushed.get(atomId);
  }

  getDeleted(atomId: string) {
    return this.deleted.get(atomId);
  }

  /** Test helper — list live envelopes for a tenant. */
  listPushedForTenant(tenantId: string): CloudPromotionEnvelope[] {
    return [...this.pushed.values()]
      .filter((row) => row.tenantId === tenantId)
      .map((row) => row.envelope);
  }

  async push(input: CloudPushInput, auth: CloudAuthContext): Promise<CloudOpResult> {
    const gate = this.authorize(input, auth);
    if (!gate.ok) {
      return gate;
    }
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) {
      return cached;
    }
    const hygiene = assertPromotionEnvelopeHygiene(input.envelope);
    if (hygiene.length > 0) {
      return {
        ok: false,
        code: "ENVELOPE_HYGIENE",
        message: `denylist violations: ${hygiene.join(",")}`,
      };
    }
    // Cross-tenant: envelope must not claim a different tenant via claimedTenantId.
    // Scope fields are not SaaS tenant; auth.tenantId is sole authority.
    const result: CloudOpResult = {
      ok: true,
      cloudObjectId: `cloud_${input.envelope.atomId}_v${input.envelope.versioning.version}`,
    };
    this.idempotency.set(input.idempotencyKey, result);
    this.pushed.set(input.envelope.atomId, {
      tenantId: auth.tenantId,
      envelope: input.envelope,
    });
    this.deleted.delete(input.envelope.atomId);
    return result;
  }

  async deleteTombstone(
    input: CloudDeleteTombstoneInput,
    auth: CloudAuthContext,
  ): Promise<CloudOpResult> {
    const gate = this.authorize(input, auth);
    if (!gate.ok) {
      return gate;
    }
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) {
      return cached;
    }
    const existing = this.pushed.get(input.atomId);
    if (existing && existing.tenantId !== auth.tenantId) {
      return {
        ok: false,
        code: "TENANT_MISMATCH",
        message: "cross-tenant delete denied",
      };
    }
    const result: CloudOpResult = {
      ok: true,
      cloudObjectId: `tombstone_${input.atomId}_v${input.atomVersion}`,
    };
    this.idempotency.set(input.idempotencyKey, result);
    this.deleted.set(input.atomId, {
      tenantId: auth.tenantId,
      atomVersion: input.atomVersion,
    });
    this.pushed.delete(input.atomId);
    return result;
  }

  async pull(input: CloudPullInput, auth: CloudAuthContext): Promise<CloudPullResult> {
    const gate = this.authorize(input, auth);
    if (!gate.ok) {
      return gate;
    }
    const limit = Math.max(1, input.limit ?? 100);
    const live: CloudPullItem[] = [...this.pushed.entries()]
      .filter(([, row]) => row.tenantId === auth.tenantId)
      .map(([atomId, row]) => ({
        kind: "live" as const,
        envelope: row.envelope,
        etag: createHash("sha256")
          .update(`live\0${atomId}\0${row.envelope.versioning.version}`)
          .digest("hex")
          .slice(0, 24),
        cloudObjectId: `cloud_${atomId}_v${row.envelope.versioning.version}`,
      }));
    const tombs: CloudPullItem[] = [...this.deleted.entries()]
      .filter(([, row]) => row.tenantId === auth.tenantId)
      .map(([atomId, row]) => ({
        kind: "tombstone" as const,
        atomId,
        atomVersion: row.atomVersion,
        etag: createHash("sha256")
          .update(`tombstone\0${atomId}\0${row.atomVersion}`)
          .digest("hex")
          .slice(0, 24),
        cloudObjectId: `tombstone_${atomId}_v${row.atomVersion}`,
      }));
    // InMemory stub: always full snapshot for the tenant (cursor ignored for filtering).
    const items = [...live, ...tombs].slice(0, limit);
    const nextCursor = createHash("sha256")
      .update(`${auth.tenantId}\0${auth.deviceId}\0${input.timestampMs}\0${items.length}`)
      .digest("hex")
      .slice(0, 16);
    return {
      ok: true,
      items,
      nextCursor,
      fullSnapshot: true,
    };
  }

  private authorize(
    input: { claimedTenantId?: string; nonce: string; timestampMs: number },
    auth: CloudAuthContext,
  ): CloudOpResult {
    if (!auth.credential || !this.credentials.has(auth.credential)) {
      return { ok: false, code: "UNAUTHENTICATED", message: "invalid credential" };
    }
    if (!auth.tenantId.trim() || !auth.deviceId.trim()) {
      return { ok: false, code: "UNAUTHENTICATED", message: "missing tenant/device" };
    }
    if (input.claimedTenantId && input.claimedTenantId !== auth.tenantId) {
      return {
        ok: false,
        code: "TENANT_MISMATCH",
        message: "client-supplied tenant ignored and mismatched auth",
      };
    }
    const now = this.nowMs();
    if (Math.abs(now - input.timestampMs) > this.replayWindowMs) {
      return { ok: false, code: "ANTI_REPLAY", message: "timestamp outside window" };
    }
    const nonceKey = `${auth.deviceId}\0${input.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      return { ok: false, code: "ANTI_REPLAY", message: "nonce reused" };
    }
    if (this.maxOpsPerDevice > 0) {
      const count = this.deviceOps.get(auth.deviceId) ?? 0;
      if (count >= this.maxOpsPerDevice) {
        return { ok: false, code: "RATE_LIMITED", message: "device rate limit" };
      }
      this.deviceOps.set(auth.deviceId, count + 1);
    }
    this.usedNonces.add(nonceKey);
    return { ok: true, cloudObjectId: "" };
  }
}
