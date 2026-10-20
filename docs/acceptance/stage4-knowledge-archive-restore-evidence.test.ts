/**
 * Stage 4 知识索引归档还原 E3.
 *
 * Proposition (§5.3 知识索引 backup/restore): under a temp OPENBOT_STATE_DIR,
 * a knowledge index sqlite that follows the product layout
 * (`knowledge/index/personal/<owner>.db`) is included in `backup create`,
 * survives `backup verify`, and after extract reopens with
 * `ensureKnowledgeIndexSchema` retaining seeded rows — not Stage 4 overall
 * PASS. stage8_eligible stays false. Doctor full config-key migration / full
 * store-shard census / multi-beat remain open.
 *
 * Companion: stage4-store-evidence backup create→verify (state payload) +
 * kb-index schema tests. This file pins the knowledge-index archive slice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBackupArchiveRoot } from "../../src/commands/backup-shared.js";
import { backupVerifyCommand } from "../../src/commands/backup-verify.js";
import { backupCreateCommand } from "../../src/commands/backup.js";
import {
  ensureKnowledgeIndexSchema,
  KB_CHUNK_META_TABLE,
  KB_CHUNKS_TABLE,
} from "../../src/gateway/knowledge/kb-index-schema.js";
import { resolveKnowledgeIndexDbPath } from "../../src/gateway/knowledge/kb-index.js";

const MARKER_CHUNK_ID = "chunk-stage4-kb-archive";
const MARKER_TEXT = "stage4-knowledge-archive-marker";
const OWNER_ID = "user-stage4-kb";

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function seedKnowledgeIndex(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureKnowledgeIndexSchema({ db, ftsEnabled: false });
    const now = Date.now();
    db.prepare(
      `INSERT INTO documents (doc_id, kb_id, title, current_version_id, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("doc-stage4", "kb-stage4", "Stage4 Archive Doc", "ver-stage4", "text", now, now);
    db.prepare(
      `INSERT INTO document_versions (version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("ver-stage4", "doc-stage4", "v1", "raw-hash", "sem-hash", now, now);
    db.prepare(`INSERT INTO ${KB_CHUNKS_TABLE} (id, text, model) VALUES (?, ?, ?)`).run(
      MARKER_CHUNK_ID,
      MARKER_TEXT,
      "none",
    );
    db.prepare(
      `INSERT INTO ${KB_CHUNK_META_TABLE}
        (chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      MARKER_CHUNK_ID,
      "kb-stage4",
      "doc-stage4",
      "ver-stage4",
      "h1",
      "s1",
      1,
      1,
      "personal",
      "stage4-evidence",
    );
  } finally {
    db.close();
  }
}

describe("Stage 4 knowledge index archive restore (E3)", () => {
  const temps: string[] = [];
  let prevState: string | undefined;
  let prevClaw: string | undefined;

  afterEach(() => {
    if (prevState === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevState;
    }
    if (prevClaw === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevClaw;
    }
    for (const root of temps.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("create→verify archive includes knowledge/index db; extract reopens with marker rows", async () => {
    prevState = process.env.OPENBOT_STATE_DIR;
    prevClaw = process.env.OPENCLAW_STATE_DIR;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-kb-arch-state-"));
    const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-kb-arch-out-"));
    temps.push(stateDir, archiveDir);
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENCLAW_STATE_DIR;

    fs.writeFileSync(path.join(stateDir, "openbot.json"), JSON.stringify({ theme: "stage4-kb" }));
    const indexRoot = path.join(stateDir, "knowledge", "index");
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: OWNER_ID,
      tenantId: null,
      indexRoot,
    });
    expect(dbPath.replaceAll("\\", "/")).toMatch(/\/knowledge\/index\/personal\/.+\.db$/);
    seedKnowledgeIndex(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const nowMs = Date.UTC(2026, 9, 8, 13, 0, 0);
    const created = await backupCreateCommand(runtime, {
      output: archiveDir,
      includeWorkspace: false,
      nowMs,
    });
    expect(fs.existsSync(created.archivePath)).toBe(true);

    const verified = await backupVerifyCommand(runtime, { archive: created.archivePath });
    expect(verified.ok).toBe(true);
    expect(verified.archiveRoot).toBe(buildBackupArchiveRoot(nowMs));

    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-kb-arch-x-"));
    temps.push(extractDir);
    await tar.x({ file: created.archivePath, cwd: extractDir, gzip: true });
    const listed = walkFiles(extractDir);
    const archivedDb = listed.find(
      (p) => p.replaceAll("\\", "/").includes("/knowledge/index/personal/") && p.endsWith(".db"),
    );
    expect(archivedDb).toBeTruthy();
    expect(archivedDb!.replaceAll("\\", "/")).toContain(
      `/knowledge/index/personal/${OWNER_ID.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    );

    const restored = new DatabaseSync(archivedDb!);
    try {
      expect(() => ensureKnowledgeIndexSchema({ db: restored, ftsEnabled: false })).not.toThrow();
      const chunk = restored
        .prepare(`SELECT id, text FROM ${KB_CHUNKS_TABLE} WHERE id = ?`)
        .get(MARKER_CHUNK_ID) as { id: string; text: string } | undefined;
      expect(chunk).toEqual({ id: MARKER_CHUNK_ID, text: MARKER_TEXT });
      const meta = restored
        .prepare(`SELECT kb_id, doc_id FROM ${KB_CHUNK_META_TABLE} WHERE chunk_id = ?`)
        .get(MARKER_CHUNK_ID) as { kb_id: string; doc_id: string } | undefined;
      expect(meta).toEqual({ kb_id: "kb-stage4", doc_id: "doc-stage4" });
      const doc = restored
        .prepare(`SELECT title FROM documents WHERE doc_id = ?`)
        .get("doc-stage4") as { title: string } | undefined;
      expect(doc?.title).toBe("Stage4 Archive Doc");
    } finally {
      restored.close();
    }
  });

  it("resolveKnowledgeIndexDbPath tenant shard stays under knowledge/index/tenant", () => {
    const indexRoot = path.join("/tmp", "stage4-kb-layout", "knowledge", "index");
    const tenantPath = resolveKnowledgeIndexDbPath({
      ownerId: OWNER_ID,
      tenantId: "acme",
      indexRoot,
    });
    expect(tenantPath.replaceAll("\\", "/")).toMatch(/\/knowledge\/index\/tenant\/.+\.db$/);
  });
});
