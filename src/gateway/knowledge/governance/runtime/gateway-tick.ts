import { loadConfig } from "../../../../config/config.js";
import { KB_CHUNK_META_TABLE } from "../../kb-index-schema.js";
import { openKnowledgeIndex } from "../../kb-index.js";
import { listKnowledgeIndexDbPaths } from "../../knowledge-directory.js";
import { enqueueGovernanceJob } from "../chunk-governance-store.js";
import type { GovernanceJobPayload, GovernanceJobType } from "../types.js";
import { GOVERNANCE_JOB_PRIORITIES } from "./governance-job-priorities.js";
import { runGovernanceJobsForDatabase } from "./job-runner.js";

export function enqueuePostIngestGovernanceJobs(params: {
  db: import("node:sqlite").DatabaseSync;
  kbId: string;
  docId: string;
  versionId: string;
  chunkIds: string[];
}): void {
  if (params.chunkIds.length === 0) {
    return;
  }
  const payload: GovernanceJobPayload = {
    chunkIds: params.chunkIds,
    docId: params.docId,
    versionId: params.versionId,
  };
  enqueueGovernanceJob({
    db: params.db,
    kbId: params.kbId,
    jobType: "dedup",
    payload,
    priority: GOVERNANCE_JOB_PRIORITIES.dedup,
  });
  enqueueGovernanceJob({
    db: params.db,
    kbId: params.kbId,
    jobType: "conflict-analysis",
    payload,
    priority: GOVERNANCE_JOB_PRIORITIES.conflictAnalysis,
  });
  enqueueGovernanceJob({
    db: params.db,
    kbId: params.kbId,
    jobType: "quality-refresh",
    payload,
    priority: GOVERNANCE_JOB_PRIORITIES.qualityRefresh,
  });
  enqueueGovernanceJob({
    db: params.db,
    kbId: params.kbId,
    jobType: "claim-extraction",
    payload,
    priority: GOVERNANCE_JOB_PRIORITIES.claimExtraction,
  });
}

function listIndexedKnowledgeBaseIds(db: import("node:sqlite").DatabaseSync): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT kb_id FROM ${KB_CHUNK_META_TABLE} ORDER BY kb_id ASC`)
    .all() as Array<{ kb_id: string }>;
  return rows.map((row) => row.kb_id).filter(Boolean);
}

function hasActiveGovernanceJob(params: {
  db: import("node:sqlite").DatabaseSync;
  kbId: string;
  jobType: GovernanceJobType;
}): boolean {
  const row = params.db
    .prepare(
      `SELECT 1 AS ok FROM governance_jobs
       WHERE kb_id = ?
         AND job_type = ?
         AND status IN ('pending', 'running', 'retrying')
       LIMIT 1`,
    )
    .get(params.kbId, params.jobType) as { ok: number } | undefined;
  return Boolean(row);
}

function enqueuePeriodicGovernanceScans(params: { db: import("node:sqlite").DatabaseSync }): void {
  for (const kbId of listIndexedKnowledgeBaseIds(params.db)) {
    const payload: GovernanceJobPayload = { chunkIds: [] };
    if (!hasActiveGovernanceJob({ db: params.db, kbId, jobType: "orphan-scan" })) {
      enqueueGovernanceJob({
        db: params.db,
        kbId,
        jobType: "orphan-scan",
        payload,
        priority: GOVERNANCE_JOB_PRIORITIES.orphanScan,
      });
    }
    if (!hasActiveGovernanceJob({ db: params.db, kbId, jobType: "stale-scan" })) {
      enqueueGovernanceJob({
        db: params.db,
        kbId,
        jobType: "stale-scan",
        payload,
        priority: GOVERNANCE_JOB_PRIORITIES.staleScan,
      });
    }
  }
}

export async function tickKnowledgeGovernanceJobs(params?: {
  indexRoot?: string;
  tenantsRoot?: string;
  configDir?: string;
  maxDatabasesPerRound?: number;
}): Promise<{ databases: number; processed: number; failed: number; archived: number }> {
  const dbPaths = listKnowledgeIndexDbPaths({
    indexRoot: params?.indexRoot,
    tenantsRoot: params?.tenantsRoot,
    configDir: params?.configDir,
  });
  let processed = 0;
  let failed = 0;
  let databases = 0;
  const limit = params?.maxDatabasesPerRound ?? 8;
  const cfg = loadConfig();
  for (const dbPath of dbPaths.slice(0, limit)) {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      enqueuePeriodicGovernanceScans({ db: index.db });
      const result = await runGovernanceJobsForDatabase({
        db: index.db,
        dbPath,
        cfg,
      });
      if (result.processed > 0 || result.failed > 0) {
        databases += 1;
      }
      processed += result.processed;
      failed += result.failed;
    } finally {
      index.close();
    }
  }
  try {
    const { tickKnowledgeVectorizeJobs } = await import("../../vectorize-runtime.js");
    await tickKnowledgeVectorizeJobs({
      ...(params?.indexRoot ? { indexRoot: params.indexRoot } : {}),
      maxDatabasesPerRound: params?.maxDatabasesPerRound,
    });
  } catch {
    // Background vectorize must not fail the maintenance tick.
  }
  // `archived` stays 0: captured agent/collab files enter 个人成果 / 团队成果
  // only after the user previews and clicks 保存. Do not silently ingest here.
  return { databases, processed, failed, archived: 0 };
}
