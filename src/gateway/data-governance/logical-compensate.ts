/**
 * Logical compensation for second-wave resources that share a physical aggregate.
 * File-level quarantine is forbidden when StorageBinding.objectKey is set.
 */

import fs from "node:fs";
import path from "node:path";
import {
  KB_CHUNKS_TABLE,
  KB_CHUNK_META_TABLE,
  KB_FTS_TABLE,
  KB_VECTOR_TABLE,
} from "../knowledge/kb-index-schema.js";
import { openKnowledgeIndex } from "../knowledge/kb-index.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";

export type LogicalCompensateResult = {
  ok: boolean;
  mode: "logical" | "skipped";
  detail?: string;
};

/** Delete one document_version (+ its chunks) from a shared KB SQLite without touching other versions. */
export async function compensateKnowledgeVersionWrite(params: {
  dbPath: string;
  docId: string;
  versionId: string;
}): Promise<LogicalCompensateResult> {
  const dbPath = path.resolve(params.dbPath);
  if (!fs.existsSync(dbPath)) {
    return { ok: true, mode: "skipped", detail: "db_missing" };
  }
  try {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const chunkIds = (
        index.db
          .prepare(
            `SELECT chunk_id FROM ${KB_CHUNK_META_TABLE} WHERE doc_id = ? AND version_id = ?`,
          )
          .all(params.docId, params.versionId) as Array<{ chunk_id: string }>
      ).map((row) => row.chunk_id);

      index.db.exec("BEGIN IMMEDIATE");
      try {
        for (const chunkId of chunkIds) {
          index.db.prepare(`DELETE FROM ${KB_CHUNK_META_TABLE} WHERE chunk_id = ?`).run(chunkId);
          index.db.prepare(`DELETE FROM ${KB_CHUNKS_TABLE} WHERE id = ?`).run(chunkId);
          try {
            index.db.prepare(`DELETE FROM ${KB_FTS_TABLE} WHERE id = ?`).run(chunkId);
          } catch {
            // fts optional
          }
          try {
            index.db.prepare(`DELETE FROM ${KB_VECTOR_TABLE} WHERE id = ?`).run(chunkId);
          } catch {
            // vec optional
          }
          try {
            index.db.prepare(`DELETE FROM chunk_governance WHERE chunk_id = ?`).run(chunkId);
          } catch {
            // optional
          }
        }
        index.db
          .prepare(`DELETE FROM document_versions WHERE doc_id = ? AND version_id = ?`)
          .run(params.docId, params.versionId);
        const remaining = index.db
          .prepare(`SELECT COUNT(1) AS n FROM document_versions WHERE doc_id = ?`)
          .get(params.docId) as { n: number };
        if (!remaining?.n) {
          index.db.prepare(`DELETE FROM documents WHERE doc_id = ?`).run(params.docId);
        } else {
          const latest = index.db
            .prepare(
              `SELECT version_id FROM document_versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1`,
            )
            .get(params.docId) as { version_id: string } | undefined;
          if (latest?.version_id) {
            index.db
              .prepare(`UPDATE documents SET current_version_id = ? WHERE doc_id = ?`)
              .run(latest.version_id, params.docId);
          }
        }
        index.db.exec("COMMIT");
      } catch (err) {
        try {
          index.db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }
      return { ok: true, mode: "logical", detail: `removed_version:${params.versionId}` };
    } finally {
      index.close();
    }
  } catch (err) {
    return {
      ok: false,
      mode: "logical",
      detail: String((err as Error)?.message ?? err),
    };
  }
}

/** CogniWeave journal revoke for shared-aggregate create abort. Fail-closed without revoke. */
export async function compensateMemoryJournalWrite(params: {
  revoke?: () => Promise<void>;
  atomIds?: string[];
  evidenceIds?: string[];
  operationId: string;
  resourceId: string;
  stateDir?: string;
}): Promise<LogicalCompensateResult> {
  if (!params.revoke) {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "memory_logical_compensate",
      reason: "missing_revoke_hook",
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
    return {
      ok: false,
      mode: "skipped",
      detail: "missing_revoke_hook",
    };
  }
  try {
    await params.revoke();
    return {
      ok: true,
      mode: "logical",
      detail:
        params.atomIds || params.evidenceIds
          ? `atoms:${(params.atomIds ?? []).length};evidence:${(params.evidenceIds ?? []).length}`
          : "revoked",
    };
  } catch (err) {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "memory_logical_compensate",
      reason: String((err as Error)?.message ?? err),
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
    return { ok: false, mode: "logical", detail: String((err as Error)?.message ?? err) };
  }
}

/** Restore or delete an identity key inside a shared OI JSON aggregate. */
export async function compensateOperationalIdentityAggregateWrite(params: {
  storePath: string;
  identityId: string;
  /** Pre-write snapshot of the identity entry (undefined = identity did not exist). */
  priorIdentityJson?: string | null;
  /** Optional full prior store snapshot for safer restore. */
  priorStoreJson?: string | null;
}): Promise<LogicalCompensateResult> {
  const storePath = path.resolve(params.storePath);
  try {
    if (params.priorStoreJson != null) {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, params.priorStoreJson, { encoding: "utf8", mode: 0o600 });
      return { ok: true, mode: "logical", detail: "restored_store_snapshot" };
    }
    if (!fs.existsSync(storePath)) {
      return { ok: true, mode: "skipped", detail: "store_missing" };
    }
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as {
      identities?: Record<string, unknown>;
      enterpriseIdentities?: Record<string, unknown>;
    };
    if (parsed.identities && params.identityId in parsed.identities) {
      if (params.priorIdentityJson == null) {
        delete parsed.identities[params.identityId];
      } else {
        parsed.identities[params.identityId] = JSON.parse(params.priorIdentityJson);
      }
      fs.writeFileSync(storePath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      return { ok: true, mode: "logical", detail: "restored_identity_entry" };
    }
    return { ok: true, mode: "skipped", detail: "identity_absent" };
  } catch (err) {
    return { ok: false, mode: "logical", detail: String((err as Error)?.message ?? err) };
  }
}
