/**
 * CogniWeave channel-4 RevocationPurgeReceipt contract helper (W1B-3).
 * Default-off: this module only validates / hashes receipts. It does not
 * perform a live purge, unlock Controlled Data Bridge modes, or change
 * data-capability-tool.ts knowledge-object-only Fail-Closed behavior.
 *
 * Channel order and purged invariant follow the pinned Team A contract
 * (memory-resource-bridge.schema.json / check.ts). Pin files are not modified.
 */
import { canonicalSha256Hex } from "./canonical-json.js";

export const REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT = false;
export const COGNIWEAVE_CHANNEL_4 = "agent_history_cogniweave" as const;

export const REVOCATION_PURGE_CHANNELS = [
  "primary_storage_acl",
  "vector_fts_index",
  "cache_materialized_snapshot",
  COGNIWEAVE_CHANNEL_4,
] as const;

export type RevocationPurgeChannel = (typeof REVOCATION_PURGE_CHANNELS)[number];
export type ChannelReceiptStatus = "success" | "failed" | "timeout" | "missing";

export type ChannelReceipt = {
  channel: RevocationPurgeChannel;
  status: ChannelReceiptStatus;
  receipt_hash: string;
  hash_algorithm: "sha256";
  completed_at?: string;
};

export type RevocationPurgeReceipt = {
  task_id: string;
  tenant_id: string;
  subject_id: string;
  policy_generation: number;
  channels: ChannelReceipt[];
  purged: boolean;
  hash_algorithm: "sha256";
  receipt_hash: string;
};

export type RevocationPurgeReceiptCheck =
  | { ok: true; receipt: RevocationPurgeReceipt }
  | {
      ok: false;
      reason:
        | "VALIDATOR_DISABLED"
        | "VALIDATION_ERROR"
        | "CHANNEL_INCOMPLETE"
        | "PURGE_INVARIANT_VIOLATION"
        | "RECEIPT_HASH_MISMATCH";
    };

const SYN_ID = /^syn_[a-z0-9_.:-]{1,120}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const COMPLETED_AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

function allChannelsSuccessful(channels: ChannelReceipt[]): boolean {
  return (
    channels.length === 4 &&
    REVOCATION_PURGE_CHANNELS.every((name, index) => channels[index]?.channel === name) &&
    channels.every((channel) => channel.status === "success")
  );
}

function isChannelReceipt(value: unknown): value is ChannelReceipt {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (!REVOCATION_PURGE_CHANNELS.includes(row.channel as RevocationPurgeChannel)) {
    return false;
  }
  if (!["success", "failed", "timeout", "missing"].includes(row.status as string)) {
    return false;
  }
  if (row.hash_algorithm !== "sha256" || typeof row.receipt_hash !== "string") {
    return false;
  }
  if (!SHA256_HEX.test(row.receipt_hash)) {
    return false;
  }
  if (
    row.completed_at !== undefined &&
    (typeof row.completed_at !== "string" || !COMPLETED_AT.test(row.completed_at))
  ) {
    return false;
  }
  return true;
}

/** Deterministic sha256 over the receipt body excluding receipt_hash itself. */
/**
 * Parent receipt_hash: SHA-256 (lowercase hex) of canonical JSON of the
 * receipt object after dropping only the top-level `receipt_hash` key.
 * In-channel `receipt_hash` fields still count.
 */
export function computeRevocationPurgeReceiptHash(
  receipt: Omit<RevocationPurgeReceipt, "receipt_hash"> | RevocationPurgeReceipt,
): string {
  const { receipt_hash: _ignored, ...rest } = receipt as RevocationPurgeReceipt & {
    receipt_hash?: string;
  };
  return canonicalSha256Hex(rest);
}

/**
 * Channel receipt_hash. Success input is {channel, tenant_id, subject_id, status}.
 * failed / timeout omit subject_id. Keys are recursively sorted by canonical JSON.
 */
export function computeChannelReceiptHash(input: {
  channel: string;
  status: string;
  tenant_id: string;
  subject_id?: string;
}): string {
  const body: Record<string, unknown> = {
    channel: input.channel,
    status: input.status,
    tenant_id: input.tenant_id,
  };
  if (input.status === "success") {
    body.subject_id = input.subject_id;
  }
  return canonicalSha256Hex(body);
}

export function createRevocationPurgeReceiptValidator(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT;
  return {
    enabled,
    check(payload: unknown): RevocationPurgeReceiptCheck {
      if (!enabled) {
        return { ok: false, reason: "VALIDATOR_DISABLED" };
      }
      if (!payload || typeof payload !== "object") {
        return { ok: false, reason: "VALIDATION_ERROR" };
      }
      const row = payload as Record<string, unknown>;
      for (const field of ["task_id", "tenant_id", "subject_id"] as const) {
        if (typeof row[field] !== "string" || !SYN_ID.test(row[field])) {
          return { ok: false, reason: "VALIDATION_ERROR" };
        }
      }
      if (
        !Number.isInteger(row.policy_generation) ||
        (row.policy_generation as number) < 1 ||
        (row.policy_generation as number) > 9007199254740991
      ) {
        return { ok: false, reason: "VALIDATION_ERROR" };
      }
      if (row.hash_algorithm !== "sha256" || typeof row.receipt_hash !== "string") {
        return { ok: false, reason: "VALIDATION_ERROR" };
      }
      if (!SHA256_HEX.test(row.receipt_hash)) {
        return { ok: false, reason: "VALIDATION_ERROR" };
      }
      if (typeof row.purged !== "boolean") {
        return { ok: false, reason: "VALIDATION_ERROR" };
      }
      if (
        !Array.isArray(row.channels) ||
        row.channels.length !== 4 ||
        !row.channels.every(isChannelReceipt)
      ) {
        return { ok: false, reason: "CHANNEL_INCOMPLETE" };
      }
      const channels = row.channels;
      const names = channels.map((channel) => channel.channel);
      const expected = [...REVOCATION_PURGE_CHANNELS];
      if ([...names].toSorted().join() !== [...expected].toSorted().join()) {
        return { ok: false, reason: "CHANNEL_INCOMPLETE" };
      }
      const complete = allChannelsSuccessful(channels);
      if (row.purged && !complete) {
        return { ok: false, reason: "PURGE_INVARIANT_VIOLATION" };
      }
      if (!row.purged && complete) {
        return { ok: false, reason: "PURGE_INVARIANT_VIOLATION" };
      }
      const receipt: RevocationPurgeReceipt = {
        task_id: row.task_id as string,
        tenant_id: row.tenant_id as string,
        subject_id: row.subject_id as string,
        policy_generation: row.policy_generation as number,
        channels,
        purged: row.purged,
        hash_algorithm: "sha256",
        receipt_hash: row.receipt_hash,
      };
      const expectedHash = computeRevocationPurgeReceiptHash({
        task_id: receipt.task_id,
        tenant_id: receipt.tenant_id,
        subject_id: receipt.subject_id,
        policy_generation: receipt.policy_generation,
        channels: receipt.channels,
        purged: receipt.purged,
        hash_algorithm: receipt.hash_algorithm,
      });
      if (receipt.receipt_hash !== expectedHash) {
        return { ok: false, reason: "RECEIPT_HASH_MISMATCH" };
      }
      return { ok: true, receipt };
    },
  };
}
