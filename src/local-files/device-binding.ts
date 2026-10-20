/**
 * Local device binding store (design 4.3).
 *
 * Today's pairing proves only "this node connected to this gateway". It does not
 * prove tenant, user, digital human or session, and it does not pick one device
 * when several are present. This store supplies that missing authority.
 *
 * The routing key is `nodeId` plus the device public key identity. Display names
 * are presentation only and never authorize anything.
 */

import type { LocalDeviceBindingPersistence } from "./device-binding-persistence.js";
import {
  LOCAL_FILES_READONLY_PROFILE,
  type CapabilityBinding,
  type LocalDeviceBinding,
} from "./types.js";

export type BindingLookupFailure =
  | "not-bound"
  | "revoked"
  | "tenant-mismatch"
  | "user-mismatch"
  | "agent-not-allowed"
  | "device-key-mismatch"
  | "profile-mismatch";

export type BindingLookup =
  | { ok: true; binding: LocalDeviceBinding }
  | { ok: false; reason: BindingLookupFailure };

export class LocalDeviceBindingStore {
  private readonly byNodeId = new Map<string, LocalDeviceBinding>();
  private readonly persistence?: LocalDeviceBindingPersistence;

  /**
   * In-memory is the authority for the synchronous authorization path (redemption
   * must not await), and disk is durability. Mutations go through the async
   * `*Persisted` variants so a failed write surfaces to the caller rather than being
   * swallowed behind a sync setter.
   */
  constructor(persistence?: LocalDeviceBindingPersistence) {
    this.persistence = persistence;
  }

  /** Load persisted bindings into memory. Call once at startup. */
  async hydrate(): Promise<number> {
    if (!this.persistence) {
      return 0;
    }
    const loaded = await this.persistence.load();
    for (const binding of loaded) {
      this.put(binding);
    }
    return loaded.length;
  }

  put(binding: LocalDeviceBinding): void {
    this.byNodeId.set(binding.nodeId, {
      ...binding,
      allowedAgentIds: [...binding.allowedAgentIds],
    });
  }

  /** Store and persist. Rejects when the write fails, so callers can report it. */
  async putPersisted(binding: LocalDeviceBinding): Promise<void> {
    this.put(binding);
    await this.persistence?.save(this.list());
  }

  /** Revoke and persist. */
  async revokePersisted(nodeId: string, nowMs: number): Promise<boolean> {
    const revoked = this.revoke(nodeId, nowMs);
    if (revoked) {
      await this.persistence?.save(this.list());
    }
    return revoked;
  }

  /** Every binding, active and revoked. Revoked rows are kept as an audit trail. */
  list(): LocalDeviceBinding[] {
    return [...this.byNodeId.values()].map((binding) => ({
      ...binding,
      allowedAgentIds: [...binding.allowedAgentIds],
    }));
  }

  get(nodeId: string): LocalDeviceBinding | undefined {
    return this.byNodeId.get(nodeId);
  }

  revoke(nodeId: string, nowMs: number): boolean {
    const binding = this.byNodeId.get(nodeId);
    if (!binding || binding.status === "revoked") {
      return false;
    }
    binding.status = "revoked";
    binding.revokedAtMs = nowMs;
    return true;
  }

  /**
   * Authorize a (tenant, user, agent, device) tuple against the stored binding.
   * Every mismatch is a refusal; there is no partial match.
   */
  authorize(params: {
    nodeId: string;
    tenantId: string;
    userId: string;
    agentId: string;
    devicePublicKey: string;
  }): BindingLookup {
    const binding = this.byNodeId.get(params.nodeId);
    if (!binding) {
      return { ok: false, reason: "not-bound" };
    }
    if (binding.status !== "active") {
      return { ok: false, reason: "revoked" };
    }
    if (binding.capabilityProfile !== LOCAL_FILES_READONLY_PROFILE) {
      return { ok: false, reason: "profile-mismatch" };
    }
    if (binding.tenantId !== params.tenantId) {
      return { ok: false, reason: "tenant-mismatch" };
    }
    if (binding.userId !== params.userId) {
      return { ok: false, reason: "user-mismatch" };
    }
    if (binding.devicePublicKey !== params.devicePublicKey) {
      return { ok: false, reason: "device-key-mismatch" };
    }
    if (!binding.allowedAgentIds.includes(params.agentId)) {
      return { ok: false, reason: "agent-not-allowed" };
    }
    return { ok: true, binding };
  }

  /** Authorize the binding carried by a capability's claims. */
  authorizeBinding(binding: CapabilityBinding): BindingLookup {
    return this.authorize({
      nodeId: binding.nodeId,
      tenantId: binding.tenantId,
      userId: binding.userId,
      agentId: binding.agentId,
      devicePublicKey: binding.devicePublicKey,
    });
  }

  /**
   * Active bindings for one user. When more than one device matches, the caller
   * must ask the user to pick; requests are never broadcast (design 4.3).
   */
  listActiveForUser(params: { tenantId: string; userId: string }): LocalDeviceBinding[] {
    return [...this.byNodeId.values()].filter(
      (binding) =>
        binding.status === "active" &&
        binding.tenantId === params.tenantId &&
        binding.userId === params.userId,
    );
  }

  size(): number {
    return this.byNodeId.size;
  }
}
