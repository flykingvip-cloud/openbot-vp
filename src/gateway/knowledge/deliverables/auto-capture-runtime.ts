import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import {
  type DeliverableArtifactRef,
  saveSkillAsset,
  updateCapturedDeliverable,
} from "../../skill-lifecycle-store.js";

/**
 * Deliverable auto-capture: high-value chat / agent / automation outputs become
 * previewable skill-asset records. Capture never attaches them to a knowledge
 * base. Users must preview the file in chat and click 保存; only then does
 * saveAndArchive land the file in 个人成果 or 团队成果.
 *
 * The capture is idempotent via a small ledger keyed by session+message (or content
 * hash), so re-delivering the same output does not create duplicate deliverables.
 */

const DEFAULT_CAPTURE_LEDGER_FILE = path.join(CONFIG_DIR, "knowledge", "deliverable-captures.json");

/** Outputs shorter than this are treated as low-value chatter and skipped unless forced. */
const MIN_CAPTURE_CONTENT_LENGTH = 80;
const CAPTURE_SUMMARY_MAX_LENGTH = 280;
const CAPTURE_TITLE_FALLBACK_LENGTH = 40;

function slugifyLogicalIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type DeliverableCaptureReason = "captured" | "updated" | "duplicate" | "too-short" | "empty";

export type DeliverableCaptureResult = {
  captured: boolean;
  reason: DeliverableCaptureReason;
  skillId?: string;
  deliverableId?: string;
};

type CaptureLedgerEntry = { skillId: string; capturedAtMs: number };

type CaptureLedger = {
  /** Per-message idempotency: same session+message (or content hash) never re-processes. */
  captures: Record<string, CaptureLedgerEntry>;
  /**
   * Logical-deliverable identity -> skillId. Lets revisions of the same logical deliverable
   * (same file / url / title within an agent+lineage scope) collapse into one 成果 entry that is
   * updated in place to the latest version, instead of one row per revision.
   */
  identities: Record<string, CaptureLedgerEntry>;
};

