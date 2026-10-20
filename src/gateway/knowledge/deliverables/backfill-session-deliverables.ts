import fs from "node:fs";
import path from "node:path";
import { buildEmployeeBuiltinStewardSessionKey } from "../../../agents/builtin-steward/employee-isolation.js";
import { BUILTIN_STEWARD_AGENT_ID } from "../../../agents/builtin-steward/identity.js";
import { resolveSessionTranscriptsDirForAgent } from "../../../config/sessions/paths.js";
import { extractDeliverableEnvelope } from "../../../shared/preview-artifact/deliverable-envelope.js";
import { CONFIG_DIR } from "../../../utils.js";
import {
  listPollutingRobotOwnWorkspaceDirs,
  resolveRobotWriteRoot,
} from "../../workspace-resolver/write-roots.js";
import { captureAgentOutputDeliverable } from "./auto-capture-runtime.js";

/**
 * Historical backfill (Option B2): scan the caller's OWN employee steward (大白) session
 * transcripts for explicitly DECLARED deliverables (`<<DELIVERABLE ...>>` envelopes) and collect
 * them into 成果中心 — generalizing historical catch-up beyond produced files to declared
 * file/url/text deliverables.
 *
 * Safety / correctness:
 * - Owner-scoped: a steward transcript is processed only when its session `cwd` is the caller's
 *   robot own space (historical leftover employee/L2 paths remain readable equivalents).
 *   own per-user steward workspace dir, so one employee never sees another's (the shared steward
 *   sessions dir holds every employee's transcripts).
 * - Only TAG envelopes (`<<DELIVERABLE ...>>`) are honored — never the heuristic 「」 quote form —
 *   so backfill collects explicit declarations only, not arbitrary chat prose.
 * - Latest-wins: capture uses logical-identity dedup, so revisions of one deliverable across the
 *   transcript collapse into a single final 成果 entry.
 * - Idempotent + bounded: a per-user marker skips rescanning; file count / size / per-session
 *   declaration count are capped; best-effort (never throws).
 *
 * NOTE: existing transcripts predate the declaration prompt, so this yields little on current data;
 * it is the correct forward-looking generalization and complements the go-forward chat-time capture.
 */

const MAX_SESSION_FILES = 300;
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const MAX_DECLARATIONS_PER_SESSION = 50;

export type StewardSessionBackfillResult = {
  scannedSessions: number;
  captured: number;
};

function sessionBackfillMarkerPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
  return path.join(CONFIG_DIR, "knowledge", "steward-session-backfill", `${safe}.done`);
}

