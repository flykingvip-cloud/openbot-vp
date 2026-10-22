import os from "node:os";
import { resolveSessionAgentId } from "../../../agents/agent-scope.js";
import { isEmployeeBuiltinStewardSession } from "../../../agents/builtin-steward/employee-isolation.js";
import { loadConfig } from "../../../config/config.js";
import { isManagedDataMode } from "../../../config/data-space.js";
import type { OpenBotConfig } from "../../../config/types.js";
import { extractDeliverableEnvelope } from "../../../shared/preview-artifact/deliverable-envelope.js";
import { resolveGroupCollaborationPaths } from "../../collaboration-learning/collaboration-paths.js";
import { resolveCollaborationGroupIdFromSessionKey } from "../../collaboration-learning/shared.js";
import {
  resolveWorkspaceActorTenantId,
  resolveWorkspaceLocator,
} from "../../workspace-resolver/index.js";
import { materializeDeclaredDeliverableAtPlacedRoot } from "../../workspace-resolver/materialize-declared-deliverable.js";
import { resolveWorkspaceWriteLocator } from "../../workspace-resolver/workspace-write-contract.js";
import { resolvePlacedFilesystemWriteRoot } from "../../workspace-resolver/write-roots.js";
import {
  captureAgentOutputDeliverable,
  type DeliverableCaptureResult,
} from "./auto-capture-runtime.js";
import { resolveDraftRelativePath, resolveLogicalId } from "./group-manifest.js";

export type MaybeAutoCaptureAgentDeliverableParams = {
  agentId?: string | null;
  sessionKey?: string | null;
  messageId?: string | null;
  ownerId?: string | null;
  content: string;
  /** When true, skip capture (heartbeat / silent / suppressed runs). */
  skip?: boolean;
  /**
   * Optional state directory for the placed workspace write root.
   * Production omits this and uses the process state dir. Tests pass a temp dir
   * so a `file=` declaration can be checked without touching a live workspace.
   */
  stateDir?: string;
};

function inferCaptureTitleFromBody(body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading.slice(0, 80);
  }
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 40) : "";
}

// A filename ending in a deliverable-style extension (doc/deck/sheet/pdf/etc.).
const DELIVERABLE_FILENAME_RE =
  /([^\s"'`：:*?<>|]+\.(?:docx?|pptx?|xlsx?|pdf|md|markdown|csv|txt|pages|numbers|key))\b/i;

// Same filename, but immediately after an explicit "file / save-as" label so the
// reference is unambiguously the produced artifact (e.g. "文件：报告.docx").
const LABELED_DELIVERABLE_FILENAME_RE =
  /(?:文件|附件|保存为|输出为|导出为|文件名|保存到|存为)\s*[:：]?\s*`?([^\s"'`：:*?<>|]+\.(?:docx?|pptx?|xlsx?|pdf|md|markdown|csv|txt|pages|numbers|key))\b/i;

// Cues that the assistant actually produced/persisted a file, rather than merely
// mentioning one (which would over-capture, e.g. answering "how do I open .docx").
const GENERATED_FILE_CUE_RE =
  /(生成|已生成|生成好|制作完成|已完成|保存|已保存|存到|放在|导出|输出|已在工作区|在工作区|草稿箱|附件|文件\s*[:：])/;

/**
 * Keep file= only when it is a workspace-relative locator for this bot.
 * Downloads, another user's space, and media zip stubs are dropped. A bare
 * name inside the bot's own space stays, and preview remains a miss until
 * the bytes exist.
 */
function acceptDeclaredDeliverableFile(params: {
  file: string;
  agentId: string;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
}): string | undefined {
  const placed = resolvePlacedFilesystemWriteRoot({
    agentId: params.agentId,
    userId: params.userId,
    sessionKey: params.sessionKey,
    stateDir: params.stateDir,
  });
  // No placed root yet: still reject illegal shapes, but do not treat the
  // install checkout as the workspace (that would refuse a legal bare name).
  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: placed ?? os.tmpdir(),
    requestedPath: params.file,
  });
  return decision.ok ? decision.relativePath : undefined;
}

function isDraftWorkspaceRelativePath(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/").toLowerCase();
  return normalized.startsWith("drafts/") || normalized.includes("/drafts/");
}

function resolveCaptureGroupId(sessionKey: string | null): string | null {
  return sessionKey ? resolveCollaborationGroupIdFromSessionKey(sessionKey) : null;
}

