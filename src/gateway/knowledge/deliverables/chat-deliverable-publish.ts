import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deliverWithIdempotentReceipt } from "../../../agent-runtime/delivery/index.js";
import { loadConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { extractDeliverableEnvelope } from "../../../shared/preview-artifact/deliverable-envelope.js";
import { resolveLegacyAgentId } from "../../agent-registry/legacy-resolver.js";
import { findPrimaryOwnerBinding } from "../../agent-registry/ownership.js";
import { resolveAgentRegistryStorePath } from "../../agent-registry/store.js";
import type { AgentRegistryStore } from "../../agent-registry/types.js";
import { loadValidatedCatalogRecordSync } from "../../data-governance/catalog-store.js";
import { resolveDataGovernanceCatalogPath } from "../../data-governance/paths.js";
import { resolveSecurityProfile } from "../../security-profile.js";
import { buildBuiltinStewardWorkspaceResourceId } from "../../workspace-resolver/builders.js";
import { selectExecutionWorkspace } from "../../workspace-resolver/execution-workspace.js";
import {
  markDeliverableDeclarationUnwritten,
  patchDeliverableDeclarationAttrs,
  resolveCollaborationDeliverableRoots,
  settleCollaborationDeclaredDeliverable,
  type DeclaredDeliverableSettlement,
} from "../../workspace-resolver/settle-declared-deliverable.js";

/**
 * Shared delivery preparation for chat finals (batch 1).
 *
 * Extends the existing settle path. This is not a second gate and it does not
 * decide business acceptance: `confirmed` / `readable` stay technical.
 * `readable` only means the server could read bytes. A user-facing delivery
 * success is attached only after a publish record (version + verification)
 * has been persisted, and the preview chip still has to open through the
 * real chat preview entry.
 *
 * ## Settle write contract (1:1 and group share this; settle is not a pure check)
 *
 * Allowed writes
 * - Text-like extensions (md/txt/csv/json/html/…) may be materialized from the
 *   envelope body when the declared path has no non-empty bytes.
 * - Group turns (`groupId` set) also mirror those bytes onto the group formal
 *   root at the exact relative path, then upsert the group manifest draft.
 * - 1:1 (no `groupId`, not group-scoped) may write only the agent placed
 *   workspace. It does not create a group manifest and does not touch a group
 *   formal root. The caller passes the single user already authorized for that
 *   chat session. Missing or ambiguous identity does not fall back to a host
 *   workspace: settle stays `unwritten` / `no_writable_root`.
 *
 * Not allowed
 * - Reserved group prefixes `runtime/`, `governance/`, `profile/`, `sessions/`,
 *   `.git/` are never deliverable targets.
 * - Binary declarations (pdf/office/images) never have bytes invented. Missing
 *   or zero-length bytes stay `unwritten`. Bytes that exist only on the other
 *   path shape of the same bot (tenants vs operators), or that disagree with
 *   the formal root, stay `unwritten` with `workspace_root_skew`. Settle does
 *   not copy or overwrite across that split.
 * - A group formal-root file with different bytes is a `conflict`: do not
 *   overwrite, do not confirm.
 * - A group-scoped turn whose formal root is missing stays `retryable`. It must
 *   not degrade into an agent-only `readable` success.
 *
 * Overwrite
 * - Agent file that is the byte source is not clobbered.
 * - Group file is written only when missing. Different existing bytes → conflict.
 * - Same checksum is idempotent: manifest upsert does not create a second
 *   logical version. Replay of a registered version skips settle entirely.
 *
 * Publish order
 * - Analysis prose is always returned and may be transcripted / broadcast.
 * - User-visible delivery success is persisted (this ledger) before the caller
 *   writes the transcript or broadcasts. Broadcast failure is recorded on the
 *   same idempotency key and replayed without a second authoritative version.
 *
 * Scope of this batch
 * - Structured `<<DELIVERABLE file=…>>` declarations, plus the publish record
 *   for that declared object.
 * - Prose that merely says「已生成 / 已保存」without a structured file
 *   declaration is not rewritten and is not treated as delivered here.
 */

export const CHAT_DELIVERABLE_PUBLISH_INTENTS = [
  "group-bot-final",
  "group-round-close",
  "direct-fallback-final",
  "agent-run-final",
  "guide-append",
  "inject",
  "restore-legacy",
] as const;

export type ChatDeliverablePublishIntent = (typeof CHAT_DELIVERABLE_PUBLISH_INTENTS)[number];

export type DeliveryVerification = "pass" | "fail" | "unknown";
export type DeliveryRegistration = "registered" | "failed" | "skipped" | "not_applicable";
export type DeliveryPresentation = "none" | "delivered" | "undelivered" | "pending_recovery";

export type ChatDeliverablePublishView = {
  presentation: DeliveryPresentation;
  verification: DeliveryVerification;
  registration: DeliveryRegistration;
  failureReason: string | null;
  reasonLabel: string | null;
  relativePath: string | null;
  versionChecksum: string | null;
  idempotencyKey: string;
  /** Technical settle status. Not a business accepted/completed flag. */
  settleStatus: DeclaredDeliverableSettlement["status"] | "error";
};

export type ChatDeliverablePublishRecord = ChatDeliverablePublishView & {
  tenantId: string | null;
  sessionKey: string;
  groupId: string | null;
  taskId: string | null;
  publishIntent: ChatDeliverablePublishIntent;
  clientRunId: string | null;
  agentId: string | null;
  logicalId: string | null;
  persisted: boolean;
  /** Null until a broadcast attempt is noted. */
  broadcastOk: boolean | null;
  /** Authoritative version writes. Replay must not increment this. */
  authoritativeWrites: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PreparedChatDeliverable = {
  text: string;
  structured: boolean;
  /** Snapshot for the outgoing chat message. History reload re-reads the ledger. */
  view: ChatDeliverablePublishView;
  record: ChatDeliverablePublishRecord | null;
  idempotencyKey: string;
  replayed: boolean;
  stateDir: string;
};

type PublishLedger = {
  records: Record<string, ChatDeliverablePublishRecord>;
};

const REASON_LABELS: Record<string, string> = {
  manifest_write_failed: "登记失败，可重试",
  version_conflict: "版本冲突，未覆盖已有文件",
  binary_requires_tool_write: "文件缺失或为空",
  workspace_root_skew: "文件缺失或为空",
  empty_content: "文件缺失或为空",
  write_failed: "写入失败",
  group_reserved_path: "该路径不能作为成果",
  group_formal_root_miss: "未写入群工作区",
  no_writable_root: "没有可写的工作区",
  missing_tenant: "群工作区不可用",
  locator_failed: "群工作区不可用",
  group_root_unavailable: "群工作区不可用",
  settle_threw: "交付检查异常",
  publish_record_failed: "交付版本未能持久化",
  broadcast_failed: "已登记，广播未完成",
};

export type PrepareChatDeliverablePublishParams = {
  text: string;
  publishIntent: ChatDeliverablePublishIntent;
  sessionKey: string;
  tenantId?: string | null;
  groupId?: string | null;
  taskId?: string | null;
  agentId: string;
  userId?: string | null;
  clientRunId?: string | null;
  stateDir?: string;
  /** Addressing env for formal-root resolution. Production omits this and uses process.env. */
  env?: NodeJS.ProcessEnv;
  agentWorkspaceRoot?: string | null;
  groupWorkspaceRoot?: string | null;
  /** Read-only twins of the agent formal root. Tests inject these; production resolves them. */
  siblingAgentWorkspaceRoots?: string[] | null;
  /** True when the turn is group-scoped even if the formal root is missing. */
  groupScoped?: boolean;
  /** @deprecated Delivery never auto-captures knowledge; explicit save owns that action. */
  skipCapture?: boolean;
  settleImpl?: typeof settleCollaborationDeclaredDeliverable;
};

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  return REASON_LABELS[reason] ?? reason;
}

/**
 * User-visible 「可预览 / 可以直接打开 / 已交付」copy is only honest when
 * presentation=delivered (settle success). Scrub false claims so chat never
 * says "click preview" while the card is missing/empty.
 */
const FALSE_DELIVERY_CLAIM_RE =
  /点预览就能打开|点预览即可|请(?:点击)?预览(?:打开|查看)?|可以直接打开|可直接打开|已可预览|文件已(?:生成|就绪)[，,]?\s*可(?:以)?(?:预览|打开)/gu;

export function scrubFalseDeliveryClaims(text: string): string {
  if (!text) {
    return text;
  }
  const nextRaw = text.replace(FALSE_DELIVERY_CLAIM_RE, "");
  if (nextRaw === text) {
    return text;
  }
  // Collapse doubled punctuation left by mid-sentence scrub.
  let next = nextRaw.replace(/([。.!！?？])\s*\1+/gu, "$1");
  next = next.replace(/([，,；;：:])\s*\1+/gu, "$1");
  next = next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return next;
}

function applyDeliveryCopyGate(text: string, presentation: DeliveryPresentation): string {
  if (presentation === "delivered" || presentation === "none") {
    return text;
  }
  return scrubFalseDeliveryClaims(text);
}

function normalizeRelative(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function buildChatDeliverableIdempotencyKey(params: {
  tenantId?: string | null;
  sessionKey: string;
  publishIntent: ChatDeliverablePublishIntent;
  taskId?: string | null;
  relativePath: string;
  versionChecksum?: string | null;
}): string {
  const tenant = params.tenantId?.trim() || "-";
  const task = params.taskId?.trim() || "-";
  const version = params.versionChecksum?.trim() || "no-version";
  const relativePath = normalizeRelative(params.relativePath) || "-";
  return sha256Hex(
    [
      "chat-deliverable-publish",
      tenant,
      params.sessionKey.trim(),
      params.publishIntent,
      task,
      relativePath,
      version,
    ].join("\n"),
  );
}

function ledgerPath(stateDir: string, sessionKey: string): string {
  const name = sha256Hex(sessionKey.trim()).slice(0, 32);
  return path.join(stateDir, "deliverable-publish", `${name}.json`);
}

function readLedger(stateDir: string, sessionKey: string): PublishLedger {
  const file = ledgerPath(stateDir, sessionKey);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PublishLedger;
    if (!parsed || typeof parsed !== "object" || !parsed.records) {
      return { records: {} };
    }
    return parsed;
  } catch {
    return { records: {} };
  }
}

function writeLedger(stateDir: string, sessionKey: string, ledger: PublishLedger): boolean {
  const file = ledgerPath(stateDir, sessionKey);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(ledger)}\n`, "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function readNonEmpty(absolutePath: string): Buffer | null {
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    return fs.readFileSync(absolutePath);
  } catch {
    return null;
  }
}

function fileChecksum(root: string | null | undefined, relativePath: string): string | null {
  if (!root?.trim() || !relativePath) {
    return null;
  }
  const bytes = readNonEmpty(path.join(root, relativePath));
  return bytes ? sha256Hex(bytes) : null;
}

function emptyView(
  settleStatus: ChatDeliverablePublishView["settleStatus"],
): ChatDeliverablePublishView {
  return {
    presentation: "none",
    verification: "unknown",
    registration: "not_applicable",
    failureReason: null,
    reasonLabel: null,
    relativePath: null,
    versionChecksum: null,
    idempotencyKey: "",
    settleStatus,
  };
}

function classifySettle(settled: DeclaredDeliverableSettlement): {
  verification: DeliveryVerification;
  registration: DeliveryRegistration;
  presentation: DeliveryPresentation;
  failureReason: string | null;
} {
  if (settled.status === "none") {
    return {
      verification: "unknown",
      registration: "not_applicable",
      presentation: "none",
      failureReason: null,
    };
  }
  if (settled.status === "confirmed" || settled.status === "readable") {
    return {
      verification: "pass",
      registration: "registered",
      presentation: "delivered",
      failureReason: null,
    };
  }
  if (settled.status === "retryable") {
    return {
      verification: settled.versionChecksum ? "pass" : "unknown",
      registration: "failed",
      presentation: "pending_recovery",
      failureReason: settled.reason ?? "manifest_write_failed",
    };
  }
  return {
    verification: "fail",
    registration: "failed",
    presentation: "undelivered",
    failureReason: settled.reason ?? settled.status,
  };
}

function viewFor(
  partial: Omit<ChatDeliverablePublishView, "reasonLabel">,
): ChatDeliverablePublishView {
  return {
    ...partial,
    reasonLabel: reasonLabel(partial.failureReason),
  };
}

function ledgerView(record: ChatDeliverablePublishRecord): ChatDeliverablePublishView {
  if (
    record.registration === "registered" &&
    record.verification === "pass" &&
    record.broadcastOk === true
  ) {
    return viewFor({
      presentation: "delivered",
      verification: "pass",
      registration: "registered",
      failureReason: null,
      relativePath: record.relativePath,
      versionChecksum: record.versionChecksum,
      idempotencyKey: record.idempotencyKey,
      settleStatus: record.settleStatus,
    });
  }
  if (record.registration === "registered" && record.verification === "pass") {
    return viewFor({
      presentation: "pending_recovery",
      verification: "pass",
      registration: "registered",
      failureReason: record.broadcastOk === false ? "broadcast_failed" : record.failureReason,
      relativePath: record.relativePath,
      versionChecksum: record.versionChecksum,
      idempotencyKey: record.idempotencyKey,
      settleStatus: record.settleStatus,
    });
  }
  return viewFor({
    presentation: record.presentation === "none" ? "none" : record.presentation,
    verification: record.verification,
    registration: record.registration,
    failureReason: record.failureReason,
    relativePath: record.relativePath,
    versionChecksum: record.versionChecksum,
    idempotencyKey: record.idempotencyKey,
    settleStatus: record.settleStatus,
  });
}

function optimisticView(record: ChatDeliverablePublishRecord): ChatDeliverablePublishView {
  if (record.registration === "registered" && record.verification === "pass") {
    return viewFor({
      presentation: "delivered",
      verification: "pass",
      registration: "registered",
      failureReason: null,
      relativePath: record.relativePath,
      versionChecksum: record.versionChecksum,
      idempotencyKey: record.idempotencyKey,
      settleStatus: record.settleStatus,
    });
  }
  return ledgerView(record);
}

function sameIdentity(
  record: ChatDeliverablePublishRecord,
  params: {
    tenantId: string | null;
    sessionKey: string;
    publishIntent: ChatDeliverablePublishIntent;
    taskId: string | null;
    relativePath: string;
  },
): boolean {
  return (
    (record.tenantId ?? null) === params.tenantId &&
    record.sessionKey === params.sessionKey &&
    record.publishIntent === params.publishIntent &&
    (record.taskId ?? null) === params.taskId &&
    normalizeRelative(record.relativePath) === params.relativePath
  );
}

function findRegistered(
  ledger: PublishLedger,
  params: {
    tenantId: string | null;
    sessionKey: string;
    publishIntent: ChatDeliverablePublishIntent;
    taskId: string | null;
    relativePath: string;
    versionChecksum: string;
  },
): ChatDeliverablePublishRecord | null {
  const matches = Object.values(ledger.records).filter(
    (record) =>
      record.registration === "registered" &&
      record.verification === "pass" &&
      record.versionChecksum === params.versionChecksum &&
      sameIdentity(record, params),
  );
  const ordered = matches.toSorted((a, b) => a.createdAtMs - b.createdAtMs);
  return ordered[0] ?? null;
}

function patchReplayText(
  text: string,
  relativePath: string,
  settleStatus: ChatDeliverablePublishRecord["settleStatus"],
): string {
  if (settleStatus === "confirmed") {
    return patchDeliverableDeclarationAttrs(text, relativePath, {
      nextRelativePath: relativePath,
      unwritten: false,
      settle: "confirmed",
    });
  }
  if (settleStatus === "retryable") {
    return patchDeliverableDeclarationAttrs(text, relativePath, {
      nextRelativePath: relativePath,
      unwritten: false,
      settle: "retryable",
    });
  }
  if (settleStatus === "conflict") {
    return patchDeliverableDeclarationAttrs(text, relativePath, {
      nextRelativePath: relativePath,
      unwritten: false,
      settle: "conflict",
    });
  }
  if (settleStatus === "unwritten" || settleStatus === "error") {
    return markDeliverableDeclarationUnwritten(text, relativePath);
  }
  return text;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  const content = record.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const part = entry as { type?: string; text?: string };
        return part.type === "text" && typeof part.text === "string" ? part.text : "";
      })
      .join("\n");
  }
  return typeof record.text === "string" ? record.text : "";
}

function unresolvedResult(params: {
  text: string;
  stateDir: string;
  settleStatus: ChatDeliverablePublishView["settleStatus"];
  failureReason: string;
  relativePath?: string | null;
  idempotencyKey?: string;
  verification?: DeliveryVerification;
}): PreparedChatDeliverable {
  const relativePath = params.relativePath ?? null;
  const marked =
    relativePath && params.settleStatus !== "none"
      ? markDeliverableDeclarationUnwritten(params.text, relativePath)
      : params.text;
  const text = applyDeliveryCopyGate(marked, "undelivered");
  const view = viewFor({
    presentation: "undelivered",
    verification: params.verification ?? "unknown",
    registration: "failed",
    failureReason: params.failureReason,
    relativePath,
    versionChecksum: null,
    idempotencyKey: params.idempotencyKey ?? "",
    settleStatus: params.settleStatus,
  });
  return {
    text,
    structured: true,
    view,
    record: null,
    idempotencyKey: view.idempotencyKey,
    replayed: false,
    stateDir: params.stateDir,
  };
}

export function prepareChatDeliverablePublish(
  params: PrepareChatDeliverablePublishParams,
): PreparedChatDeliverable {
  const stateDir = params.stateDir?.trim() || resolveStateDir();
  const text = params.text ?? "";
  const sessionKey = params.sessionKey.trim();
  const tenantId = params.tenantId?.trim() || null;
  const taskId = params.taskId?.trim() || null;
  const groupId = params.groupId?.trim() || null;
  const declared = text.includes("DELIVERABLE") ? extractDeliverableEnvelope(text) : null;
  if (!declared?.file) {
    return {
      text,
      structured: false,
      view: emptyView("none"),
      record: null,
      idempotencyKey: "",
      replayed: false,
      stateDir,
    };
  }
  const relativePath = normalizeRelative(declared.file);
  const groupScoped = Boolean(groupId) || params.groupScoped === true;
  const injected = "agentWorkspaceRoot" in params || "groupWorkspaceRoot" in params;

  try {
    const managed =
      resolveSecurityProfile(loadConfig(), params.env ?? process.env).profile ===
      "managed_enterprise";
    const resolved =
      injected || managed
        ? {
            agentWorkspaceRoot: params.agentWorkspaceRoot ?? null,
            groupWorkspaceRoot: params.groupWorkspaceRoot ?? null,
            siblingAgentWorkspaceRoots: params.siblingAgentWorkspaceRoots ?? [],
          }
        : resolveCollaborationDeliverableRoots({
            agentId: params.agentId,
            groupId,
            tenantId,
            userId: params.userId,
            sessionKey,
            stateDir,
            env: params.env,
          });
    let agentRoot = resolved.agentWorkspaceRoot;
    let groupRoot = resolved.groupWorkspaceRoot;
    if (managed && !injected) {
      if (!tenantId || !params.userId) {
        throw new Error("workspace_binding_required:trusted_identity_missing");
      }
      const registry = JSON.parse(
        fs.readFileSync(resolveAgentRegistryStorePath(), "utf8"),
      ) as AgentRegistryStore;
      const identity = resolveLegacyAgentId({
        store: registry,
        enterpriseId: tenantId,
        legacyAgentId: params.agentId,
      });
      const owner =
        identity.kind === "resolved" ? findPrimaryOwnerBinding(registry, identity.ref) : undefined;
      const rid = groupId
        ? `ws:${tenantId}:group:${groupId}`
        : identity.kind === "builtin-universal"
          ? buildBuiltinStewardWorkspaceResourceId({
              tenantId,
              userId: params.userId,
            })
          : identity.kind === "resolved" && owner
            ? owner.ownerType === "seat"
              ? `ws:${tenantId}:seat:${owner.ownerId}:asset:${identity.ref.agentAssetId}`
              : `ws:${tenantId}:user:${params.userId}:asset:${identity.ref.agentAssetId}`
            : "";
      const record = loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: rid,
      });
      const canonical = selectExecutionWorkspace({
        tenantId,
        userId: params.userId,
        agentId: params.agentId,
        groupId: groupId ?? undefined,
        registry,
        records: record ? [record.record] : [],
        operation: "write",
      });
      agentRoot = groupId ? null : canonical.rootPath;
      groupRoot = groupId ? canonical.rootPath : null;
      resolved.agentWorkspaceRoot = agentRoot;
      resolved.groupWorkspaceRoot = groupRoot;
      resolved.siblingAgentWorkspaceRoots = [];
    }
    const ledger = readLedger(stateDir, sessionKey);
    const authoritativeRoot = groupScoped ? groupRoot : agentRoot;
    if (authoritativeRoot) {
      const checksum = fileChecksum(authoritativeRoot, relativePath);
      if (checksum) {
        const existing = findRegistered(ledger, {
          tenantId,
          sessionKey,
          publishIntent: params.publishIntent,
          taskId,
          relativePath,
          versionChecksum: checksum,
        });
        if (existing) {
          const view =
            existing.broadcastOk === true ? optimisticView(existing) : ledgerView(existing);
          return {
            text: applyDeliveryCopyGate(
              patchReplayText(text, relativePath, existing.settleStatus),
              view.presentation,
            ),
            structured: true,
            view,
            record: existing,
            idempotencyKey: existing.idempotencyKey,
            replayed: true,
            stateDir,
          };
        }
      }
    }

    const settle = params.settleImpl ?? settleCollaborationDeclaredDeliverable;
    const settled = settle({
      text,
      agentId: params.agentId,
      groupId,
      tenantId,
      userId: params.userId,
      sessionKey,
      stateDir,
      agentWorkspaceRoot: agentRoot,
      groupWorkspaceRoot: groupRoot,
      siblingAgentWorkspaceRoots: resolved.siblingAgentWorkspaceRoots,
      groupScoped,
    });
    const classified = classifySettle(settled);
    const finalPath = normalizeRelative(settled.relativePath) || relativePath;
    const idempotencyKey = buildChatDeliverableIdempotencyKey({
      tenantId,
      sessionKey,
      publishIntent: params.publishIntent,
      taskId,
      relativePath: finalPath,
      versionChecksum: settled.versionChecksum,
    });
    const now = Date.now();
    const prior = ledger.records[idempotencyKey];
    let registration = classified.registration;
    let presentation = classified.presentation;
    let failureReason = classified.failureReason;
    let persisted = false;
    const canRegister =
      (settled.status === "confirmed" || settled.status === "readable") &&
      classified.verification === "pass";
    if (canRegister && prior?.registration === "registered") {
      registration = "registered";
      presentation = "delivered";
      failureReason = null;
    }
    const record: ChatDeliverablePublishRecord = {
      presentation: canRegister ? "pending_recovery" : presentation,
      verification: classified.verification,
      registration,
      failureReason: canRegister ? null : failureReason,
      reasonLabel: reasonLabel(canRegister ? null : failureReason),
      relativePath: finalPath,
      versionChecksum: settled.versionChecksum ?? null,
      idempotencyKey,
      settleStatus: settled.status,
      tenantId,
      sessionKey,
      groupId,
      taskId,
      publishIntent: params.publishIntent,
      clientRunId: params.clientRunId?.trim() || null,
      agentId: params.agentId.trim() || null,
      logicalId: declared.logicalId ?? null,
      persisted: false,
      broadcastOk: prior?.broadcastOk ?? null,
      authoritativeWrites:
        (prior?.authoritativeWrites ?? 0) +
        (canRegister && prior?.registration !== "registered" ? 1 : 0),
      createdAtMs: prior?.createdAtMs ?? now,
      updatedAtMs: now,
    };
    ledger.records[idempotencyKey] = record;
    persisted = writeLedger(stateDir, sessionKey, ledger);
    record.persisted = persisted;
    if (canRegister && !persisted) {
      record.registration = "failed";
      record.presentation = "undelivered";
      record.failureReason = "publish_record_failed";
      record.reasonLabel = reasonLabel("publish_record_failed");
      record.authoritativeWrites = prior?.authoritativeWrites ?? 0;
      registration = "failed";
      presentation = "undelivered";
      failureReason = "publish_record_failed";
    } else if (persisted) {
      record.persisted = true;
    }
    // Delivery registration is not user consent to save a knowledge copy.
    // The explicit save-and-archive path owns capture and its independent ACL.
    const stored = ledger.records[idempotencyKey] ?? record;
    const view =
      canRegister && stored.registration === "registered"
        ? optimisticView(stored)
        : ledgerView(stored);
    const outgoingText =
      failureReason === "publish_record_failed"
        ? markDeliverableDeclarationUnwritten(text, finalPath)
        : settled.text;
    return {
      text: applyDeliveryCopyGate(outgoingText, view.presentation),
      structured: true,
      view,
      record: stored,
      idempotencyKey,
      replayed: Boolean(prior?.registration === "registered" && canRegister),
      stateDir,
    };
  } catch {
    const idempotencyKey = buildChatDeliverableIdempotencyKey({
      tenantId,
      sessionKey,
      publishIntent: params.publishIntent,
      taskId,
      relativePath,
    });
    return unresolvedResult({
      text,
      stateDir,
      settleStatus: "error",
      failureReason: "settle_threw",
      relativePath,
      idempotencyKey,
      verification: "unknown",
    });
  }
}

export function noteChatDeliverableBroadcast(params: {
  stateDir?: string;
  sessionKey: string;
  idempotencyKey: string;
  ok: boolean;
}): ChatDeliverablePublishRecord | null {
  const key = params.idempotencyKey.trim();
  const sessionKey = params.sessionKey.trim();
  if (!key || !sessionKey) {
    return null;
  }
  const stateDir = params.stateDir?.trim() || resolveStateDir();
  const ledger = readLedger(stateDir, sessionKey);
  const record = ledger.records[key];
  if (!record) {
    return null;
  }
  record.broadcastOk = params.ok;
  record.updatedAtMs = Date.now();
  if (params.ok && record.registration === "registered" && record.verification === "pass") {
    record.presentation = "delivered";
    record.failureReason = null;
    record.reasonLabel = null;
  } else if (!params.ok && record.registration === "registered") {
    record.presentation = "pending_recovery";
    record.failureReason = "broadcast_failed";
    record.reasonLabel = reasonLabel("broadcast_failed");
  }
  ledger.records[key] = record;
  writeLedger(stateDir, sessionKey, ledger);
  return record;
}

/**
 * Broadcast helper. Delegates to the canonical receipt-idempotent delivery
 * boundary: a throw when an idempotent ledger record exists is recorded on the
 * same key without creating another version or discarding the prepared body.
 */
export function deliverPreparedChatFinal(params: {
  prepared?: PreparedChatDeliverable | null;
  send: () => void;
  onFailure?: () => void;
}): { ok: boolean } {
  const prepared = params.prepared;
  const hasReceipt = Boolean(prepared?.idempotencyKey && prepared.record);
  const result = deliverWithIdempotentReceipt({
    hasReceipt,
    send: params.send,
    noteOutcome: (ok) => {
      if (!prepared?.idempotencyKey || !prepared.record) {
        return;
      }
      noteChatDeliverableBroadcast({
        stateDir: prepared.stateDir,
        sessionKey: prepared.record.sessionKey,
        idempotencyKey: prepared.idempotencyKey,
        ok,
      });
    },
  });
  if (!result.ok) {
    params.onFailure?.();
  }
  return { ok: result.ok };
}

export function overlayChatDeliverablePublish(params: {
  sessionKey: string;
  messages: unknown[];
  stateDir?: string;
}): unknown[] {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey || params.messages.length === 0) {
    return params.messages;
  }
  const stateDir = params.stateDir?.trim() || resolveStateDir();
  const ledger = readLedger(stateDir, sessionKey);
  const records = Object.values(ledger.records);
  if (records.length === 0) {
    return params.messages;
  }
  return params.messages.map((message) => {
    const text = messageText(message);
    const envelope = text.includes("DELIVERABLE") ? extractDeliverableEnvelope(text) : null;
    const relativePath = normalizeRelative(envelope?.file);
    if (!relativePath || !message || typeof message !== "object") {
      return message;
    }
    const matches = records
      .filter(
        (record) =>
          record.sessionKey === sessionKey &&
          normalizeRelative(record.relativePath) === relativePath,
      )
      .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
    const record = matches[0];
    if (!record) {
      return message;
    }
    return {
      ...(message as Record<string, unknown>),
      deliverablePublish: ledgerView(record),
    };
  });
}
