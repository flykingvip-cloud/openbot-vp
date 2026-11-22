/**
 * Synthetic, anonymous knowledge-index fixture for t324 scale measurement.
 *
 * Generates ~150 MiB of filler chunks and dozens of spaces. Identifiers and
 * titles are synthetic (`space-01`, `doc-0001`, repeated `x` payloads). The
 * generator never reads or copies a real knowledge base.
 */
import fs from "node:fs";
import path from "node:path";
import { openKnowledgeIndex } from "../kb-index.js";

export const SCALE_OWNER_ID = "scale-user";
export const SCALE_TENANT_ID = "scale-tenant";
export const SCALE_SEAT_ID = "scale-seat";
export const SCALE_SPACE_COUNT = 55;
export const SCALE_TARGET_BYTES = 150 * 1024 * 1024;
export const SCALE_CHUNK_TEXT_BYTES = 16 * 1024;

export type KnowledgeUniverseScaleFixtureStats = {
  root: string;
  dbPath: string;
  basesPath: string;
  spaceCount: number;
  documentCount: number;
  chunkCount: number;
  indexBytes: number;
  generated: boolean;
};

export function scaleFixturePaths(root: string): { basesPath: string; dbPath: string } {
  return {
    basesPath: path.join(root, "knowledge", "bases.json"),
    dbPath: path.join(root, "knowledge", "index", "tenant", `${SCALE_TENANT_ID}.db`),
  };
}

function indexByteSize(dbPath: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = `${dbPath}${suffix}`;
    if (fs.existsSync(filePath)) {
      total += fs.statSync(filePath).size;
    }
  }
  return total;
}

function writeBasesJson(params: {
  basesPath: string;
  spaceCount: number;
  docsPerSpace: number;
  now: number;
}) {
  const bases = Array.from({ length: params.spaceCount }, (_, index) => {
    const serial = String(index + 1).padStart(2, "0");
    const id = `kb-${serial}`;
    const documentIds = Array.from({ length: params.docsPerSpace }, (__, docIndex) => {
      return `doc-${serial}-${String(docIndex + 1).padStart(3, "0")}`;
    });
    return {
      id,
      title: `space-${serial}`,
      description: "",
      ownerId: SCALE_OWNER_ID,
      tenantId: SCALE_TENANT_ID,
      visibility: index % 5 === 0 ? "private" : index % 5 === 1 ? "team" : "enterprise",
      backendKind: index % 5 === 0 ? "personal" : "enterprise",
      robotIds: [],
      tags: ["synthetic"],
      documentIds,
      recycledDocumentIds: [],
      documentCount: documentIds.length,
      createdAtMs: params.now,
      updatedAtMs: params.now,
    };
  });
  fs.mkdirSync(path.dirname(params.basesPath), { recursive: true });
  fs.writeFileSync(params.basesPath, `${JSON.stringify({ bases }, null, 2)}\n`, "utf8");
}

