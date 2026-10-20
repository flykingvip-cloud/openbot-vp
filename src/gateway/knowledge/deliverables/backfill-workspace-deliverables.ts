import fs from "node:fs";
import path from "node:path";
import { buildEmployeeBuiltinStewardSessionKey } from "../../../agents/builtin-steward/employee-isolation.js";
import { BUILTIN_STEWARD_AGENT_ID } from "../../../agents/builtin-steward/identity.js";
import { CONFIG_DIR } from "../../../utils.js";
import { resolveRobotWriteRoot } from "../../workspace-resolver/write-roots.js";
import { captureAgentOutputDeliverable } from "./auto-capture-runtime.js";

/**
 * One-time backfill of a user's employee steward (大白) workspace into 成果中心.
 *
 * Files produced BEFORE declarative capture existed were never collected, so 成果中心 looks empty
 * even though real deliverables sit in the workspace. This scans the caller's own steward workspace
 * for deliverable-shaped files and captures each as a first-class file deliverable (by reference),
 * so they surface owner-scoped in the Results Center and open the faithful file preview.
 *
 * Safety / correctness:
 * - Scans ONLY the caller's robot own workspace (never another user's leftover root as SoT).
 * - Idempotent: each file is captured under a stable per-file key, so re-runs are no-ops (the
 *   capture ledger dedupes). A per-user marker also skips rescanning after the first pass.
 * - Best-effort: never throws; a filesystem error just yields zero captures.
 */

const DELIVERABLE_FILE_RE = /\.(docx?|pptx?|xlsx?|pdf|md|markdown|csv|txt|pages|numbers|key)$/i;
const TEXT_CONTENT_RE = /\.(md|markdown|txt|csv)$/i;
const MAX_BACKFILL_FILES = 200;
const MAX_TEXT_CONTENT_BYTES = 200 * 1024;

/**
 * Steward workspace scaffolding files (bootstrap prompts / identity / tools docs) provisioned into
 * every employee workspace. They are the steward's own operating context, NOT user deliverables, so
 * they must never be captured as 成果. Matched case-insensitively by basename.
 */
const STEWARD_SCAFFOLDING_BASENAMES = new Set([
  "agents.md",
  "claude.md",
  "bootstrap.md",
  "heartbeat.md",
  "identity.md",
  "soul.md",
  "tools.md",
  "user.md",
  "readme.md",
]);

function isStewardScaffoldingFile(filename: string): boolean {
  return STEWARD_SCAFFOLDING_BASENAMES.has(filename.trim().toLowerCase());
}

export type StewardWorkspaceBackfillResult = {
  scanned: number;
  captured: number;
};

function backfillMarkerPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
  return path.join(CONFIG_DIR, "knowledge", "steward-backfill", `${safe}.done`);
}

function writeMarker(markerPath: string): void {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`, "utf8");
  } catch {
    // Marker is a perf optimization only; ledger idempotency still guarantees correctness.
  }
}

/** Build a meaningful outputDescription: real text for text files, a stable note otherwise. */
function buildBackfillContent(fullPath: string, filename: string): string {
  if (TEXT_CONTENT_RE.test(filename)) {
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size <= MAX_TEXT_CONTENT_BYTES) {
        const text = fs.readFileSync(fullPath, "utf-8").trim();
        if (text) {
          return text;
        }
      }
    } catch {
      // fall through to the note
    }
  }
  return `已归档的工作区成果文件：${filename}`;
}

export function backfillEmployeeStewardWorkspaceDeliverables(params: {
  userId: string;
  /** Bypass the once-per-user marker (used by an explicit re-scan or tests). */
  force?: boolean;
  captureLedgerPath?: string;
}): StewardWorkspaceBackfillResult {
  const userId = params.userId.trim();
  if (!userId) {
    return { scanned: 0, captured: 0 };
  }
  const markerPath = backfillMarkerPath(userId);
  if (!params.force) {
    try {
      if (fs.existsSync(markerPath)) {
        return { scanned: 0, captured: 0 };
      }
    } catch {
      // treat as not-done and proceed
    }
  }

  const workspaceDir = resolveRobotWriteRoot({
    agentId: BUILTIN_STEWARD_AGENT_ID,
    userId,
  });
  if (!workspaceDir) {
    writeMarker(markerPath);
    return { scanned: 0, captured: 0 };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
  } catch {
    // No workspace yet — write the marker so we don't rescan on every list.
    writeMarker(markerPath);
    return { scanned: 0, captured: 0 };
  }

  const sessionKey = buildEmployeeBuiltinStewardSessionKey(userId);
  let scanned = 0;
  let captured = 0;
  for (const entry of entries) {
    if (scanned >= MAX_BACKFILL_FILES) {
      break;
    }
    if (!entry.isFile() || !DELIVERABLE_FILE_RE.test(entry.name)) {
      continue;
    }
    // Never capture the steward's own scaffolding files (AGENTS.md/SOUL.md/IDENTITY.md/...) as 成果.
    if (isStewardScaffoldingFile(entry.name)) {
      continue;
    }
    scanned += 1;
    const filename = entry.name;
    const content = buildBackfillContent(path.join(workspaceDir, filename), filename);
    try {
      const result = captureAgentOutputDeliverable({
        agentId: BUILTIN_STEWARD_AGENT_ID,
        title: filename,
        content,
        sessionKey,
        // Stable per-file key so re-runs dedupe against the capture ledger.
        messageId: `backfill:${filename}`,
        contextId: sessionKey,
        force: true,
        tags: ["file", "backfill"],
        deliverableArtifact: { previewKind: "file", filename },
        captureLedgerPath: params.captureLedgerPath,
      });
      if (result.captured) {
        captured += 1;
      }
    } catch {
      // Skip a single bad file without aborting the whole backfill.
    }
  }

  writeMarker(markerPath);
  return { scanned, captured };
}
