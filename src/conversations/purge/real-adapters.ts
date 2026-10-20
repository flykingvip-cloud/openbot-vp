/**
 * Real purge step adapters (CL-P4-04): freeze, memory revoke, derived delete,
 * content delete, verify. Fail closed on MEMORY_REVOKE and VERIFY.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveDataRoot } from "../../config/data-space.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveStorePath,
} from "../../config/sessions/paths.js";
import { resolveConversationArchiveRoot } from "../catalog/paths.js";
import type { ConversationCatalogRepository } from "../catalog/repository.js";
import { getConversationSearchIndex } from "../search-index.js";
import type { ConversationRecord, ConversationSessionBinding } from "../types.js";
import type { PurgeStepAdapter } from "./fsm.js";

export type RealPurgeAdapterContext = {
  cfg: OpenBotConfig;
  catalog: ConversationCatalogRepository;
  bindings: ConversationSessionBinding[];
  /** Absolute transcript paths collected at manifest time. */
  transcriptAbsPaths: Array<{ bindingId: string; sessionId: string; absPath: string }>;
  /** Explicit plane data root (managed tenant). */
  dataRoot?: string;
};

function resolveTranscriptPaths(
  cfg: OpenBotConfig,
  bindings: ConversationSessionBinding[],
): Array<{ bindingId: string; sessionId: string; absPath: string }> {
  const out: Array<{ bindingId: string; sessionId: string; absPath: string }> = [];
  for (const b of bindings) {
    const agentId = b.agentId ?? "main";
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const absPath = resolveSessionFilePath(
      b.sessionId,
      undefined,
      resolveSessionFilePathOptions({ agentId, storePath }),
    );
    out.push({ bindingId: b.bindingId, sessionId: b.sessionId, absPath });
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function planeDataRoot(ctx: RealPurgeAdapterContext): string {
  return ctx.dataRoot ?? resolveDataRoot(ctx.cfg);
}

/**
 * Build purge adapters that perform real deletes.
 * MEMORY_REVOKE failures abort the job (do not continue to physical delete).
 */
export function createRealPurgeAdapters(ctx: RealPurgeAdapterContext): PurgeStepAdapter[] {
  const transcriptPaths =
    ctx.transcriptAbsPaths.length > 0
      ? ctx.transcriptAbsPaths
      : resolveTranscriptPaths(ctx.cfg, ctx.bindings);

  return [
    {
      name: "FREEZE",
      run: async ({ record }) => {
        for (const b of ctx.bindings) {
          if (b.transcriptState === "PURGED") {
            continue;
          }
          await ctx.catalog.saveBinding({
            ...b,
            transcriptState: "READ_ONLY",
          });
        }
        void record;
      },
    },
    {
      name: "MEMORY_REVOKE",
      run: async ({ record, manifest }) => {
        const errors: string[] = [];
        const { resolveStateDir } = await import("../../config/paths.js");
        const stateDir = resolveStateDir();
        const { getMemorySearchManager } = await import("../../memory/search-manager.js");

        // Prefer immutable cogniweave_source entries from the sealed manifest snapshot.
        const cwSources = manifest.objects.filter((o) => o.kind === "cogniweave_source");
        const targets =
          cwSources.length > 0
            ? cwSources.map((o) => {
                const isPathOnly = o.id.startsWith("src:");
                const identityFromId =
                  !isPathOnly && o.id.trim() ? o.id.replace(/^msrc:\/\//, "").trim() : undefined;
                const identityFromLocator = o.locator?.startsWith("msrc://")
                  ? o.locator.slice("msrc://".length).trim()
                  : undefined;
                return {
                  bindingId: o.id,
                  sessionId: isPathOnly ? o.id.replace(/^src:/, "") : o.id,
                  absPath: o.locator ?? "",
                  sourceIdentityId: identityFromId || identityFromLocator,
                  sourceLocator: o.locator,
                };
              })
            : transcriptPaths.map((t) => ({
                ...t,
                sourceIdentityId: undefined as string | undefined,
                sourceLocator: undefined as string | undefined,
              }));

        for (const t of targets) {
          const agentId =
            ctx.bindings.find((b) => b.bindingId === t.bindingId || b.sessionId === t.sessionId)
              ?.agentId ??
            ctx.bindings[0]?.agentId ??
            "main";
          const { manager } = await getMemorySearchManager({
            cfg: ctx.cfg,
            agentId,
            tenantId: record.tenantId,
            dataPlaneId: record.dataPlaneId ?? manifest.dataPlaneId,
            dataRoot: planeDataRoot(ctx),
          });
          const apply = (
            manager as unknown as {
              applyTranscriptSourceLifecycle?: (i: {
                mode: "archive" | "restore" | "purge" | "forget";
                sourceLocator?: string;
                sourceIdentityId?: string;
                operationId: string;
                reasonCode?: string;
              }) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
            }
          ).applyTranscriptSourceLifecycle;
          if (!manager || typeof apply !== "function") {
            // Fail-closed when CogniWeave is configured OR target is sealed/msrc.
            // Path-only skip is allowed only when memory backend is not cogniweave
            // (no engine exists to hold legacy sources).
            let cogniweaveBackend = false;
            try {
              const { resolveMemoryBackendConfig } = await import("../../memory/backend-config.js");
              cogniweaveBackend =
                resolveMemoryBackendConfig({ cfg: ctx.cfg, agentId }).backend === "cogniweave";
            } catch {
              cogniweaveBackend = false;
            }
            const sealedOrMsrc =
              Boolean(t.sourceIdentityId) ||
              (t.sourceLocator?.startsWith("msrc://") ?? false) ||
              (typeof t.absPath === "string" && t.absPath.startsWith("msrc://"));
            if (cogniweaveBackend || sealedOrMsrc) {
              errors.push(`manager_missing:${t.sessionId}`);
            }
            continue;
          }

          // Prefer stable identity; else path locator (relative to state dir when needed).
          const identityId = t.sourceIdentityId?.trim() || undefined;
          let locator = identityId ? undefined : t.sourceLocator || t.absPath;
          if (locator && locator.startsWith(stateDir)) {
            locator = locator
              .slice(stateDir.length)
              .replace(/^[/\\]+/, "")
              .split(path.sep)
              .join("/");
          }

          const result = await apply.call(manager, {
            mode: "purge",
            sourceIdentityId: identityId,
            sourceLocator: identityId ? undefined : locator,
            operationId: `purge-revoke-${manifest.conversationId}-${t.sessionId}`,
            reasonCode: "CONVERSATION_PURGE",
          });
          // Fail closed: any non-ok result aborts (including identity not found).
          // Path-only soft-skip (never sealed) is allowed via result.skipped && result.ok.
          if (!result.ok) {
            errors.push(`${t.sessionId}:${result.error ?? "purge_failed"}`);
          }
        }

        if (errors.length > 0) {
          throw new Error(`MEMORY_REVOKE_FAILED:${errors.join(";")}`);
        }
      },
    },
    {
      name: "DERIVED_DELETE",
      run: async ({ record }) => {
        const dataRoot = planeDataRoot(ctx);
        const errors: string[] = [];

        try {
          const index = getConversationSearchIndex({
            cfg: ctx.cfg,
            dataRoot,
          });
          index.deleteConversation(record.dataPlaneId, record.conversationId);
          const residual = index.countConversation(record.dataPlaneId, record.conversationId);
          if (residual > 0) {
            errors.push(`index_residual:${residual}`);
          }
        } catch (err) {
          errors.push(`index_delete:${err instanceof Error ? err.message.slice(0, 48) : "failed"}`);
        }

        try {
          const { getFileProjectionStore } = await import("../projection-store.js");
          const store = getFileProjectionStore({ cfg: ctx.cfg, dataRoot });
          await store.delete(record.conversationId);
          const still = await store.get(record.conversationId);
          if (still) {
            errors.push("projection_residual");
          }
        } catch (err) {
          errors.push(
            `projection_delete:${err instanceof Error ? err.message.slice(0, 48) : "failed"}`,
          );
        }

        if (record.groupId) {
          try {
            const fp = path.join(
              dataRoot,
              ".meta",
              "conversations",
              "shared-task",
              record.groupId.replace(/[^a-zA-Z0-9._-]/g, "_"),
              `${record.conversationId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`,
            );
            await fs.unlink(fp).catch((err: NodeJS.ErrnoException) => {
              if (err?.code !== "ENOENT") {
                throw err;
              }
            });
          } catch (err) {
            errors.push(
              `shared_task_delete:${err instanceof Error ? err.message.slice(0, 48) : "failed"}`,
            );
          }
        }

        if (errors.length > 0) {
          throw new Error(`DERIVED_DELETE_FAILED:${errors.join(";")}`);
        }
      },
    },
    {
      name: "CONTENT_DELETE",
      run: async ({ record, manifest }) => {
        const dataRoot = planeDataRoot(ctx);
        const archiveRoot = resolveConversationArchiveRoot({ dataRoot });
        for (const t of transcriptPaths) {
          await fs.unlink(t.absPath).catch(() => undefined);
          const archived = path.join(archiveRoot, record.conversationId, `${t.sessionId}.jsonl`);
          await fs.unlink(archived).catch(() => undefined);
          const cold = path.join(
            dataRoot,
            "conversations",
            "cold",
            record.conversationId,
            `${t.sessionId}.jsonl`,
          );
          await fs.unlink(cold).catch(() => undefined);
        }
        // Delete every file locator + attachment dir captured in immutable manifest.
        for (const obj of manifest.objects) {
          if (obj.kind === "locator" && obj.locator) {
            await fs.unlink(obj.locator).catch(() => undefined);
          }
          if (obj.kind === "attachment" && obj.locator) {
            await fs.rm(obj.locator, { recursive: true, force: true }).catch(() => undefined);
          }
        }
        for (const b of ctx.bindings) {
          await ctx.catalog.saveBinding({
            ...b,
            transcriptState: "PURGED",
            endedAt: b.endedAt ?? new Date().toISOString(),
          });
        }
      },
    },
    {
      name: "VERIFY",
      run: async ({ record, manifest }) => {
        const failures: string[] = [];
        for (const t of transcriptPaths) {
          if (await pathExists(t.absPath)) {
            failures.push(`live:${t.sessionId}`);
          }
        }
        for (const obj of manifest.objects) {
          if ((obj.kind === "locator" || obj.kind === "attachment") && obj.locator) {
            // Files must be gone; directories must be empty or absent.
            try {
              const st = await fs.stat(obj.locator);
              if (st.isDirectory()) {
                const entries = await fs.readdir(obj.locator).catch(() => ["_"]);
                if (entries.length > 0) {
                  failures.push(`dir_not_empty:${obj.id}`);
                }
              } else if (st.isFile()) {
                failures.push(`locator:${obj.id}`);
              }
            } catch {
              // absent — ok
            }
          }
        }
        // CogniWeave source rows must not remain active after purge (status purged|forgotten).
        for (const obj of manifest.objects.filter((o) => o.kind === "cogniweave_source")) {
          try {
            const isPathOnly = obj.id.startsWith("src:");
            const identityId = !isPathOnly
              ? obj.id.replace(/^msrc:\/\//, "").trim() ||
                (obj.locator?.startsWith("msrc://")
                  ? obj.locator.slice("msrc://".length).trim()
                  : undefined)
              : undefined;
            if (!identityId && !obj.locator) {
              continue;
            }
            const agentId = ctx.bindings[0]?.agentId ?? "main";
            const { getMemorySearchManager } = await import("../../memory/search-manager.js");
            const { manager } = await getMemorySearchManager({
              cfg: ctx.cfg,
              agentId,
              tenantId: record.tenantId,
              dataPlaneId: record.dataPlaneId ?? manifest.dataPlaneId,
              dataRoot: planeDataRoot(ctx),
            });
            const apply = (
              manager as unknown as {
                applyTranscriptSourceLifecycle?: (i: {
                  mode: "purge";
                  sourceLocator?: string;
                  sourceIdentityId?: string;
                  operationId: string;
                  reasonCode?: string;
                }) => Promise<{ ok: boolean; skipped?: boolean; status?: string; error?: string }>;
              }
            ).applyTranscriptSourceLifecycle;
            if (!manager || typeof apply !== "function") {
              // Sealed identities require engine; path-only content already checked above.
              if (identityId) {
                failures.push(`cogniweave_manager_missing:${obj.id}`);
              }
              continue;
            }
            // Idempotent purge: expect status purged, or not-found after hard delete.
            const result = await apply.call(manager, {
              mode: "purge",
              sourceIdentityId: identityId,
              sourceLocator: identityId ? undefined : obj.locator,
              operationId: `purge-verify-${manifest.conversationId}-${obj.id}`,
              reasonCode: "CONVERSATION_PURGE_VERIFY",
            });
            if (!result.ok) {
              // After MEMORY_REVOKE, identity not found means objects already hard-deleted — ok.
              if (identityId && result.error && /source binding not found/i.test(result.error)) {
                continue;
              }
              // Path-only soft-skip (never sealed) is ok when result.skipped.
              if (result.skipped && !identityId) {
                continue;
              }
              failures.push(`cogniweave:${obj.id}:${result.error ?? "failed"}`);
            } else if (
              identityId &&
              result.status &&
              result.status !== "purged" &&
              result.status !== "forgotten"
            ) {
              // Sealed identities must be purged/forgotten. Path-only `src:` rows
              // may get an idempotent re-purge status from a live manager.
              failures.push(`cogniweave_status:${obj.id}:${result.status}`);
            }
          } catch {
            failures.push(`cogniweave_check:${obj.id}`);
          }
        }
        // Confirm search index empty (do not only re-delete and swallow).
        try {
          const index = getConversationSearchIndex({
            cfg: ctx.cfg,
            dataRoot: planeDataRoot(ctx),
          });
          // Best-effort re-delete then assert residual count is zero.
          try {
            index.deleteConversation(record.dataPlaneId, record.conversationId);
          } catch (err) {
            failures.push(
              `index_delete:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`,
            );
          }
          const residual = index.countConversation(record.dataPlaneId, record.conversationId);
          if (residual > 0) {
            failures.push(`index_residual:${residual}`);
          }
        } catch (err) {
          failures.push(
            `index_verify:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`,
          );
        }

        // Confirm projection gone.
        try {
          const { getFileProjectionStore } = await import("../projection-store.js");
          const store = getFileProjectionStore({
            cfg: ctx.cfg,
            dataRoot: planeDataRoot(ctx),
          });
          const proj = await store.get(record.conversationId);
          if (proj) {
            failures.push("projection_residual");
          }
        } catch (err) {
          failures.push(
            `projection_verify:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`,
          );
        }

        if (failures.length > 0) {
          throw new Error(`VERIFY_FAILED:${failures.join(",")}`);
        }
      },
    },
  ];
}

export async function collectPurgeManifestObjects(params: {
  cfg: OpenBotConfig;
  catalog: ConversationCatalogRepository;
  record: ConversationRecord;
  bindings: ConversationSessionBinding[];
  dataRoot?: string;
}): Promise<import("./fsm.js").PurgeManifestObject[]> {
  const objects: import("./fsm.js").PurgeManifestObject[] = [];
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  const archiveRoot = resolveConversationArchiveRoot({ dataRoot });
  const coldRoot = path.join(dataRoot, "conversations", "cold", params.record.conversationId);

  const { resolveSessionSourceIndexDir, loadSessionSourceIndex } =
    await import("../../memory/session-source-index.js");
  const indexDir = resolveSessionSourceIndexDir(dataRoot);

  // Per-binding collection: sealed ranges do NOT suppress other bindings' path sources.
  for (const b of params.bindings) {
    objects.push({
      kind: "binding",
      id: b.bindingId,
      locator: b.sessionKey,
    });

    const agentId = b.agentId ?? "main";
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
    const absPath = resolveSessionFilePath(
      b.sessionId,
      undefined,
      resolveSessionFilePathOptions({ agentId, storePath }),
    );

    let bindingHasSealed = false;
    try {
      const index = await loadSessionSourceIndex({ indexDir, sessionFile: absPath });
      for (const r of index?.ranges ?? []) {
        bindingHasSealed = true;
        objects.push({
          kind: "source_identity",
          id: r.sourceIdentityId,
        });
        objects.push({
          kind: "cogniweave_source",
          id: r.sourceIdentityId,
          locator: `msrc://${r.sourceIdentityId}`,
          checksum: r.contentChecksum,
        });
      }
    } catch {
      // index optional per binding
    }

    let checksum: string | undefined;
    try {
      const { createHash } = await import("node:crypto");
      const buf = await fs.readFile(absPath);
      checksum = createHash("sha256").update(buf).digest("hex");
    } catch {
      checksum = undefined;
    }
    objects.push({
      kind: "locator",
      id: `live:${b.sessionId}`,
      locator: absPath,
      checksum,
    });

    const archivePath = path.join(
      archiveRoot,
      params.record.conversationId,
      `${b.sessionId}.jsonl`,
    );
    objects.push({
      kind: "locator",
      id: `archive:${b.sessionId}`,
      locator: archivePath,
    });
    const coldPath = path.join(coldRoot, `${b.sessionId}.jsonl`);
    objects.push({
      kind: "locator",
      id: `cold:${b.sessionId}`,
      locator: coldPath,
    });

    // Path-based cogniweave source only when THIS binding has no sealed ranges.
    if (!bindingHasSealed) {
      objects.push({
        kind: "cogniweave_source",
        id: `src:${b.sessionId}`,
        locator: absPath,
      });
    }
  }

  // Attachments / derived (best-effort known roots under plane).
  const attachmentDir = path.join(
    dataRoot,
    "conversations",
    "attachments",
    params.record.conversationId,
  );
  objects.push({
    kind: "attachment",
    id: `attachments:${params.record.conversationId}`,
    locator: attachmentDir,
  });
  objects.push({
    kind: "index",
    id: `search:${params.record.conversationId}`,
  });
  objects.push({
    kind: "projection",
    id: `proj:${params.record.conversationId}`,
  });
  return objects;
}