function upsertGroupDeliverableDraftBestEffort(params: {
  groupId: string;
  ownerId?: string | null;
  tenantId?: string | null;
  logicalId: string;
  title: string;
  content: string;
  workspaceFilename?: string | null;
  deliverableId?: string | null;
}): void {
  const cfg = loadConfig();
  const tenantId = resolveWorkspaceActorTenantId(params.tenantId);
  // P0-e: managed collaboration drafts require authoritative tenant context.
  if (isManagedDataMode(cfg) && tenantId === "personal-local") {
    return;
  }
  const workspacePath = resolveGroupCollaborationPaths(params.groupId, cfg).workspacePath;
  const located = resolveWorkspaceLocator({ cfg });
  void import("../../../memory/item7-w2-dark-dual-read-shadow.js").then(
    ({ scheduleItem7W2DarkDualReadShadow }) =>
      scheduleItem7W2DarkDualReadShadow({
        siteId: "S08-auto-capture-deliverable",
        legacyLocator: workspacePath,
        replacementLocator: located.ok ? located.handle.locator : null,
      }),
  );
  void import("../../../gateway/workspace-resolver/item7-w3-shadow.js").then(
    ({ scheduleItem7W3CatalogSynthesisShadow }) =>
      scheduleItem7W3CatalogSynthesisShadow({ ledgerId: "S08", existingResourceId: null }),
  );
  // Item 7 S08: incomplete locator queries fail closed. Do not synthesize an empty Catalog
  // and do not write production Catalog drafts (productionWrite=false).
  if (!located.ok) {
    return;
  }
  void params.logicalId;
  void params.title;
  void params.content;
  void params.workspaceFilename;
  void params.deliverableId;
}

/**
 * Returns the basename of a generated deliverable file referenced in `content`,
 * or null when the text does not clearly announce a produced file. Requires BOTH
 * a production cue AND a filename with a known extension to keep precision high.
 */
function extractGeneratedDeliverableFilename(content: string): string | null {
  if (!GENERATED_FILE_CUE_RE.test(content)) {
    return null;
  }
  const labeled = LABELED_DELIVERABLE_FILENAME_RE.exec(content);
  const anyFile = labeled ? null : DELIVERABLE_FILENAME_RE.exec(content);
  const raw = (labeled?.[1] ?? anyFile?.[1] ?? "").trim();
  if (!raw) {
    return null;
  }
  const basename = raw.split(/[\\/]/).pop()?.trim() || raw;
  return basename ? basename.slice(0, 120) : null;
}

/** Master switch for server-side deliverable auto-capture (default on). */
export function isDeliverableAutoCaptureEnabled(): boolean {
  if (process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE === "0") {
    return false;
  }
  try {
    const cfg = loadConfig() as {
      knowledge?: { deliverables?: { autoCapture?: boolean; autoCaptureHeuristic?: boolean } };
    };
    if (cfg.knowledge?.deliverables?.autoCapture === false) {
      return false;
    }
  } catch {
    // keep default enabled
  }
  return true;
}

/** When true, long non-envelope outputs may be captured via the length gate. */
export function isDeliverableHeuristicAutoCaptureEnabled(): boolean {
  if (process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE_HEURISTIC === "1") {
    return true;
  }
  try {
    const cfg = loadConfig() as {
      knowledge?: { deliverables?: { autoCaptureHeuristic?: boolean } };
    };
    return cfg.knowledge?.deliverables?.autoCaptureHeuristic === true;
  } catch {
    return false;
  }
}

/**
 * After an agent/chat reply completes, capture incubating deliverables when an explicit
 * deliverable envelope is present (preferred) or, when heuristic capture is enabled,
 * when the output passes the runtime length gate.
 */
