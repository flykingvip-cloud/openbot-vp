/**
 * Storage tier physical migration HOT/WARM → COLD (CL-P4-03).
 * Copy + checksum before Catalog tier flip; never delete sole live copy on failure.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveStorePath,
} from "../config/sessions/paths.js";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { createEtag } from "./ids.js";
import type {
  ConversationRecord,
  ConversationSessionBinding,
  ConversationStorageTier,
} from "./types.js";

export type ColdMigrateResult = {
  conversationId: string;
  migrated: boolean;
  coldPaths: string[];
  checksums: string[];
  error?: string;
};

export function resolveColdArchiveDir(dataRoot: string, conversationId: string): string {
  return path.join(dataRoot, "conversations", "cold", conversationId);
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function copyVerify(src: string, dest: string): Promise<{ checksum: string; bytes: number }> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  const a = await sha256File(src);
  const b = await sha256File(dest);
  if (a !== b) {
    await fs.unlink(dest).catch(() => undefined);
    throw new Error("cold migrate checksum mismatch");
  }
  const st = await fs.stat(dest);
  return { checksum: b, bytes: st.size };
}

/**
 * Migrate conversation transcripts to cold storage under Data Root.
 * On success, Catalog storageTier becomes COLD. Live copies are kept unless removeLive=true.
 */
export async function migrateConversationToCold(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  record: ConversationRecord;
  bindings: ConversationSessionBinding[];
  removeLive?: boolean;
  now?: string;
  /** Managed tenant live root override. */
  dataRoot?: string;
}): Promise<ColdMigrateResult> {
  if (params.record.retentionState === "LEGAL_HOLD") {
    return {
      conversationId: params.record.conversationId,
      migrated: false,
      coldPaths: [],
      checksums: [],
      error: "LEGAL_HOLD",
    };
  }
  if (params.record.lifecycleStatus === "DELETED") {
    return {
      conversationId: params.record.conversationId,
      migrated: false,
      coldPaths: [],
      checksums: [],
      error: "DELETED",
    };
  }
  if (params.record.storageTier === "COLD") {
    return {
      conversationId: params.record.conversationId,
      migrated: true,
      coldPaths: [],
      checksums: [],
    };
  }

  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  const coldDir = resolveColdArchiveDir(dataRoot, params.record.conversationId);
  const coldPaths: string[] = [];
  const checksums: string[] = [];

  try {
    for (const binding of params.bindings) {
      if (binding.transcriptState === "PURGED") {
        continue;
      }
      const agentId = binding.agentId ?? "main";
      const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
      const livePath = resolveSessionFilePath(
        binding.sessionId,
        undefined,
        resolveSessionFilePathOptions({ agentId, storePath }),
      );
      try {
        await fs.access(livePath);
      } catch {
        continue;
      }
      const dest = path.join(coldDir, `${binding.sessionId}.jsonl`);
      const { checksum } = await copyVerify(livePath, dest);
      coldPaths.push(dest);
      checksums.push(checksum);

      // Best-effort cold locator alias for known source identities on this binding.
      try {
        const coldRel = path.posix.join(
          "conversations",
          "cold",
          params.record.conversationId,
          `${binding.sessionId}.jsonl`,
        );
        await params.catalog.saveLocatorAlias(params.record.dataPlaneId, {
          sourceIdentityId: `cold-pending:${binding.bindingId}`,
          storageTier: "COLD",
          locator: dest,
          checksum,
          active: true,
          createdAt: new Date().toISOString(),
          retiredAt: null,
        });
        void coldRel;
      } catch {
        // identity may not exist yet
      }

      if (params.removeLive) {
        // Only remove live after cold verified — keep binding sessionId stable.
        await fs.unlink(livePath).catch(() => undefined);
      }

      const nextBinding: ConversationSessionBinding = {
        ...binding,
        transcriptState: params.removeLive ? "ARCHIVED" : binding.transcriptState,
      };
      await params.catalog.saveBinding(nextBinding);
    }

    if (coldPaths.length === 0) {
      // No files — still allow tier flip for idle empty conversations.
    }

    const now = params.now ?? new Date().toISOString();
    const next: ConversationRecord = {
      ...params.record,
      storageTier: "COLD" as ConversationStorageTier,
      updatedAt: now,
      etag: createEtag(),
    };
    await params.catalog.updateConversation(next, params.record.etag);

    return {
      conversationId: params.record.conversationId,
      migrated: true,
      coldPaths,
      checksums,
    };
  } catch (err) {
    return {
      conversationId: params.record.conversationId,
      migrated: false,
      coldPaths,
      checksums,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run cold migration for all conversations that evaluate to COLD tier.
 */
export async function runColdMigrationBatch(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  dataPlaneId: string;
  tenantId?: string | null;
  limit?: number;
  removeLive?: boolean;
  dataRoot?: string;
}): Promise<{ attempted: number; migrated: number; failed: number; results: ColdMigrateResult[] }> {
  const page = await params.catalog.listConversations({
    dataPlaneId: params.dataPlaneId,
    tenantId: params.tenantId,
    lifecycleStatus: ["ACTIVE", "CLOSED", "ARCHIVED"],
    limit: params.limit ?? 50,
  });
  const results: ColdMigrateResult[] = [];
  let migrated = 0;
  let failed = 0;
  for (const record of page.rows) {
    if (record.storageTier === "COLD") {
      continue;
    }
    // Only migrate when already marked WARM/COLD candidate by retention scan (storageTier WARM)
    // or idle — caller may pre-filter. Here we migrate WARM → COLD.
    if (record.storageTier !== "WARM" && record.storageTier !== "HOT") {
      continue;
    }
    // Prefer explicit WARM for physical cold move; HOT only when retention already suggested cold.
    if (record.storageTier === "HOT" && record.retentionState !== "EXPIRING") {
      continue;
    }
    const bindings = await params.catalog.listBindings(record.dataPlaneId, record.conversationId);
    const result = await migrateConversationToCold({
      catalog: params.catalog,
      cfg: params.cfg,
      record,
      bindings,
      removeLive: params.removeLive === true,
      dataRoot: params.dataRoot,
    });
    results.push(result);
    if (result.migrated) {
      migrated += 1;
    } else if (result.error && result.error !== "LEGAL_HOLD") {
      failed += 1;
    }
  }
  return { attempted: results.length, migrated, failed, results };
}
