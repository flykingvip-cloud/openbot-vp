/**
 * Conversation archive/restore/purge → CogniWeave source lifecycle bridge.
 * Prefer sealed sourceIdentityId (msrc dual form). Fail-closed when requested.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("conversations/cogniweave");

function toOpenbotPathLocator(liveTranscriptPath: string, stateDir?: string): string {
  const abs = path.resolve(liveTranscriptPath);
  const root = path.resolve(stateDir ?? resolveStateDir());
  if (abs.startsWith(root + path.sep) || abs === root) {
    return path.relative(root, abs).split(path.sep).join("/");
  }
  return abs.split(path.sep).join("/");
}

export async function notifyCogniWeaveConversationLifecycle(params: {
  cfg: OpenBotConfig;
  agentId: string;
  mode: "archive" | "restore" | "purge" | "forget";
  liveTranscriptPath: string;
  conversationId: string;
  operationId?: string;
  /** Prefer stable identities when known. */
  sourceIdentityIds?: string[];
  tenantId?: string | null;
  dataPlaneId?: string | null;
  dataRoot?: string | null;
  /**
   * Trusted ownership proof from authenticated call entry (required for managed tenants).
   */
  ownershipProof?: import("../gateway/data-governance/write-gate.js").GovernanceOwnershipProof;
  /**
   * When true, throw if manager missing or any lifecycle call fails.
   * Default false for archive/restore product path (catalog already committed).
   */
  failClosed?: boolean;
}): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const failClosed = params.failClosed === true;
  try {
    const { getMemorySearchManager } = await import("../memory/search-manager.js");
    const governance = params.ownershipProof
      ? {
          tenantId: params.tenantId ?? null,
          ownershipProof: params.ownershipProof,
        }
      : undefined;
    const { manager } = await getMemorySearchManager({
      cfg: params.cfg,
      agentId: params.agentId,
      governance,
    });
    const lifecycle = manager as unknown as {
      applyTranscriptSourceLifecycle?: (input: {
        mode: "archive" | "restore" | "purge" | "forget";
        sourceLocator?: string;
        sourceIdentityId?: string;
        operationId: string;
        reasonCode?: string;
      }) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
    };
    if (!manager || typeof lifecycle.applyTranscriptSourceLifecycle !== "function") {
      const msg = "cogniweave manager or lifecycle API unavailable";
      if (failClosed) {
        throw new Error(msg);
      }
      log.warn(
        `cogniweave ${params.mode} bridge skipped conversation=${params.conversationId}: ${msg}`,
      );
      return { ok: false, errors: [msg] };
    }

    const reasonByMode: Record<string, string> = {
      archive: "CONVERSATION_ARCHIVE",
      restore: "CONVERSATION_RESTORE",
      purge: "CONVERSATION_PURGE",
      forget: "CONVERSATION_FORGET",
    };
    const reasonCode = reasonByMode[params.mode] ?? "CONVERSATION_LIFECYCLE";
    const opBase =
      params.operationId ??
      `conv-${params.mode}-${params.conversationId}-${randomUUID().slice(0, 8)}`;

    const identityIds = [...new Set(params.sourceIdentityIds ?? [])]
      .map((id) => id.replace(/^msrc:\/\//, "").trim())
      .filter(Boolean);
    if (identityIds.length > 0) {
      for (const sourceIdentityId of identityIds) {
        const result = await lifecycle.applyTranscriptSourceLifecycle({
          mode: params.mode,
          sourceIdentityId,
          operationId: `${opBase}-${sourceIdentityId.slice(0, 12)}`,
          reasonCode,
        });
        // Fail-closed when failClosed; otherwise collect errors (do not treat as success).
        if (!result.ok) {
          errors.push(result.error ?? sourceIdentityId);
        }
      }
    } else {
      // Dual lookup: path locator + msrc forms resolved inside engine.
      const locator = toOpenbotPathLocator(params.liveTranscriptPath, params.dataRoot ?? undefined);
      const result = await lifecycle.applyTranscriptSourceLifecycle({
        mode: params.mode,
        sourceLocator: locator,
        operationId: opBase,
        reasonCode,
      });
      if (!result.ok) {
        errors.push(result.error ?? locator);
      }
    }

    if (errors.length > 0) {
      const msg = errors.join("; ");
      log.warn(
        `cogniweave ${params.mode} source failed conversation=${params.conversationId}: ${msg}`,
      );
      if (failClosed) {
        throw new Error(msg);
      }
      return { ok: false, errors };
    }
    return { ok: true, errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      `cogniweave ${params.mode} bridge failed conversation=${params.conversationId}: ${msg}`,
    );
    if (failClosed) {
      throw err instanceof Error ? err : new Error(msg);
    }
    return { ok: false, errors: [msg] };
  }
}
