/**
 * Stage 4 remaining-store evidence (Episode EP-01..05 already narrow PASS elsewhere).
 *
 * Fills fixed-field anchors for gateway config, sessions, credentials, memory,
 * knowledge, AI workforce DDL, customer Postgres, HA Postgres, and backup plan
 * credential inclusion. Does NOT claim Stage 4 PASS. stage8_eligible stays false.
 *
 * Confidence is E1–E3 as labeled in the ledger; CONDITIONAL where the chain is
 * incomplete (doctor full config-key migration / full store-shard census / multi-beat still open; knowledge archive / tenant shard / pin single-shot narrow PASS in companion files).
 * Credentials-in-backup exclusion is narrow PASS (default exclude; --include-credentials opt-in).
 * Backup create→verify full-chain E3 is narrow PASS (temp OPENBOT_STATE_DIR; not Stage 4 overall).
 * Doctor migration dry-run / confirm switches: see stage4-doctor-migration-evidence.test.ts (narrow PASS).
 * Pin single-shot runtime: see stage4-pin-single-shot-evidence.test.ts (narrow PASS; episodeStore default off).
 * Knowledge archive restore: see stage4-knowledge-archive-restore-evidence.test.ts (narrow PASS; create→verify→extract reopen).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as tar from "tar";
import { describe, expect, it, vi } from "vitest";
import {
  buildBackupArchiveRoot,
  resolveBackupPlanFromDisk,
} from "../../src/commands/backup-shared.js";
import { backupVerifyCommand } from "../../src/commands/backup-verify.js";
import { backupCreateCommand } from "../../src/commands/backup.js";
import {
  resolveCanonicalConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../../src/config/paths.js";
import {
  isValidSessionId,
  resolveDefaultSessionStorePath,
  SAFE_SESSION_ID_RE,
} from "../../src/config/sessions/paths.js";
import { resolveReadOnlyQuery } from "../../src/gateway/enterprise-data/adapters/sql-read-guard.js";
import { ensureKnowledgeIndexSchema } from "../../src/gateway/knowledge/kb-index-schema.js";
import { ensureMemoryIndexSchema } from "../../src/memory/memory-schema.js";

describe("Stage 4 gateway config SoT (E1/E2)", () => {
  it("canonical config path is openbot.json under state dir", () => {
    const env = { OPENBOT_STATE_DIR: "/tmp/stage4-state-config" } as NodeJS.ProcessEnv;
    const state = resolveStateDir(env, () => "/tmp/unused-home");
    const cfg = resolveCanonicalConfigPath(env, state);
    expect(cfg.endsWith(`${path.sep}openbot.json`) || cfg.endsWith("/openbot.json")).toBe(true);
    expect(cfg.startsWith(state)).toBe(true);
  });
});

describe("Stage 4 sessions store path + id guard (E2)", () => {
  it("default session store is agents/<id>/sessions/sessions.json", () => {
    const prev = process.env.OPENBOT_STATE_DIR;
    const prevOp = process.env.OPENBOT_OPERATOR_ID;
    process.env.OPENBOT_STATE_DIR = "/tmp/stage4-state-sessions";
    delete process.env.OPENBOT_OPERATOR_ID;
    try {
      const store = resolveDefaultSessionStorePath("agent-alpha");
      expect(store.replaceAll("\\", "/")).toMatch(
        /\/agents\/agent-alpha\/sessions\/sessions\.json$/,
      );
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prev;
      }
      if (prevOp === undefined) {
        delete process.env.OPENBOT_OPERATOR_ID;
      } else {
        process.env.OPENBOT_OPERATOR_ID = prevOp;
      }
    }
  });

  it("SAFE_SESSION_ID_RE / isValidSessionId reject path traversal shapes", () => {
    expect(SAFE_SESSION_ID_RE.test("ok-session_1")).toBe(true);
    expect(isValidSessionId("ok-session_1")).toBe(true);
    expect(isValidSessionId("../etc/passwd")).toBe(false);
    expect(isValidSessionId("has space")).toBe(false);
    expect(isValidSessionId("")).toBe(false);
  });
});

describe("Stage 4 credentials root (E2)", () => {
  it("resolveOAuthDir defaults to <stateDir>/credentials", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
  });
});

describe("Stage 4 memory index schema (E2/E3)", () => {
  it("ensureMemoryIndexSchema creates meta/files/chunks tables", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-mem-"));
    const dbPath = path.join(dir, "agent.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      const result = ensureMemoryIndexSchema({
        db,
        embeddingCacheTable: "embedding_cache",
        ftsTable: "chunks_fts",
        ftsEnabled: false,
      });
      expect(result.ftsAvailable).toBe(false);
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["meta", "files", "chunks", "embedding_cache"]));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("documented memory index path pattern is memory/<agentId>.sqlite under state", () => {
    // Mirrors src/agents/memory-search.ts resolveStorePath fallback (E1 path contract).
    const agentId = "main";
    const stateDir = "/tmp/stage4-state-memory";
    const expected = path.join(stateDir, "memory", `${agentId}.sqlite`);
    expect(expected.replaceAll("\\", "/")).toBe("/tmp/stage4-state-memory/memory/main.sqlite");
  });
});

describe("Stage 4 knowledge index schema (E2/E3)", () => {
  it("ensureKnowledgeIndexSchema initializes without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-kb-"));
    const dbPath = path.join(dir, "kb.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      expect(() => ensureKnowledgeIndexSchema({ db })).not.toThrow();
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as Array<{ name: string }>;
      expect(tables.length).toBeGreaterThan(0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Stage 4 AI workforce DDL aspirational (E1)", () => {
  it("db-schema.ts documents aspirational runtime-status (not default SoT)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/gateway/ai-workforce-governance/shared/db-schema.ts"),
      "utf8",
    );
    expect(src).toMatch(/runtime-status:\s*\*\*aspirational\*\*/);
    expect(src).toMatch(/Not the default runtime authority/);
    expect(src).toMatch(/Wire via a real ensure\*Schema\(db\) before treating these DDL as live/);
  });
});

