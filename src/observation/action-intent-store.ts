import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
/** Durable correlation history only. No configuration or apply authority. */
import { z } from "zod";
import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../infra/file-lock.js";
import { createAsyncLock, writeJsonAtomic } from "../infra/json-files.js";
import type { TrustedScope } from "../task-outcome/types.js";
import type { ActionIntent } from "./action-intent.js";
const serialize = createAsyncLock();
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function scopeIdentity(scope: TrustedScope): string {
  if (scope.kind !== "enterprise" && scope.kind !== "personal") {
    throw new Error("invalid_scope");
  }
  const fields =
    scope.kind === "enterprise"
      ? [
          scope.kind,
          scope.subjectRef,
          scope.authzScopeRef,
          scope.tenantId,
          scope.enterpriseDomainId,
        ]
      : [scope.kind, scope.subjectRef, scope.authzScopeRef, scope.personalDomainId];
  if (!fields.every((v) => typeof v === "string" && v.trim())) {
    throw new Error("invalid_scope");
  }
  return digest(fields);
}
const str = z.string().trim().min(1).max(4096);
const num = z.number().finite();
const revision = z.number().int().nonnegative();
const windowSchema = z.strictObject({ from: num, to: num }).refine((w) => w.from < w.to);
const targetSchema = z.strictObject({
  controlPlane: str,
  targetType: str,
  targetId: str,
  scopeRef: str,
  expectedConfigVersion: str,
  diffDigest: str,
  previewRef: str,
  rollbackPointRef: str,
  rollbackExpectedVersion: str,
  rollbackDiffDigest: str,
});
const receiptSchema = z.strictObject({
  receiptId: str,
  commandId: str,
  idempotencyKey: str,
  requestDigest: str,
  intentRevision: revision,
  target: targetSchema,
  status: z.enum(["accepted", "executing", "succeeded", "failed"]),
  at: num,
  actualVersion: str.nullable(),
});
const readbackSchema = z.strictObject({
  readbackId: str,
  controlPlane: str,
  targetId: str,
  scopeRef: str,
  actualVersion: str,
  actualDiffDigest: str,
  observedAt: num,
});
const intentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  actionIntentId: str,
  revision,
  state: z.enum([
    "draft",
    "needs_evidence",
    "previewed",
    "authorized",
    "accepted",
    "executing",
    "effective",
    "verified",
    "rolled_back",
    "failed",
    "blocked",
    "conflict",
    "rejected",
  ]),
  findingRef: z.strictObject({ findingId: str, source: z.enum(["rule_v1", "reasoning"]) }),
  evidence: z.strictObject({
    sampleRefs: z
      .array(
        z.strictObject({ sampleId: str, taskId: str, outcomeVersion: z.number().int().positive() }),
      )
      .max(1000),
    metricDictVersion: z.number().int().positive(),
    metricId: str,
    denominatorDefinition: str,
    cohortRef: str,
    window: windowSchema,
    eligibility: z.enum(["eligible", "ineligible", "unknown"]),
    improvementEligible: z.boolean(),
    environment: z.enum(["production", "test"]),
    provenance: z.enum(["live", "injected", "seed", "unknown"]),
    reasons: z.array(str).max(100),
  }),
  target: targetSchema,
  approval: z
    .strictObject({
      approvalId: str,
      actorRef: str,
      source: z.literal("user"),
      intentRevision: revision,
      target: targetSchema,
      issuedAt: num,
      expiresAt: num,
      revokedAt: num.nullable(),
    })
    .nullable(),
  authorizedRevision: revision.nullable(),
  command: z.strictObject({ commandId: str, idempotencyKey: str, requestDigest: str }).nullable(),
  receipts: z.array(receiptSchema).max(1000),
  readback: readbackSchema.nullable(),
  verification: z
    .strictObject({
      verificationId: str,
      metricDictVersion: z.number().int().positive(),
      metricId: str,
      denominatorDefinition: str,
      cohortRef: str,
      baselineWindow: windowSchema,
      candidateWindow: windowSchema,
      baselineDenominator: z.number().int().nonnegative(),
      candidateDenominator: z.number().int().nonnegative(),
      eligible: z.boolean(),
      passed: z.boolean(),
      observedAt: num,
    })
    .nullable(),
  rollback: z.strictObject({ receipt: receiptSchema, readback: readbackSchema }).nullable(),
  createdAt: num,
  updatedAt: num,
});
function assertMetadata(value: unknown): asserts value is ActionIntent {
  intentSchema.parse(value);
}
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
type Entry = { commandId: string; requestDigest: string; intent: ActionIntent };
type Journal = { schemaVersion: 1; scopeHash: string; intentId: string; entries: Entry[] };
function summary(intent: ActionIntent) {
  return {
    schemaVersion: intent.schemaVersion,
    actionIntentId: intent.actionIntentId,
    revision: intent.revision,
    state: intent.state,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    target: {
      controlPlane: intent.target.controlPlane,
      targetType: intent.target.targetType,
      targetId: intent.target.targetId,
    },
    receiptCount: intent.receipts.length,
    hasReadback: intent.readback !== null,
    hasVerification: intent.verification !== null,
  };
}
export function createActionIntentStore(rootDir: string) {
  const location = (scope: TrustedScope, id: string) => {
    if (!id.trim()) {
      throw new Error("invalid_intent_id");
    }
    const scopeHash = scopeIdentity(scope);
    return { scopeHash, file: path.join(rootDir, scopeHash, digest(id) + ".json") };
  };
  const read = async (file: string, scopeHash: string, id: string): Promise<Journal | null> => {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    if (Buffer.byteLength(raw) > 16 * 1024 * 1024) {
      throw new Error("history_capacity_exceeded");
    }
    const journal = JSON.parse(raw) as Journal;
    if (
      journal.schemaVersion !== 1 ||
      journal.scopeHash !== scopeHash ||
      journal.intentId !== id ||
      !Array.isArray(journal.entries) ||
      !journal.entries.length ||
      journal.entries.some(
        (e, i) =>
          !e.commandId ||
          !e.requestDigest ||
          e.intent?.actionIntentId !== id ||
          e.intent.revision !== i ||
          !Number.isFinite(e.intent.updatedAt),
      ) ||
      new Set(journal.entries.map((e) => e.commandId)).size !== journal.entries.length
    ) {
      throw new Error("corrupt_intent_history");
    }
    for (const entry of journal.entries) {
      assertMetadata(entry.intent);
    }
    return journal;
  };
  return {
    /** Internal trusted caller only; persistence never grants transition/test authority. */
    async commit(input: {
      scope: TrustedScope;
      intent: ActionIntent;
      expectedRevision: number;
      commandId: string;
      requestDigest: string;
    }) {
      const intent = structuredClone(input.intent);
      assertMetadata(intent);
      const expectedScopeRef =
        input.scope.kind === "enterprise" ? input.scope.tenantId : input.scope.personalDomainId;
      if (intent.target.scopeRef !== expectedScopeRef) {
        throw new Error("scope_mismatch");
      }
      const { file, scopeHash } = location(input.scope, intent.actionIntentId);
      if (
        !input.commandId.trim() ||
        !input.requestDigest.trim() ||
        !Number.isSafeInteger(input.expectedRevision) ||
        intent.revision !== input.expectedRevision + 1 ||
        !Number.isFinite(intent.updatedAt) ||
        intent.updatedAt < intent.createdAt
      ) {
        throw new Error("invalid_commit");
      }
      return serialize(() =>
        withFileLock(file, SESSION_TASK_BOARD_LOCK_OPTIONS, async () => {
          const current = await read(file, scopeHash, intent.actionIntentId);
          const prior = current?.entries.find((e) => e.commandId === input.commandId);
          if (prior) {
            if (
              prior.requestDigest !== input.requestDigest ||
              digest(prior.intent) !== digest(intent)
            ) {
              throw new Error("command_rebind");
            }
            return { replayed: true, revision: prior.intent.revision };
          }
          const latest = current?.entries.at(-1)?.intent;
          if ((latest?.revision ?? -1) !== input.expectedRevision) {
            throw new Error("revision_conflict");
          }
          if (
            latest &&
            (intent.createdAt !== latest.createdAt || intent.updatedAt < latest.updatedAt)
          ) {
            throw new Error("history_conflict");
          }
          if ((current?.entries.length ?? 0) >= 1000) {
            throw new Error("history_capacity_exceeded");
          }
          const journal: Journal = {
            schemaVersion: 1,
            scopeHash,
            intentId: intent.actionIntentId,
            entries: [
              ...(current?.entries ?? []),
              { commandId: input.commandId, requestDigest: input.requestDigest, intent },
            ],
          };
          if (Buffer.byteLength(JSON.stringify(journal)) > 16 * 1024 * 1024) {
            throw new Error("history_capacity_exceeded");
          }
          await writeJsonAtomic(file, journal, { mode: 0o600, ensureDirMode: 0o700 });
          return { replayed: false, revision: intent.revision };
        }),
      );
    },
    async list(
      scope: TrustedScope,
      filter: { taskId: string; outcomeVersion: number; limit?: number; cursor?: string },
    ) {
      const limit = filter.limit ?? 20;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !filter.taskId ||
        !Number.isSafeInteger(filter.outcomeVersion) ||
        filter.outcomeVersion < 1
      ) {
        throw new Error("invalid_list_filter");
      }
      const scopeHash = scopeIdentity(scope);
      const directory = path.join(rootDir, scopeHash);
      let names: string[];
      try {
        names = (await fs.readdir(directory))
          .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
          .toSorted();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { items: [], nextCursor: null };
        }
        throw error;
      }
      if (names.length > 1000) {
        throw new Error("list_capacity_exceeded");
      }
      const rows: ActionIntent[] = [];
      for (const name of names) {
        const raw = JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as {
          intentId?: unknown;
        };
        if (typeof raw.intentId !== "string" || digest(raw.intentId) + ".json" !== name) {
          throw new Error("corrupt_intent_history");
        }
        const journal = await read(path.join(directory, name), scopeHash, raw.intentId);
        const row = journal?.entries.at(-1)?.intent;
        if (
          row?.evidence.sampleRefs.some(
            (r) => r.taskId === filter.taskId && r.outcomeVersion === filter.outcomeVersion,
          )
        ) {
          rows.push(row);
        }
      }
      const snapshot = digest([scopeHash, filter.taskId, filter.outcomeVersion, rows]);
      let offset = 0;
      if (filter.cursor) {
        const cursor = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          snapshot?: unknown;
          offset?: unknown;
        };
        if (
          cursor.snapshot !== snapshot ||
          typeof cursor.offset !== "number" ||
          !Number.isSafeInteger(cursor.offset) ||
          cursor.offset < 0 ||
          cursor.offset > rows.length
        ) {
          throw new Error("stale_or_invalid_cursor");
        }
        offset = cursor.offset;
      }
      const page = rows.slice(offset, offset + limit);
      return {
        items: structuredClone(page),
        nextCursor:
          offset + limit < rows.length
            ? Buffer.from(JSON.stringify({ snapshot, offset: offset + limit })).toString(
                "base64url",
              )
            : null,
      };
    },
    async detail(scope: TrustedScope, intentId: string, revision?: number) {
      const { file, scopeHash } = location(scope, intentId);
      const journal = await read(file, scopeHash, intentId);
      const item =
        revision === undefined
          ? journal?.entries.at(-1)?.intent
          : journal?.entries.find((e) => e.intent.revision === revision)?.intent;
      return item ? structuredClone(item) : null;
    },
    /** Read paths never create directories, locks, or recovery writes. */
    async query(scope: TrustedScope, intentId: string, revision?: number) {
      const { file, scopeHash } = location(scope, intentId);
      const journal = await read(file, scopeHash, intentId);
      const intent =
        revision === undefined
          ? journal?.entries.at(-1)?.intent
          : journal?.entries.find((e) => e.intent.revision === revision)?.intent;
      return intent ? summary(intent) : null;
    },
  };
}