function writeMarker(markerPath: string): void {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`, "utf8");
  } catch {
    // Marker is a perf optimization only; per-message + identity dedup still guarantee correctness.
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The transcript's first `{type:"session"}` line carries `cwd` (the per-user workspace dir). */
function extractSessionCwd(lines: string[]): string | null {
  for (const line of lines.slice(0, 4)) {
    const obj = parseJsonLine(line);
    if (obj?.type === "session" && typeof obj.cwd === "string" && obj.cwd.trim()) {
      return obj.cwd.trim();
    }
  }
  return null;
}

/** Extract assistant text from a `{type:"message", message:{role, content}}` transcript line. */
function extractAssistantText(obj: Record<string, unknown>): string | null {
  const inner =
    obj.message && typeof obj.message === "object" && !Array.isArray(obj.message)
      ? (obj.message as Record<string, unknown>)
      : obj;
  if (inner.role !== "assistant") {
    return null;
  }
  const content = inner.content;
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (
          !part ||
          typeof part !== "object" ||
          (part as Record<string, unknown>).type !== "text"
        ) {
          return "";
        }
        const textValue = (part as Record<string, unknown>).text;
        return typeof textValue === "string" ? textValue : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}

export function backfillStewardSessionDeliverables(params: {
  userId: string;
  /** Override the steward sessions dir (tests). Defaults to the builtin steward transcripts dir. */
  sessionsDir?: string;
  /** Override the owner-filter workspace dir (tests). Defaults to the caller's steward workspace. */
  expectedCwd?: string;
  force?: boolean;
  captureLedgerPath?: string;
}): StewardSessionBackfillResult {
  const userId = params.userId.trim();
  if (!userId) {
    return { scannedSessions: 0, captured: 0 };
  }
  const markerPath = sessionBackfillMarkerPath(userId);
  if (!params.force) {
    try {
      if (fs.existsSync(markerPath)) {
        return { scannedSessions: 0, captured: 0 };
      }
    } catch {
      // treat as not-done
    }
  }

  const sessionsDir =
    params.sessionsDir ?? resolveSessionTranscriptsDirForAgent(BUILTIN_STEWARD_AGENT_ID);
  const canonicalCwd = resolveRobotWriteRoot({
    agentId: BUILTIN_STEWARD_AGENT_ID,
    userId,
  });
  const allowedCwds = new Set(
    [
      params.expectedCwd,
      canonicalCwd,
      ...listPollutingRobotOwnWorkspaceDirs({
        userId,
        agentId: BUILTIN_STEWARD_AGENT_ID,
      }),
    ]
      .filter((dir): dir is string => Boolean(dir?.trim()))
      .map((dir) => path.resolve(dir)),
  );
  const sessionKey = buildEmployeeBuiltinStewardSessionKey(userId);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    writeMarker(markerPath);
    return { scannedSessions: 0, captured: 0 };
  }

  let scannedSessions = 0;
  let captured = 0;
  for (const entry of entries) {
    if (scannedSessions >= MAX_SESSION_FILES) {
      break;
    }
    // Active transcripts (*.jsonl) and rotated history (*.jsonl.reset.*), but not lock files.
    if (!entry.isFile() || !entry.name.includes(".jsonl") || entry.name.endsWith(".lock")) {
      continue;
    }
    const fullPath = path.join(sessionsDir, entry.name);
    let content: string;
    try {
      if (fs.statSync(fullPath).size > MAX_SESSION_BYTES) {
        continue;
      }
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).filter(Boolean);
    const cwd = extractSessionCwd(lines);
    // Owner filter: only this caller's own steward sessions (shared dir holds all employees').
    if (!cwd || !allowedCwds.has(path.resolve(cwd))) {
      continue;
    }
    scannedSessions += 1;

    let declarationsInSession = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (declarationsInSession >= MAX_DECLARATIONS_PER_SESSION) {
        break;
      }
      const obj = parseJsonLine(lines[index] ?? "");
      if (!obj) {
        continue;
      }
      const text = extractAssistantText(obj);
      if (!text) {
        continue;
      }
      const envelope = extractDeliverableEnvelope(text);
      // Explicit tag declarations only — never the heuristic 「」 quote form.
      if (!envelope || envelope.kind !== "tag") {
        continue;
      }
      const deliverableArtifact = envelope.file
        ? ({ previewKind: "file", filename: envelope.file } as const)
        : envelope.url
          ? ({ previewKind: "published", url: envelope.url } as const)
          : undefined;
      const title = envelope.title ?? envelope.file ?? "对话成果";
      const captureContent = envelope.body || `已归档成果：${title}`;
      const result = captureAgentOutputDeliverable({
        agentId: BUILTIN_STEWARD_AGENT_ID,
        title,
        content: captureContent,
        sessionKey,
        // Stable per (transcript, line) key so re-runs dedupe; identity dedup folds revisions.
        messageId: `backfill-session:${entry.name}:${index}`,
        contextId: sessionKey,
        force: true,
        tags: ["backfill", "session"],
        ...(deliverableArtifact ? { deliverableArtifact } : {}),
        captureLedgerPath: params.captureLedgerPath,
      });
      if (result.captured) {
        declarationsInSession += 1;
        captured += 1;
      }
    }
  }

  writeMarker(markerPath);
  return { scannedSessions, captured };
}