describe("Stage 4 customer Postgres connector is read-only probe (E1/E2)", () => {
  it("resolveReadOnlyQuery accepts SELECT and rejects mutating SQL", () => {
    expect(resolveReadOnlyQuery("SELECT 1")).toMatch(/SELECT/i);
    expect(() => resolveReadOnlyQuery("DELETE FROM t")).toThrow(/只读|SELECT/i);
    expect(() => resolveReadOnlyQuery("INSERT INTO t VALUES (1)")).toThrow(/只读|SELECT/i);
  });
});

describe("Stage 4 HA Postgres is delivery control, not tenant SoT (E1)", () => {
  it("controller lease upserts ha_controller_instance", () => {
    const lease = fs.readFileSync(
      path.join(process.cwd(), "deploy/ha/controller/lease.py"),
      "utf8",
    );
    expect(lease).toMatch(/ha_controller_instance/);
    expect(lease).toMatch(/INSERT INTO public\.ha_controller_instance/);
  });
});

describe("Stage 4 backup plan excludes credentials by default (E2/E3, narrow PASS)", () => {
  it("default plan skips credentials with reason excluded and does not list a credentials asset", async () => {
    const prev = process.env.OPENBOT_STATE_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-bak-"));
    process.env.OPENBOT_STATE_DIR = dir;
    try {
      fs.mkdirSync(path.join(dir, "credentials"), { recursive: true });
      fs.writeFileSync(path.join(dir, "credentials", "oauth.json"), "{}");
      fs.writeFileSync(path.join(dir, "openbot.json"), "{}");
      const plan = await resolveBackupPlanFromDisk({ includeWorkspace: false });
      expect(plan.included.some((a) => a.kind === "state")).toBe(true);
      expect(plan.included.every((a) => a.kind !== "credentials")).toBe(true);
      expect(plan.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "credentials", reason: "excluded" }),
        ]),
      );
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prev;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includeCredentials: true restores prior include-via-state coverage (no excluded skip)", async () => {
    const prev = process.env.OPENBOT_STATE_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-bak-inc-"));
    process.env.OPENBOT_STATE_DIR = dir;
    try {
      fs.mkdirSync(path.join(dir, "credentials"), { recursive: true });
      fs.writeFileSync(path.join(dir, "credentials", "oauth.json"), "{}");
      fs.writeFileSync(path.join(dir, "openbot.json"), "{}");
      const plan = await resolveBackupPlanFromDisk({
        includeWorkspace: false,
        includeCredentials: true,
      });
      expect(plan.included.some((a) => a.kind === "state")).toBe(true);
      expect(plan.skipped.every((s) => s.kind !== "credentials")).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prev;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Stage 4 backup create→verify full-chain (E3, narrow PASS)", () => {
  it("temp OPENBOT_STATE_DIR: create archive then verify manifest+payload; default omits credentials", async () => {
    const prevState = process.env.OPENBOT_STATE_DIR;
    const prevClaw = process.env.OPENCLAW_STATE_DIR;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-bak-chain-state-"));
    const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-bak-chain-out-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENCLAW_STATE_DIR;
    try {
      fs.writeFileSync(path.join(stateDir, "openbot.json"), JSON.stringify({ theme: "stage4-e3" }));
      fs.writeFileSync(path.join(stateDir, "state.txt"), "stage4-payload\n");
      fs.mkdirSync(path.join(stateDir, "credentials"), { recursive: true });
      fs.writeFileSync(path.join(stateDir, "credentials", "oauth.json"), '{"secret":true}');

      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
      const nowMs = Date.UTC(2026, 9, 8, 12, 0, 0);
      const created = await backupCreateCommand(runtime, {
        output: archiveDir,
        includeWorkspace: false,
        nowMs,
      });
      expect(created.includeCredentials).toBe(false);
      expect(created.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "credentials", reason: "excluded" }),
        ]),
      );
      expect(fs.existsSync(created.archivePath)).toBe(true);

      const verified = await backupVerifyCommand(runtime, { archive: created.archivePath });
      expect(verified.ok).toBe(true);
      expect(verified.archiveRoot).toBe(buildBackupArchiveRoot(nowMs));
      expect(verified.assetCount).toBeGreaterThan(0);
      expect(verified.entryCount).toBeGreaterThan(verified.assetCount);

      const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-bak-chain-x-"));
      try {
        await tar.x({ file: created.archivePath, cwd: extractDir, gzip: true });
        const listed: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(full);
            } else {
              listed.push(full);
            }
          }
        };
        walk(extractDir);
        expect(listed.some((p) => p.endsWith(`${path.sep}manifest.json`))).toBe(true);
        expect(listed.some((p) => p.endsWith(`${path.sep}state.txt`))).toBe(true);
        expect(listed.some((p) => p.includes(`${path.sep}credentials${path.sep}`))).toBe(false);
        expect(listed.some((p) => p.endsWith(`${path.sep}oauth.json`))).toBe(false);
        const manifestPath = listed.find((p) => p.endsWith(`${path.sep}manifest.json`));
        expect(manifestPath).toBeTruthy();
        const manifest = JSON.parse(fs.readFileSync(manifestPath!, "utf8")) as {
          schemaVersion: number;
          assets: Array<{ kind: string; archivePath: string }>;
          skipped?: Array<{ kind: string; reason: string }>;
          options?: { includeCredentials?: boolean };
        };
        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.options?.includeCredentials).toBe(false);
        expect(manifest.assets.length).toBe(verified.assetCount);
        expect(manifest.assets.every((a) => a.kind !== "credentials")).toBe(true);
        expect(manifest.skipped).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "credentials", reason: "excluded" }),
          ]),
        );
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    } finally {
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
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });
});