export function maybeAutoCaptureAgentDeliverable(
  params: MaybeAutoCaptureAgentDeliverableParams,
): DeliverableCaptureResult | null {
  if (params.skip || !isDeliverableAutoCaptureEnabled()) {
    return null;
  }
  const content = params.content.trim();
  if (!content) {
    return null;
  }

  const sessionKey = params.sessionKey?.trim() || null;
  const groupId = resolveCaptureGroupId(sessionKey);
  const agentId =
    params.agentId?.trim() || (sessionKey ? resolveSessionAgentId({ sessionKey }) : null) || "main";

  const envelope = extractDeliverableEnvelope(content);
  if (envelope) {
    if (envelope.file && isDraftWorkspaceRelativePath(envelope.file)) {
      return null;
    }
    const acceptedFile = envelope.file
      ? acceptDeclaredDeliverableFile({
          file: envelope.file,
          agentId,
          userId: params.ownerId,
          sessionKey,
          stateDir: params.stateDir,
        })
      : undefined;
    const title = envelope.title ?? inferCaptureTitleFromBody(envelope.body);
    const logicalId = resolveLogicalId({
      explicit: envelope.logicalId,
      title,
      filename: acceptedFile,
    });
    if (groupId) {
      upsertGroupDeliverableDraftBestEffort({
        groupId,
        ownerId: params.ownerId,
        logicalId,
        title,
        content: envelope.body || content,
        workspaceFilename: acceptedFile,
      });
    }

    // Preview opens workspace-relative paths. A declaration with file= is a
    // previewable file only after non-empty bytes exist there. Text bodies are
    // materialized when the write tool was skipped; office bytes are not invented.
    let fileReadable = false;
    if (acceptedFile) {
      let captureCfg: OpenBotConfig | null = null;
      try {
        captureCfg = loadConfig();
      } catch {
        captureCfg = null;
      }
      const placed = materializeDeclaredDeliverableAtPlacedRoot({
        agentId,
        userId: params.ownerId,
        sessionKey,
        stateDir: params.stateDir,
        relativePath: acceptedFile,
        content: envelope.body,
        cfg: captureCfg,
      });
      fileReadable = placed.ok;
    }
    const declaredArtifact = acceptedFile
      ? fileReadable
        ? ({ previewKind: "file", filename: acceptedFile } as const)
        : undefined
      : envelope.url
        ? ({ previewKind: "published", url: envelope.url } as const)
        : groupId
          ? ({ previewKind: "file", filename: resolveDraftRelativePath(logicalId) } as const)
          : undefined;

    const result = captureAgentOutputDeliverable({
      agentId,
      groupId,
      ownerId: params.ownerId,
      logicalId,
      title,
      content: envelope.body,
      sessionKey,
      messageId: params.messageId,
      contextId: sessionKey,
      force: true,
      tags: envelope.type ? [envelope.type] : groupId ? ["collaboration"] : [],
      ...(declaredArtifact ? { deliverableArtifact: declaredArtifact } : {}),
    });

    if (groupId && result.deliverableId) {
      upsertGroupDeliverableDraftBestEffort({
        groupId,
        ownerId: params.ownerId,
        logicalId,
        title,
        content: envelope.body || content,
        workspaceFilename: acceptedFile,
        deliverableId: result.deliverableId,
      });
    }
    return result;
  }

  if (groupId) {
    return null;
  }

  // Employee steward (大白) sessions frequently produce concrete deliverable
  // files (docs/decks/sheets) that the product expects to land in 成果中心, but
  // their "已生成 X.docx" summaries rarely carry an explicit <<DELIVERABLE>>
  // envelope. For these sessions only, treat an explicit generated-file
  // reference as a high-precision capture signal (independent of the global
  // heuristic gate). Captured under the employee steward session key, the result
  // then surfaces owner-scoped in the Results Center read model.
  if (isEmployeeBuiltinStewardSession({ sessionKey, agentId })) {
    const generatedFilename = extractGeneratedDeliverableFilename(content);
    if (generatedFilename && !isDraftWorkspaceRelativePath(generatedFilename)) {
      return captureAgentOutputDeliverable({
        agentId,
        groupId,
        ownerId: params.ownerId,
        title: generatedFilename,
        content,
        sessionKey,
        messageId: params.messageId,
        contextId: sessionKey,
        force: true,
        tags: ["file"],
        // Prose-announced file: still carry the filename so 成果中心 can open the real workspace file.
        deliverableArtifact: { previewKind: "file", filename: generatedFilename },
      });
    }
  }

  if (!isDeliverableHeuristicAutoCaptureEnabled()) {
    return null;
  }

  return captureAgentOutputDeliverable({
    agentId,
    groupId,
    ownerId: params.ownerId,
    title: inferCaptureTitleFromBody(content),
    content,
    sessionKey,
    messageId: params.messageId,
    contextId: sessionKey,
  });
}
