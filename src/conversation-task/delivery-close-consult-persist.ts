/**
 * Narrow file/JSON persistence for delivery-close consult records (and the
 * same-shape validation receipt snapshots nested in `holds`).
 *
 * In-domain only — next to conversation-task. Default-off ENV. Does not create
 * a cross-domain writer, defer close/cancel, or change `closeDeferred`.
 *
 * Start-order: `phase_c_83_cross_process_consult_persist_start_order`.
 * Claim ceiling: code-present.
 */

import fs from "node:fs";
import path from "node:path";
import type { DeliveryCloseConsult } from "../agents/execution-preflight/completion-hold.js";
import { defaultShadowStoreRoot } from "./runtime-bootstrap.js";

/**
 * Default off. When truthy, the delivery-close consult ring is also written to
 * a JSON file under the conversation-task store root so records survive process
 * restart. Does not enable consult observe itself (that remains FC-02 ENV).
 */
export const CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV =
  "OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST";

const PERSIST_FILE_NAME = "delivery-close-consults.json";
const PERSIST_VERSION = 1 as const;

/** Observe-only handshake record. `closeDeferred` stays false in this slice. */
export type ConversationTaskDeliveryCloseConsultRecord = {
  conversationTaskId: string;
  sessionKey: string;
  mode: "observe";
  closeDeferred: false;
  hasDeliveryContext: boolean;
  sessionHoldAmbiguous: boolean;
  completionClaimBlocked: boolean;
  deliveryBlocksCompletionClaims: boolean;
  holds: DeliveryCloseConsult["holds"];
};

type PersistFileShape = {
  version: typeof PERSIST_VERSION;
  records: ConversationTaskDeliveryCloseConsultRecord[];
};

/** Test-only path override; when set, wins over the store-root default. */
let persistPathOverrideForTest: string | undefined;

export function isConversationTaskDeliveryCloseConsultPersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function resolveDeliveryCloseConsultPersistPath(): string {
  if (persistPathOverrideForTest) {
    return persistPathOverrideForTest;
  }
  return path.join(defaultShadowStoreRoot(), PERSIST_FILE_NAME);
}

export function setDeliveryCloseConsultPersistPathForTest(filePath: string | undefined): void {
  persistPathOverrideForTest = filePath;
}

/**
 * Load consult records from disk. Returns [] when missing/unreadable/invalid.
 * Never throws. Drops rows that violate observe-only / closeDeferred:false.
 */
export function loadDeliveryCloseConsultsFromDisk(
  filePath: string = resolveDeliveryCloseConsultPersistPath(),
): ConversationTaskDeliveryCloseConsultRecord[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }
    const body = parsed as Partial<PersistFileShape>;
    if (body.version !== PERSIST_VERSION || !Array.isArray(body.records)) {
      return [];
    }
    const out: ConversationTaskDeliveryCloseConsultRecord[] = [];
    for (const row of body.records) {
      const normalized = normalizePersistRecord(row);
      if (normalized) {
        out.push(normalized);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Write the ring to disk. Swallows errors (observe path must not fail
 * close/cancel). Creates parent dirs as needed.
 */
export function saveDeliveryCloseConsultsToDisk(
  records: readonly ConversationTaskDeliveryCloseConsultRecord[],
  filePath: string = resolveDeliveryCloseConsultPersistPath(),
): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload: PersistFileShape = {
      version: PERSIST_VERSION,
      records: records.map((row) => ({
        ...row,
        mode: "observe" as const,
        closeDeferred: false as const,
        holds: row.holds.map((hold) => ({ ...hold })),
      })),
    };
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, filePath);
  } catch {
    // Persist failure must not affect close/cancel.
  }
}

export function clearDeliveryCloseConsultPersistFileForTest(
  filePath: string = resolveDeliveryCloseConsultPersistPath(),
): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const tmp = `${filePath}.tmp`;
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  } catch {
    // test cleanup best-effort
  }
}

function normalizePersistRecord(row: unknown): ConversationTaskDeliveryCloseConsultRecord | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, unknown>;
  if (typeof r.conversationTaskId !== "string" || typeof r.sessionKey !== "string") {
    return null;
  }
  // Observe-only / closeDeferred always false — reject anything else.
  if (r.mode !== "observe") {
    return null;
  }
  if (r.closeDeferred === true) {
    return null;
  }
  const holds = Array.isArray(r.holds)
    ? r.holds.map((hold) => (hold && typeof hold === "object" ? { ...(hold as object) } : hold))
    : [];
  return {
    conversationTaskId: r.conversationTaskId,
    sessionKey: r.sessionKey,
    mode: "observe",
    closeDeferred: false,
    hasDeliveryContext: Boolean(r.hasDeliveryContext),
    sessionHoldAmbiguous: Boolean(r.sessionHoldAmbiguous),
    completionClaimBlocked: Boolean(r.completionClaimBlocked),
    deliveryBlocksCompletionClaims: Boolean(r.deliveryBlocksCompletionClaims),
    holds: holds as ConversationTaskDeliveryCloseConsultRecord["holds"],
  };
}
