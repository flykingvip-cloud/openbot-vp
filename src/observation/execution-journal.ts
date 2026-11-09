/** Optional durable metadata projection. Never an execution or business authority. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../infra/file-lock.js";
import { createAsyncLock, writeJsonAtomic } from "../infra/json-files.js";
import type { TrustedScope } from "../task-outcome/types.js";
import type { ExecutionFact, VersionLinkReceipt } from "./execution-evidence-store.js";
const str = z.string().min(1).max(1024);
const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("personal"),
    personalDomainId: str,
    subjectRef: str,
    authzScopeRef: str,
  }),
  z.strictObject({
    kind: z.literal("enterprise"),
    tenantId: str,
    enterpriseDomainId: str,
    subjectRef: str,
    authzScopeRef: str,
  }),
]);
const source = z.strictObject({
  provenance: z.enum(["live", "seed", "injected", "unknown"]),
  collector: z.enum(["runtime_execution", "test", "unknown"]),
});
const factSchema = z.strictObject({
  eventId: str,
  taskId: str,
  runId: str,
  scope: scopeSchema,
  occurredAt: z.number().finite(),
  stage: z.enum(["started", "completed", "failed", "cancelled"]),
  source: source.optional(),
});
const receiptSchema = z.strictObject({
  receiptId: str,
  taskId: str,
  runId: str,
  scope: scopeSchema,
  outcomeVersion: z.number().int().positive(),
  attemptId: str,
  attemptGranularity: z.literal("turn"),
  eventIds: z.array(str).min(1).max(1000),
});
const entrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fact"),
    sequence: z.number().int().positive(),
    receivedAt: z.number().finite(),
    value: factSchema,
  }),
  z.strictObject({
    kind: z.literal("link"),
    sequence: z.number().int().positive(),
    receivedAt: z.number().finite(),
    value: receiptSchema,
  }),
]);
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  partition: str,
  epoch: str,
  nextSequence: z.number().int().positive(),
  discardedThrough: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
  identities: z.record(z.string(), z.string()),
});
type Journal = z.infer<typeof schema>;
const gates = new Map<string, { gate: ReturnType<typeof createAsyncLock>; users: number }>();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function createExecutionJournal(options: {
  rootDir: string;
  enabled?: () => boolean;
  now?: () => number;
  capacity?: number;
  ttlMs?: number;
  maxBytes?: number;
  maxPartitions?: number;
  maxRootBytes?: number;
}) {
  if (!path.isAbsolute(options.rootDir)) {
    throw new Error("explicit_absolute_directory_required");
  }
  const capacity = options.capacity ?? 1000,
    ttlMs = options.ttlMs ?? 900000,
    maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    !Number.isFinite(ttlMs) ||
    ttlMs <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024
  ) {
    throw new Error("invalid_retention");
  }
  const maxPartitions = options.maxPartitions ?? 1000;
  const maxRootBytes = options.maxRootBytes ?? 256 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxPartitions) ||
    maxPartitions < 1 ||
    !Number.isSafeInteger(maxRootBytes) ||
    maxRootBytes < 1024
  ) {
    throw new Error("invalid_root_budget");
  }
  const now = options.now ?? Date.now;
  const enabled = () => options.enabled?.() === true;
  const location = (agentId: string, scope: TrustedScope) => {
    str.parse(agentId);
    scopeSchema.parse(scope);
    const partition = hash([agentId, scope]);
    return { partition, file: path.join(options.rootDir, partition + ".json") };
  };
  const read = async (
    file: string,
    partition: string,
    scope: TrustedScope,
  ): Promise<Journal | null> => {
    let raw: string;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > maxBytes) {
        throw new Error("journal_capacity");
      }
      const handle = await fs.open(file, "r");
      try {
        const chunks: Buffer[] = [];
        let total = 0;
        while (total <= maxBytes) {
          const chunk = Buffer.alloc(Math.min(65536, maxBytes + 1 - total));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (bytesRead === 0) {
            break;
          }
          total += bytesRead;
          if (total > maxBytes) {
            throw new Error("journal_capacity");
          }
          chunks.push(chunk.subarray(0, bytesRead));
        }
        raw = Buffer.concat(chunks, total).toString("utf8");
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw e;
    }
    if (Buffer.byteLength(raw) > maxBytes) {
      throw new Error("journal_capacity");
    }
    const j = schema.parse(JSON.parse(raw));
    if (
      j.partition !== partition ||
      j.entries.some((e) => hash(e.value.scope) !== hash(scope)) ||
      j.entries.some(
        (e, i) =>
          e.sequence >= j.nextSequence || (i > 0 && e.sequence <= j.entries[i - 1].sequence),
      )
    ) {
      throw new Error("corrupt_journal");
    }
    return j;
  };
  const retain = (j: Journal, at: number) => {
    const entries = j.entries.filter((e) => at - e.receivedAt < ttlMs).slice(-capacity);
    const keep = new Set(entries.map((e) => e.sequence));
    const removed = j.entries.filter((e) => !keep.has(e.sequence));
    return {
      ...j,
      entries,
      discardedThrough: Math.max(j.discardedThrough, ...removed.map((e) => e.sequence)),
    };
  };
  const append = async (
    agentId: string,
    kind: "fact" | "link",
    raw: ExecutionFact | VersionLinkReceipt,
  ) => {
    try {
      if (!enabled()) {
        return { ok: false as const, reason: "journal_disabled" };
      }
      const value = kind === "fact" ? factSchema.parse(raw) : receiptSchema.parse(raw);
      if (kind === "link") {
        (value as VersionLinkReceipt).eventIds = [
          ...(value as VersionLinkReceipt).eventIds,
        ].toSorted();
      }
      const at = now();
      if (!Number.isFinite(at) || (kind === "fact" && (value as ExecutionFact).occurredAt > at)) {
        throw new Error("invalid_clock");
      }
      const located = location(agentId, value.scope);
      await fs.mkdir(options.rootDir, { recursive: true, mode: 0o700 });
      await fs.chmod(options.rootDir, 0o700);
      const root = await fs.realpath(options.rootDir);
      const file = path.join(root, path.basename(located.file));
      const rootLock = path.join(root, ".root-budget");
      let rootGate = gates.get(rootLock);
      if (!rootGate) {
        rootGate = { gate: createAsyncLock(), users: 0 };
        gates.set(rootLock, rootGate);
      }
      rootGate.users++;
      try {
        return await rootGate.gate(() =>
          withFileLock(rootLock, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
            let entry = gates.get(file);
            if (!entry) {
              entry = { gate: createAsyncLock(), users: 0 };
              gates.set(file, entry);
            }
            entry.users++;
            try {
              return await entry.gate(() =>
                withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
                  const existing = await read(file, located.partition, value.scope);
                  const journal = retain(
                    existing ?? {
                      schemaVersion: 1,
                      partition: located.partition,
                      epoch: randomUUID(),
                      nextSequence: 1,
                      discardedThrough: 0,
                      entries: [],
                      identities: {},
                    },
                    at,
                  );
                  const id =
                    kind === "fact"
                      ? (value as ExecutionFact).eventId
                      : (value as VersionLinkReceipt).receiptId;
                  const identity = hash([kind, id]);
                  const fingerprint = hash(value);
                  if (journal.identities[identity]) {
                    return journal.identities[identity] === fingerprint
                      ? { ok: true as const, replayed: true }
                      : { ok: false as const, reason: "immutable_conflict" };
                  }
                  // Bounded tombstones preserve immutable identity after payload TTL/eviction.
                  if (Object.keys(journal.identities).length >= Math.max(capacity, 10000)) {
                    return { ok: false as const, reason: "identity_capacity_exhausted" };
                  }
                  if (existing?.entries.some((e) => e.receivedAt > at)) {
                    throw new Error("clock_regression");
                  }
                  const prior = journal.entries.find(
                    (e) =>
                      e.kind === kind &&
                      (e.kind === "fact" ? e.value.eventId : e.value.receiptId) === id,
                  );
                  if (prior) {
                    return hash(prior.value) === hash(value)
                      ? { ok: true as const, replayed: true }
                      : { ok: false as const, reason: "immutable_conflict" };
                  }
                  if (kind === "link") {
                    const receipt = value as VersionLinkReceipt;
                    if (
                      journal.entries.some(
                        (e) =>
                          e.kind === "link" &&
                          e.value.eventIds.some((id) => receipt.eventIds.includes(id)) &&
                          (e.value.outcomeVersion !== receipt.outcomeVersion ||
                            e.value.attemptId !== receipt.attemptId),
                      )
                    ) {
                      return { ok: false as const, reason: "link_version_conflict" };
                    }
                    if (
                      new Set(receipt.eventIds).size !== receipt.eventIds.length ||
                      receipt.eventIds.some(
                        (id) =>
                          !journal.entries.some(
                            (e) =>
                              e.kind === "fact" &&
                              e.value.eventId === id &&
                              e.value.taskId === receipt.taskId &&
                              e.value.runId === receipt.runId &&
                              hash(e.value.scope) === hash(receipt.scope),
                          ),
                      )
                    ) {
                      return { ok: false as const, reason: "link_facts_missing" };
                    }
                  }
                  const next = retain(
                    {
                      ...journal,
                      identities: { ...journal.identities, [identity]: fingerprint },
                      nextSequence: journal.nextSequence + 1,
                      entries: [
                        ...journal.entries,
                        entrySchema.parse({
                          kind,
                          sequence: journal.nextSequence,
                          receivedAt: at,
                          value,
                        }),
                      ],
                    },
                    at,
                  );
                  const serializedBytes = Buffer.byteLength(JSON.stringify(next, null, 2));
                  if (serializedBytes > maxBytes) {
                    return { ok: false as const, reason: "journal_capacity" };
                  }
                  let used = 0,
                    partitions = 0,
                    targetExists = false;
                  try {
                    const names = await fs.readdir(root);
                    for (const name of names) {
                      const item = await fs.lstat(path.join(root, name));
                      if (!item.isFile() || item.isSymbolicLink()) {
                        throw new Error("unsupported_root_entry");
                      }
                      used += item.size;
                      if (/^[a-f0-9]{64}\.json$/.test(name)) {
                        partitions++;
                      }
                      if (name === path.basename(file)) {
                        targetExists = true;
                      }
                    }
                  } catch {
                    return { ok: false as const, reason: "root_budget_unknown" };
                  }
                  if (!targetExists && partitions >= maxPartitions) {
                    return { ok: false as const, reason: "root_partition_capacity" };
                  }
                  // Existing target remains allocated until rename; reserve the full new temporary file.
                  if (used + serializedBytes + 4096 > maxRootBytes) {
                    return { ok: false as const, reason: "root_disk_capacity" };
                  }
                  await writeJsonAtomic(file, next, { mode: 0o600, ensureDirMode: 0o700 });
                  return { ok: true as const, replayed: false };
                }),
              );
            } finally {
              entry.users--;
              if (!entry.users) {
                gates.delete(file);
              }
            }
          }),
        );
      } finally {
        rootGate.users--;
        if (!rootGate.users) {
          gates.delete(rootLock);
        }
      }
    } catch {
      return { ok: false as const, reason: "journal_write_unknown" };
    }
  };
  return {
    appendFact: (input: { agentId: string; fact: ExecutionFact }) =>
      append(input.agentId, "fact", input.fact),
    appendLink: (input: { agentId: string; receipt: VersionLinkReceipt }) =>
      append(input.agentId, "link", input.receipt),
    async query(input: { agentId: string; scope: TrustedScope }) {
      try {
        if (!enabled()) {
          return { ok: false as const, state: "unknown" as const, reason: "journal_disabled" };
        }
        const at = now();
        if (!Number.isFinite(at)) {
          throw new Error("invalid_clock");
        }
        const { file, partition } = location(input.agentId, input.scope);
        const j = await read(file, partition, input.scope);
        if (!j) {
          return { ok: false as const, state: "unknown" as const, reason: "journal_missing" };
        }
        if (j.entries.some((e) => e.receivedAt > at)) {
          throw new Error("clock_regression");
        }
        const retained = retain(j, at);
        const facts = retained.entries.flatMap((e) => (e.kind === "fact" ? [e.value] : []));
        const links = retained.entries.flatMap((e) =>
          e.kind === "link" && e.value.eventIds.every((id) => facts.some((f) => f.eventId === id))
            ? [e.value]
            : [],
        );
        return {
          ok: true as const,
          state: "retained" as const,
          retention: "durable_bounded_journal" as const,
          epoch: j.epoch,
          capacity,
          ttlMs,
          facts,
          links,
          watermark: {
            lastSequence: j.nextSequence - 1,
            discardedThrough: retained.discardedThrough,
          },
          truncated: retained.discardedThrough > 0,
          reasons: ["bounded_retention_not_complete_history"],
        };
      } catch {
        return { ok: false as const, state: "unknown" as const, reason: "journal_read_unknown" };
      }
    },
  };
}
