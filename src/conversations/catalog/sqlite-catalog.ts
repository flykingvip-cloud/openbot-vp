import { mkdirSync } from "node:fs";
/**
 * Local SQLite Conversation Catalog under Data Root (CL-P0-02).
 * Does not store message bodies. Failures must not corrupt transcripts.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  ConversationLegalHoldRecord,
  ConversationLifecycleJob,
  ConversationPurgeJob,
  ConversationRecord,
  ConversationSessionBinding,
  MemorySourceIdentity,
  MemorySourceLocatorAlias,
} from "../types.js";
import {
  CatalogConcurrencyError,
  CatalogNotFoundError,
  type ConversationCatalogRepository,
  type ConversationListFilter,
  type ConversationListPage,
} from "./repository.js";

const require = createRequire(import.meta.url);

function requireNodeSqlite(): { DatabaseSync: typeof DatabaseSync } {
  return require("node:sqlite") as { DatabaseSync: typeof DatabaseSync };
}

type PayloadRow = { payload: string };

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function decode<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function normalizeConversationRecord(raw: ConversationRecord): ConversationRecord {
  return {
    ...raw,
    lifecycleStatusBeforeArchive:
      raw.lifecycleStatusBeforeArchive === "ACTIVE" || raw.lifecycleStatusBeforeArchive === "CLOSED"
        ? raw.lifecycleStatusBeforeArchive
        : (raw.lifecycleStatusBeforeArchive ?? null),
  };
}

function normalizeSourceIdentity(raw: MemorySourceIdentity): MemorySourceIdentity {
  return {
    ...raw,
    turnIndexRange: raw.turnIndexRange ?? [0, 0],
    contentChecksum: raw.contentChecksum ?? "",
  };
}

function encodeCursor(updatedAt: string, conversationId: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt, id: conversationId }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { u: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      u?: string;
      id?: string;
    };
    if (typeof parsed.u === "string" && typeof parsed.id === "string") {
      return { u: parsed.u, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export type SqliteConversationCatalogOptions = {
  path: string;
};

export class SqliteConversationCatalog implements ConversationCatalogRepository {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(options: SqliteConversationCatalogOptions) {
    this.path = options.path;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const { DatabaseSync: Db } = requireNodeSqlite();
    this.db = new Db(this.path);
    this.db.exec("pragma foreign_keys = on;");
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec("pragma busy_timeout = 5000;");
    this.bootstrap();
    this.migrateLifecycleJobLeaseColumns();
  }

  /** Best-effort column add for claim/lease (existing DBs). */
  private migrateLifecycleJobLeaseColumns(): void {
    const cols = this.db.prepare(`pragma table_info(lifecycle_jobs)`).all() as Array<{
      name: string;
    }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("lease_owner")) {
      this.db.exec(`alter table lifecycle_jobs add column lease_owner text`);
    }
    if (!names.has("lease_expires_at")) {
      this.db.exec(`alter table lifecycle_jobs add column lease_expires_at text`);
    }
    if (!names.has("claim_generation")) {
      this.db.exec(
        `alter table lifecycle_jobs add column claim_generation integer not null default 0`,
      );
    }
  }

  private bootstrap(): void {
    this.db.exec(`
      create table if not exists conversations (
        conversation_id text not null,
        data_plane_id text not null,
        tenant_id text,
        ownership_scope_id text,
        agent_id text,
        group_id text,
        lifecycle_status text not null,
        updated_at text not null,
        etag text not null,
        payload text not null,
        primary key (data_plane_id, conversation_id)
      );
      create index if not exists idx_conv_list
        on conversations(data_plane_id, lifecycle_status, updated_at desc);
      create index if not exists idx_conv_owner
        on conversations(data_plane_id, ownership_scope_id, updated_at desc);

      create table if not exists bindings (
        binding_id text not null,
        data_plane_id text not null,
        conversation_id text not null,
        session_id text not null,
        session_key text not null,
        role text not null,
        payload text not null,
        primary key (data_plane_id, binding_id)
      );
      create unique index if not exists idx_binding_session
        on bindings(data_plane_id, session_id);
      create index if not exists idx_binding_conv
        on bindings(data_plane_id, conversation_id);

      create table if not exists migration_keys (
        data_plane_id text not null,
        migration_key text not null,
        binding_id text not null,
        primary key (data_plane_id, migration_key)
      );

      create table if not exists legal_holds (
        hold_id text not null,
        data_plane_id text not null,
        conversation_id text not null,
        status text not null,
        payload text not null,
        primary key (data_plane_id, hold_id)
      );
      create index if not exists idx_holds_conv
        on legal_holds(data_plane_id, conversation_id, status);

      create table if not exists purge_jobs (
        purge_job_id text not null,
        data_plane_id text not null,
        conversation_id text not null,
        request_id text not null,
        status text not null,
        payload text not null,
        primary key (data_plane_id, purge_job_id)
      );
      create unique index if not exists idx_purge_request
        on purge_jobs(data_plane_id, conversation_id, request_id);

      create table if not exists lifecycle_jobs (
        job_id text not null,
        data_plane_id text not null,
        conversation_id text not null,
        request_id text not null,
        kind text not null,
        status text not null,
        lease_owner text,
        lease_expires_at text,
        claim_generation integer not null default 0,
        payload text not null,
        primary key (data_plane_id, job_id)
      );
      create unique index if not exists idx_lifecycle_request
        on lifecycle_jobs(data_plane_id, conversation_id, request_id);

      create table if not exists source_identities (
        source_identity_id text not null,
        data_plane_id text not null,
        conversation_id text not null,
        payload text not null,
        primary key (data_plane_id, source_identity_id)
      );

      create table if not exists locator_aliases (
        source_identity_id text not null,
        data_plane_id text not null,
        locator text not null,
        active integer not null,
        payload text not null,
        primary key (data_plane_id, source_identity_id, locator)
      );
    `);
  }

  async createConversation(
    record: ConversationRecord,
    binding: ConversationSessionBinding,
  ): Promise<ConversationRecord> {
    const insert = this.db.prepare(`
      insert into conversations (
        conversation_id, data_plane_id, tenant_id, ownership_scope_id,
        agent_id, group_id, lifecycle_status, updated_at, etag, payload
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBinding = this.db.prepare(`
      insert into bindings (
        binding_id, data_plane_id, conversation_id, session_id, session_key, role, payload
      ) values (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      record.conversationId,
      record.dataPlaneId,
      record.tenantId,
      record.ownershipScopeId,
      record.agentId,
      record.groupId,
      record.lifecycleStatus,
      record.updatedAt,
      record.etag,
      encode(record),
    );
    insertBinding.run(
      binding.bindingId,
      binding.dataPlaneId,
      binding.conversationId,
      binding.sessionId,
      binding.sessionKey,
      binding.role,
      encode(binding),
    );
    return record;
  }

  async getConversation(
    dataPlaneId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const row = this.db
      .prepare(`select payload from conversations where data_plane_id = ? and conversation_id = ?`)
      .get(dataPlaneId, conversationId) as PayloadRow | undefined;
    return row ? normalizeConversationRecord(decode<ConversationRecord>(row.payload)) : null;
  }

  async updateConversation(
    record: ConversationRecord,
    expectedEtag: string,
  ): Promise<ConversationRecord> {
    const result = this.db
      .prepare(
        `update conversations set
          tenant_id = ?, ownership_scope_id = ?, agent_id = ?, group_id = ?,
          lifecycle_status = ?, updated_at = ?, etag = ?, payload = ?
         where data_plane_id = ? and conversation_id = ? and etag = ?`,
      )
      .run(
        record.tenantId,
        record.ownershipScopeId,
        record.agentId,
        record.groupId,
        record.lifecycleStatus,
        record.updatedAt,
        record.etag,
        encode(record),
        record.dataPlaneId,
        record.conversationId,
        expectedEtag,
      );
    if (result.changes === 0) {
      const existing = await this.getConversation(record.dataPlaneId, record.conversationId);
      if (!existing) {
        throw new CatalogNotFoundError();
      }
      throw new CatalogConcurrencyError();
    }
    return record;
  }

  async listConversations(filter: ConversationListFilter): Promise<ConversationListPage> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const statuses = filter.lifecycleStatus
      ? Array.isArray(filter.lifecycleStatus)
        ? filter.lifecycleStatus
        : [filter.lifecycleStatus]
      : null;

    const where: string[] = ["data_plane_id = ?"];
    const params: unknown[] = [filter.dataPlaneId];

    if (filter.tenantId !== undefined) {
      if (filter.tenantId == null) {
        where.push("tenant_id is null");
      } else {
        where.push("tenant_id = ?");
        params.push(filter.tenantId);
      }
    }
    if (filter.ownershipScopeId) {
      where.push("ownership_scope_id = ?");
      params.push(filter.ownershipScopeId);
    }
    if (filter.agentId) {
      where.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.groupId) {
      where.push("group_id = ?");
      params.push(filter.groupId);
    }
    if (statuses && statuses.length > 0) {
      where.push(`lifecycle_status in (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (filter.updatedAfter) {
      where.push("updated_at >= ?");
      params.push(filter.updatedAfter);
    }
    if (filter.updatedBefore) {
      where.push("updated_at <= ?");
      params.push(filter.updatedBefore);
    }

    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;
    if (cursor) {
      where.push("(updated_at < ? or (updated_at = ? and conversation_id < ?))");
      params.push(cursor.u, cursor.u, cursor.id);
    }

    params.push(limit + 1);
    const sql = `
      select payload from conversations
      where ${where.join(" and ")}
      order by updated_at desc, conversation_id desc
      limit ?
    `;
    // node:sqlite all() expects SQLInputValue[]; bind as string/number/null only.
    const bind: SQLInputValue[] = params.map((p): SQLInputValue => {
      if (p === null || p === undefined) {
        return null;
      }
      if (typeof p === "number" || typeof p === "bigint") {
        return p;
      }
      if (typeof p === "boolean") {
        return p ? 1 : 0;
      }
      if (typeof p === "string") {
        return p;
      }
      return JSON.stringify(p);
    });
    const rows = (this.db.prepare(sql).all(...bind) as PayloadRow[]).map((r) =>
      normalizeConversationRecord(decode<ConversationRecord>(r.payload)),
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.updatedAt, last.conversationId) : null;
    return { rows: page, nextCursor };
  }

  async getBinding(
    dataPlaneId: string,
    bindingId: string,
  ): Promise<ConversationSessionBinding | null> {
    const row = this.db
      .prepare(`select payload from bindings where data_plane_id = ? and binding_id = ?`)
      .get(dataPlaneId, bindingId) as PayloadRow | undefined;
    return row ? decode<ConversationSessionBinding>(row.payload) : null;
  }

  async listBindings(
    dataPlaneId: string,
    conversationId: string,
  ): Promise<ConversationSessionBinding[]> {
    const rows = this.db
      .prepare(`select payload from bindings where data_plane_id = ? and conversation_id = ?`)
      .all(dataPlaneId, conversationId) as PayloadRow[];
    const bindings = rows.map((r) => decode<ConversationSessionBinding>(r.payload));
    // Stable order: user-visible streams first, then by role, then bindingId.
    // Prevents accidental AGENT_EXECUTION-first receipts when SQLite row order is arbitrary.
    const roleRank = (role: string): number => {
      if (role === "PRIMARY" || role === "GROUP_PUBLIC") {
        return 0;
      }
      if (role === "AGENT_EXECUTION") {
        return 2;
      }
      return 1;
    };
    return bindings.toSorted((a, b) => {
      const rr = roleRank(a.role) - roleRank(b.role);
      if (rr !== 0) {
        return rr;
      }
      return a.bindingId.localeCompare(b.bindingId);
    });
  }

  async findBindingBySessionId(
    dataPlaneId: string,
    sessionId: string,
  ): Promise<ConversationSessionBinding | null> {
    const row = this.db
      .prepare(`select payload from bindings where data_plane_id = ? and session_id = ?`)
      .get(dataPlaneId, sessionId) as PayloadRow | undefined;
    return row ? decode<ConversationSessionBinding>(row.payload) : null;
  }

  async findBindingByMigrationKey(
    dataPlaneId: string,
    migrationKey: string,
  ): Promise<ConversationSessionBinding | null> {
    const map = this.db
      .prepare(
        `select binding_id from migration_keys where data_plane_id = ? and migration_key = ?`,
      )
      .get(dataPlaneId, migrationKey) as { binding_id: string } | undefined;
    if (!map) {
      return null;
    }
    return this.getBinding(dataPlaneId, map.binding_id);
  }

  async saveBinding(binding: ConversationSessionBinding): Promise<void> {
    this.db
      .prepare(
        `insert into bindings (
          binding_id, data_plane_id, conversation_id, session_id, session_key, role, payload
        ) values (?, ?, ?, ?, ?, ?, ?)
        on conflict(data_plane_id, binding_id) do update set
          conversation_id = excluded.conversation_id,
          session_id = excluded.session_id,
          session_key = excluded.session_key,
          role = excluded.role,
          payload = excluded.payload`,
      )
      .run(
        binding.bindingId,
        binding.dataPlaneId,
        binding.conversationId,
        binding.sessionId,
        binding.sessionKey,
        binding.role,
        encode(binding),
      );
  }

  async putMigrationKey(
    dataPlaneId: string,
    migrationKey: string,
    bindingId: string,
  ): Promise<void> {
    this.db
      .prepare(
        `insert into migration_keys (data_plane_id, migration_key, binding_id)
         values (?, ?, ?)
         on conflict(data_plane_id, migration_key) do update set binding_id = excluded.binding_id`,
      )
      .run(dataPlaneId, migrationKey, bindingId);
  }

  async saveLegalHold(hold: ConversationLegalHoldRecord): Promise<void> {
    this.db
      .prepare(
        `insert into legal_holds (hold_id, data_plane_id, conversation_id, status, payload)
         values (?, ?, ?, ?, ?)
         on conflict(data_plane_id, hold_id) do update set
           status = excluded.status,
           payload = excluded.payload`,
      )
      .run(hold.holdId, hold.dataPlaneId, hold.conversationId, hold.status, encode(hold));
  }

  async listActiveLegalHolds(
    dataPlaneId: string,
    conversationId: string,
  ): Promise<ConversationLegalHoldRecord[]> {
    const rows = this.db
      .prepare(
        `select payload from legal_holds
         where data_plane_id = ? and conversation_id = ? and status = 'ACTIVE'`,
      )
      .all(dataPlaneId, conversationId) as PayloadRow[];
    return rows.map((r) => decode<ConversationLegalHoldRecord>(r.payload));
  }

  async savePurgeJob(job: ConversationPurgeJob): Promise<void> {
    this.db
      .prepare(
        `insert into purge_jobs (
          purge_job_id, data_plane_id, conversation_id, request_id, status, payload
        ) values (?, ?, ?, ?, ?, ?)
        on conflict(data_plane_id, purge_job_id) do update set
          status = excluded.status,
          payload = excluded.payload`,
      )
      .run(
        job.purgeJobId,
        job.dataPlaneId,
        job.conversationId,
        job.requestId,
        job.status,
        encode(job),
      );
  }

  async getPurgeJob(dataPlaneId: string, purgeJobId: string): Promise<ConversationPurgeJob | null> {
    const row = this.db
      .prepare(`select payload from purge_jobs where data_plane_id = ? and purge_job_id = ?`)
      .get(dataPlaneId, purgeJobId) as PayloadRow | undefined;
    return row ? decode<ConversationPurgeJob>(row.payload) : null;
  }

  async findPurgeJobByRequestId(
    dataPlaneId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationPurgeJob | null> {
    const row = this.db
      .prepare(
        `select payload from purge_jobs
         where data_plane_id = ? and conversation_id = ? and request_id = ?`,
      )
      .get(dataPlaneId, conversationId, requestId) as PayloadRow | undefined;
    return row ? decode<ConversationPurgeJob>(row.payload) : null;
  }

  async saveLifecycleJob(job: ConversationLifecycleJob): Promise<void> {
    this.db
      .prepare(
        `insert into lifecycle_jobs (
          job_id, data_plane_id, conversation_id, request_id, kind, status,
          lease_owner, lease_expires_at, claim_generation, payload
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(data_plane_id, job_id) do update set
          status = excluded.status,
          kind = excluded.kind,
          lease_owner = excluded.lease_owner,
          lease_expires_at = excluded.lease_expires_at,
          claim_generation = excluded.claim_generation,
          payload = excluded.payload`,
      )
      .run(
        job.jobId,
        job.dataPlaneId,
        job.conversationId,
        job.requestId,
        job.kind,
        job.status,
        job.leaseOwner,
        job.leaseExpiresAt,
        job.claimGeneration ?? 0,
        encode(job),
      );
  }

  async claimLifecycleJob(params: {
    dataPlaneId: string;
    jobId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null> {
    // Atomic claim: PENDING / FAILED_RETRYABLE, or RUNNING with expired/missing lease.
    const result = this.db
      .prepare(
        `update lifecycle_jobs
         set status = 'RUNNING',
             lease_owner = ?,
             lease_expires_at = ?,
             claim_generation = claim_generation + 1,
             payload = ?
         where data_plane_id = ?
           and job_id = ?
           and (
             status in ('PENDING', 'FAILED_RETRYABLE')
             or (
               status = 'RUNNING'
               and (lease_expires_at is null or lease_expires_at < ?)
             )
           )`,
      )
      .run(
        params.leaseOwner,
        params.leaseExpiresAt,
        encode(params.nextJob),
        params.dataPlaneId,
        params.jobId,
        params.now,
      );
    if (Number(result.changes) !== 1) {
      return null;
    }
    return this.getLifecycleJob(params.dataPlaneId, params.jobId);
  }

  async completeLifecycleJobFenced(params: {
    dataPlaneId: string;
    jobId: string;
    expectedLeaseOwner: string;
    expectedClaimGeneration: number;
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null> {
    const result = this.db
      .prepare(
        `update lifecycle_jobs
         set status = ?,
             lease_owner = ?,
             lease_expires_at = ?,
             claim_generation = ?,
             payload = ?
         where data_plane_id = ?
           and job_id = ?
           and status = 'RUNNING'
           and lease_owner = ?
           and claim_generation = ?`,
      )
      .run(
        params.nextJob.status,
        params.nextJob.leaseOwner,
        params.nextJob.leaseExpiresAt,
        params.nextJob.claimGeneration ?? params.expectedClaimGeneration,
        encode(params.nextJob),
        params.dataPlaneId,
        params.jobId,
        params.expectedLeaseOwner,
        params.expectedClaimGeneration,
      );
    if (Number(result.changes) !== 1) {
      return null;
    }
    return this.getLifecycleJob(params.dataPlaneId, params.jobId);
  }

  async renewLifecycleLease(params: {
    dataPlaneId: string;
    jobId: string;
    expectedLeaseOwner: string;
    expectedClaimGeneration: number;
    leaseExpiresAt: string;
    now: string;
    nextJob: ConversationLifecycleJob;
  }): Promise<ConversationLifecycleJob | null> {
    const result = this.db
      .prepare(
        `update lifecycle_jobs
         set lease_expires_at = ?,
             payload = ?
         where data_plane_id = ?
           and job_id = ?
           and status = 'RUNNING'
           and lease_owner = ?
           and claim_generation = ?`,
      )
      .run(
        params.leaseExpiresAt,
        encode(params.nextJob),
        params.dataPlaneId,
        params.jobId,
        params.expectedLeaseOwner,
        params.expectedClaimGeneration,
      );
    if (Number(result.changes) !== 1) {
      return null;
    }
    return this.getLifecycleJob(params.dataPlaneId, params.jobId);
  }

  async getLifecycleJob(
    dataPlaneId: string,
    jobId: string,
  ): Promise<ConversationLifecycleJob | null> {
    const row = this.db
      .prepare(`select payload from lifecycle_jobs where data_plane_id = ? and job_id = ?`)
      .get(dataPlaneId, jobId) as PayloadRow | undefined;
    return row ? decode<ConversationLifecycleJob>(row.payload) : null;
  }

  async findLifecycleJobByRequestId(
    dataPlaneId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationLifecycleJob | null> {
    const row = this.db
      .prepare(
        `select payload from lifecycle_jobs
         where data_plane_id = ? and conversation_id = ? and request_id = ?`,
      )
      .get(dataPlaneId, conversationId, requestId) as PayloadRow | undefined;
    return row ? decode<ConversationLifecycleJob>(row.payload) : null;
  }

  async saveSourceIdentity(identity: MemorySourceIdentity): Promise<void> {
    this.db
      .prepare(
        `insert into source_identities (source_identity_id, data_plane_id, conversation_id, payload)
         values (?, ?, ?, ?)
         on conflict(data_plane_id, source_identity_id) do update set payload = excluded.payload`,
      )
      .run(
        identity.sourceIdentityId,
        identity.dataPlaneId,
        identity.conversationId,
        encode(identity),
      );
  }

  async getSourceIdentity(
    dataPlaneId: string,
    sourceIdentityId: string,
  ): Promise<MemorySourceIdentity | null> {
    const row = this.db
      .prepare(
        `select payload from source_identities
         where data_plane_id = ? and source_identity_id = ?`,
      )
      .get(dataPlaneId, sourceIdentityId) as PayloadRow | undefined;
    return row ? normalizeSourceIdentity(decode<MemorySourceIdentity>(row.payload)) : null;
  }

  async saveLocatorAlias(dataPlaneId: string, alias: MemorySourceLocatorAlias): Promise<void> {
    this.db
      .prepare(
        `insert into locator_aliases (
          source_identity_id, data_plane_id, locator, active, payload
        ) values (?, ?, ?, ?, ?)
        on conflict(data_plane_id, source_identity_id, locator) do update set
          active = excluded.active,
          payload = excluded.payload`,
      )
      .run(alias.sourceIdentityId, dataPlaneId, alias.locator, alias.active ? 1 : 0, encode(alias));
  }

  async listLocatorAliases(
    dataPlaneId: string,
    sourceIdentityId: string,
  ): Promise<MemorySourceLocatorAlias[]> {
    const rows = this.db
      .prepare(
        `select payload from locator_aliases
         where data_plane_id = ? and source_identity_id = ?`,
      )
      .all(dataPlaneId, sourceIdentityId) as PayloadRow[];
    return rows.map((r) => decode<MemorySourceLocatorAlias>(r.payload));
  }

  close(): void {
    this.db.close();
  }
}