export async function ensureKnowledgeUniverseScaleFixture(params?: {
  root: string;
  spaceCount?: number;
  targetBytes?: number;
  force?: boolean;
}): Promise<KnowledgeUniverseScaleFixtureStats> {
  const root = params?.root;
  if (!root) {
    throw new Error("scale fixture root is required");
  }
  const spaceCount = params?.spaceCount ?? SCALE_SPACE_COUNT;
  const targetBytes = params?.targetBytes ?? SCALE_TARGET_BYTES;
  const { basesPath, dbPath } = scaleFixturePaths(root);
  const existingBytes = fs.existsSync(dbPath) ? indexByteSize(dbPath) : 0;
  if (!params?.force && existingBytes >= targetBytes && fs.existsSync(basesPath)) {
    return {
      root,
      dbPath,
      basesPath,
      spaceCount,
      documentCount: 0,
      chunkCount: 0,
      indexBytes: existingBytes,
      generated: false,
    };
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = `${dbPath}${suffix}`;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  const docsPerSpace = 4;
  const documentCount = spaceCount * docsPerSpace;
  const overheadPerChunk = 800;
  const chunkCount = Math.max(
    documentCount,
    Math.ceil(targetBytes / (SCALE_CHUNK_TEXT_BYTES + overheadPerChunk)),
  );
  const now = Date.now();
  writeBasesJson({ basesPath, spaceCount, docsPerSpace, now });

  const payload = "x".repeat(SCALE_CHUNK_TEXT_BYTES);
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false, ftsEnabled: false });
  try {
    index.db.exec("PRAGMA journal_mode = WAL");
    index.db.exec("PRAGMA synchronous = OFF");
    index.db.exec("PRAGMA temp_store = MEMORY");
    index.db.exec("BEGIN");
    const insertDoc = index.db.prepare(
      `INSERT INTO documents (doc_id, kb_id, title, current_version_id, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'text/plain', ?, ?)`,
    );
    const insertVersion = index.db.prepare(
      `INSERT INTO document_versions (version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at)
       VALUES (?, ?, 'v1', ?, ?, ?, ?)`,
    );
    const insertChunk = index.db.prepare(
      `INSERT INTO chunks (id, text, model) VALUES (?, ?, 'none')`,
    );
    const insertMeta = index.db.prepare(
      `INSERT INTO chunk_meta (chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)
       VALUES (?, ?, ?, ?, NULL, NULL, 1, 1, 'internal', 'synthetic')`,
    );
    const insertGov = index.db.prepare(
      `INSERT INTO chunk_governance (chunk_id, kb_id, quality_score, trust_score, freshness_score, semantic_hash, governance_status, reference_count, last_analyzed_at)
       VALUES (?, ?, 0.5, 0.5, 0.5, ?, 'confirmed', ?, ?)`,
    );
    const insertRel = index.db.prepare(
      `INSERT INTO chunk_relations (id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    );
    const insertTask = index.db.prepare(
      `INSERT INTO governance_tasks (id, kb_id, task_type, status, priority, related_chunk_ids, proposed_resolution, assigned_to, created_at, updated_at)
       VALUES (?, ?, 'conflict', 'open', 1, ?, NULL, NULL, ?, ?)`,
    );
    const insertDeliverable = index.db.prepare(
      `INSERT INTO agent_generated_knowledge (knowledge_id, kb_id, agent_id, type, title, summary, source_lineage_id, source_deliverable_id, status, created_at, updated_at)
       VALUES (?, ?, NULL, 'auto_analysis', ?, NULL, NULL, ?, 'pending', ?, ?)`,
    );

    const docIds: Array<{ docId: string; kbId: string; versionId: string }> = [];
    for (let space = 1; space <= spaceCount; space += 1) {
      const serial = String(space).padStart(2, "0");
      const kbId = `kb-${serial}`;
      for (let doc = 1; doc <= docsPerSpace; doc += 1) {
        const docId = `doc-${serial}-${String(doc).padStart(3, "0")}`;
        const versionId = `ver-${serial}-${String(doc).padStart(3, "0")}`;
        insertDoc.run(docId, kbId, docId, versionId, now, now);
        insertVersion.run(versionId, docId, `raw-${docId}`, `sem-${docId}`, now, now);
        docIds.push({ docId, kbId, versionId });
      }
    }

    const firstChunkBySpace = new Map<string, string>();
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const doc = docIds[chunkIndex % docIds.length];
      const chunkId = `chunk-${String(chunkIndex + 1).padStart(6, "0")}`;
      const shared = chunkIndex % 50 === 0;
      const semanticHash = shared
        ? `shared-hash-${String((chunkIndex / 50) % 20)}`
        : `uniq-${chunkId}`;
      insertChunk.run(chunkId, payload);
      insertMeta.run(chunkId, doc.kbId, doc.docId, doc.versionId);
      insertGov.run(chunkId, doc.kbId, semanticHash, chunkIndex % 7, now);
      if (!firstChunkBySpace.has(doc.kbId)) {
        firstChunkBySpace.set(doc.kbId, chunkId);
      } else if (chunkIndex % 17 === 0) {
        const fromChunk = firstChunkBySpace.get(doc.kbId);
        if (fromChunk && fromChunk !== chunkId) {
          insertRel.run(
            `rel-${chunkId}`,
            doc.kbId,
            fromChunk,
            chunkId,
            chunkIndex % 51 === 0 ? "conflict" : "reference",
            now,
          );
        }
      }
    }

    let taskCount = 0;
    for (const [kbId, chunkId] of firstChunkBySpace.entries()) {
      if (taskCount >= 12) {
        break;
      }
      insertTask.run(`task-${kbId}`, kbId, JSON.stringify([chunkId]), now, now);
      taskCount += 1;
    }
    let deliverableCount = 0;
    for (const doc of docIds) {
      if (deliverableCount >= 20) {
        break;
      }
      insertDeliverable.run(
        `agk-${deliverableCount + 1}`,
        doc.kbId,
        `deliverable-${String(deliverableCount + 1).padStart(2, "0")}`,
        `deliv-${deliverableCount + 1}`,
        now,
        now,
      );
      deliverableCount += 1;
    }
    index.db.exec("COMMIT");
    index.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    index.close();
  }

  return {
    root,
    dbPath,
    basesPath,
    spaceCount,
    documentCount,
    chunkCount,
    indexBytes: indexByteSize(dbPath),
    generated: true,
  };
}