function readCaptureLedger(storePath: string): CaptureLedger {
  try {
    if (!fs.existsSync(storePath)) {
      return { captures: {}, identities: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const captures =
      typeof record.captures === "object" &&
      record.captures !== null &&
      !Array.isArray(record.captures)
        ? (record.captures as Record<string, { skillId?: string; capturedAtMs?: number }>)
        : {};
    const identities =
      typeof record.identities === "object" &&
      record.identities !== null &&
      !Array.isArray(record.identities)
        ? (record.identities as Record<string, { skillId?: string; capturedAtMs?: number }>)
        : {};
    const normalizeMap = (
      source: Record<string, { skillId?: string; capturedAtMs?: number }>,
    ): Record<string, CaptureLedgerEntry> => {
      const out: Record<string, CaptureLedgerEntry> = {};
      for (const [key, entry] of Object.entries(source)) {
        const skillId = entry?.skillId?.trim();
        if (!key.trim() || !skillId) {
          continue;
        }
        out[key] = {
          skillId,
          capturedAtMs:
            typeof entry.capturedAtMs === "number" && Number.isFinite(entry.capturedAtMs)
              ? entry.capturedAtMs
              : Date.now(),
        };
      }
      return out;
    };
    return { captures: normalizeMap(captures), identities: normalizeMap(identities) };
  } catch {
    return { captures: {}, identities: {} };
  }
}

function writeCaptureLedger(ledger: CaptureLedger, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function captureDedupKey(params: {
  agentId: string;
  content: string;
  sessionKey?: string | null;
  messageId?: string | null;
}): string {
  const sessionKey = params.sessionKey?.trim();
  const messageId = params.messageId?.trim();
  if (sessionKey && messageId) {
    return `msg::${sessionKey}::${messageId}`;
  }
  const digest = createHash("sha256")
    .update(`${params.agentId.trim()}::${params.content.trim()}`)
    .digest("hex")
    .slice(0, 24);
  return `hash::${digest}`;
}

/**
 * Stable identity for a LOGICAL deliverable so its revisions collapse into one 成果 entry.
 * Scoped by agent + lineage (the sourceLineageId used at capture) so it never merges across
 * owners: for the employee steward the lineage embeds the owner id. Identity is:
 *   file -> filename, published -> url, otherwise -> normalized title.
 * Returns null when there is no stable key (then per-message dedup still applies).
 */
function captureIdentityKey(params: {
  agentId: string;
  groupId?: string | null;
  ownerId?: string | null;
  lineage: string;
  title: string;
  logicalId?: string | null;
  deliverableArtifact?: DeliverableArtifactRef;
}): string | null {
  const groupId = params.groupId?.trim();
  const ownerId = params.ownerId?.trim();
  const scope = groupId
    ? `group:${groupId}`
    : ownerId
      ? `owner:${ownerId}`
      : `${params.agentId.trim()}::${params.lineage.trim()}`;
  const logicalId = params.logicalId?.trim();
  if (logicalId) {
    return `id::${scope}::logical:${slugifyLogicalIdentity(logicalId)}`;
  }
  const artifact = params.deliverableArtifact;
  if (artifact?.previewKind === "file" && artifact.filename?.trim()) {
    return `id::${scope}::file:${artifact.filename.trim().toLowerCase()}`;
  }
  if (artifact?.previewKind === "published" && artifact.url?.trim()) {
    return `id::${scope}::url:${artifact.url.trim().toLowerCase()}`;
  }
  const normalizedTitle = params.title.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalizedTitle) {
    return `id::${scope}::title:${normalizedTitle}`;
  }
  return null;
}

export function captureAgentOutputDeliverable(params: {
  agentId: string;
  title: string;
  content: string;
  ownerId?: string | null;
  groupId?: string | null;
  logicalId?: string | null;
  sessionKey?: string | null;
  messageId?: string | null;
  contextId?: string | null;
  tags?: string[];
  /** Bypass the length gate for explicitly-flagged high-value outputs. */
  force?: boolean;
  captureLedgerPath?: string;
  /** Reference to the real produced artifact (file/published link) behind this deliverable. */
  deliverableArtifact?: DeliverableArtifactRef;
}): DeliverableCaptureResult {
  const content = params.content.trim();
  if (!content) {
    return { captured: false, reason: "empty" };
  }
  if (!params.force && content.length < MIN_CAPTURE_CONTENT_LENGTH) {
    return { captured: false, reason: "too-short" };
  }

  const ledgerPath = params.captureLedgerPath ?? DEFAULT_CAPTURE_LEDGER_FILE;
  const dedupKey = captureDedupKey({
    agentId: params.agentId,
    content,
    sessionKey: params.sessionKey,
    messageId: params.messageId,
  });
  const ledger = readCaptureLedger(ledgerPath);
  const existing = ledger.captures[dedupKey];
  if (existing) {
    return {
      captured: false,
      reason: "duplicate",
      skillId: existing.skillId,
      deliverableId: `skill:${existing.skillId}`,
    };
  }

  const title = params.title.trim() || content.slice(0, CAPTURE_TITLE_FALLBACK_LENGTH);
  const summary =
    content.length > CAPTURE_SUMMARY_MAX_LENGTH
      ? `${content.slice(0, CAPTURE_SUMMARY_MAX_LENGTH).trim()}…`
      : content;
  const now = Date.now();
  const lineage = (params.contextId ?? params.sessionKey ?? "").trim();
  const identityKey = captureIdentityKey({
    agentId: params.agentId,
    groupId: params.groupId,
    ownerId: params.ownerId,
    lineage,
    title,
    logicalId: params.logicalId,
    deliverableArtifact: params.deliverableArtifact,
  });

  // Latest-wins: if a prior revision of the same logical deliverable exists, update it in place
  // (refresh content / title / artifact, bump version) so revisions collapse into one 成果 entry.
  if (identityKey) {
    const priorIdentity = ledger.identities[identityKey];
    if (
      priorIdentity &&
      updateCapturedDeliverable({
        skillId: priorIdentity.skillId,
        title,
        summary,
        content,
        deliverableArtifact: params.deliverableArtifact,
      })
    ) {
      ledger.captures[dedupKey] = { skillId: priorIdentity.skillId, capturedAtMs: now };
      ledger.identities[identityKey] = { skillId: priorIdentity.skillId, capturedAtMs: now };
      writeCaptureLedger(ledger, ledgerPath);
      return {
        captured: true,
        reason: "updated",
        skillId: priorIdentity.skillId,
        deliverableId: `skill:${priorIdentity.skillId}`,
      };
    }
  }

  const result = saveSkillAsset({
    sourceAgentId: params.agentId.trim() || "main",
    ownerUserId: params.ownerId?.trim() || null,
    contextId: params.contextId ?? params.sessionKey ?? null,
    profile: {
      name: title,
      summary,
      assetType: "knowledge",
      tags: params.tags ?? [],
      category: "对话成果",
      visibility: "private",
      outputDescription: content,
      inputDescription: params.sessionKey
        ? `自动捕获自会话 ${params.sessionKey}`
        : "自动捕获的工作成果",
    },
    ...(params.deliverableArtifact ? { deliverableArtifact: params.deliverableArtifact } : {}),
  });

  ledger.captures[dedupKey] = { skillId: result.skillId, capturedAtMs: now };
  if (identityKey) {
    ledger.identities[identityKey] = { skillId: result.skillId, capturedAtMs: now };
  }
  writeCaptureLedger(ledger, ledgerPath);

  return {
    captured: true,
    reason: "captured",
    skillId: result.skillId,
    deliverableId: `skill:${result.skillId}`,
  };
}
