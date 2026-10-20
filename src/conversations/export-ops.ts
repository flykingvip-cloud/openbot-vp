/**
 * Conversation export (CL-P4-04) — scoped manifest + checksum, no dual-write of messages.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { authorizeConversationAction } from "./acl.js";
import { resolveConversationExportsRoot } from "./catalog/paths.js";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import type {
  ConversationRecord,
  ConversationSessionBinding,
  ConversationTenantContext,
} from "./types.js";

export type ConversationExportManifest = {
  schemaVersion: 1;
  exportId: string;
  dataPlaneId: string;
  conversationId: string;
  requestedBy: string;
  createdAt: string;
  expiresAt: string | null;
  objects: Array<{
    kind: "metadata" | "binding" | "transcript" | "projection";
    id: string;
    relativePath: string;
    checksum: string;
    bytes: number;
  }>;
  manifestDigest: string;
};

export type ConversationExportResult = {
  exportId: string;
  exportDir: string;
  manifest: ConversationExportManifest;
};

async function sha256File(filePath: string): Promise<{ checksum: string; bytes: number }> {
  const buf = await fs.readFile(filePath);
  return {
    checksum: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

function digestManifest(manifest: Omit<ConversationExportManifest, "manifestDigest">): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

/**
 * Export conversation metadata + optional live transcript copies into Data Root exports/.
 */
export async function exportConversation(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  ctx: ConversationTenantContext;
  conversationId: string;
  /** Absolute paths of transcripts already authorized for this conversation. */
  transcriptPaths?: Array<{ bindingId: string; sessionId: string; absPath: string }>;
  projectionJson?: string | null;
  expiresInDays?: number;
  /** Managed tenant plane root. */
  dataRoot?: string;
}): Promise<ConversationExportResult> {
  const record = await params.catalog.getConversation(
    params.ctx.dataPlaneId,
    params.conversationId,
  );
  if (!record) {
    throw new Error("conversation not found");
  }
  const auth = authorizeConversationAction({
    ctx: params.ctx,
    record,
    action: "export",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }

  const bindings = await params.catalog.listBindings(params.ctx.dataPlaneId, params.conversationId);
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  const exportsRoot = resolveConversationExportsRoot({ dataRoot });
  const exportId = `exp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const exportDir = path.join(exportsRoot, record.conversationId, exportId);
  await fs.mkdir(exportDir, { recursive: true });

  const objects: ConversationExportManifest["objects"] = [];
  const now = new Date().toISOString();

  // Metadata
  const metaPath = path.join(exportDir, "conversation.json");
  const metaPayload = `${JSON.stringify(record, null, 2)}\n`;
  await fs.writeFile(metaPath, metaPayload, "utf-8");
  objects.push({
    kind: "metadata",
    id: record.conversationId,
    relativePath: "conversation.json",
    checksum: createHash("sha256").update(metaPayload).digest("hex"),
    bytes: Buffer.byteLength(metaPayload),
  });

  const bindingsPath = path.join(exportDir, "bindings.json");
  const bindingsPayload = `${JSON.stringify(bindings, null, 2)}\n`;
  await fs.writeFile(bindingsPath, bindingsPayload, "utf-8");
  objects.push({
    kind: "binding",
    id: "bindings",
    relativePath: "bindings.json",
    checksum: createHash("sha256").update(bindingsPayload).digest("hex"),
    bytes: Buffer.byteLength(bindingsPayload),
  });

  for (const t of params.transcriptPaths ?? []) {
    try {
      await fs.access(t.absPath);
      const rel = path.posix.join("transcripts", `${t.sessionId}.jsonl`);
      const dest = path.join(exportDir, "transcripts", `${t.sessionId}.jsonl`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(t.absPath, dest);
      const hash = await sha256File(dest);
      objects.push({
        kind: "transcript",
        id: t.bindingId,
        relativePath: rel,
        checksum: hash.checksum,
        bytes: hash.bytes,
      });
    } catch {
      // skip missing transcripts
    }
  }

  if (params.projectionJson) {
    const rel = "projection.json";
    const dest = path.join(exportDir, rel);
    await fs.writeFile(dest, params.projectionJson, "utf-8");
    objects.push({
      kind: "projection",
      id: "projection",
      relativePath: rel,
      checksum: createHash("sha256").update(params.projectionJson).digest("hex"),
      bytes: Buffer.byteLength(params.projectionJson),
    });
  }

  const expiresAt =
    params.expiresInDays && params.expiresInDays > 0
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : null;

  const partial = {
    schemaVersion: 1 as const,
    exportId,
    dataPlaneId: params.ctx.dataPlaneId,
    conversationId: record.conversationId,
    requestedBy: params.ctx.principalId,
    createdAt: now,
    expiresAt,
    objects,
  };
  const manifest: ConversationExportManifest = {
    ...partial,
    manifestDigest: digestManifest(partial),
  };
  await fs.writeFile(
    path.join(exportDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );

  return { exportId, exportDir, manifest };
}

export type { ConversationRecord, ConversationSessionBinding };
