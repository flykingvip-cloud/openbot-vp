/**
 * Classify recoverable exec/tool-digest failures and drive a bounded continue
 * instead of stopping on PROTOCOL_FAILURE_USER_TEXT / 「请重试」.
 *
 * Classes: sandbox_runtime | path_missing | export_empty.
 * Wired beside execution-stall-continue (same bounded loop in attempt.ts).
 */
import { PROTOCOL_FAILURE_USER_TEXT } from "./model-output-boundary.js";
import { shouldSuppressRecoverableContinueForUnknownWrite } from "./write-side-retry-gate.js";

export const RECOVERABLE_TOOL_FAILURE_KINDS = [
  "sandbox_runtime",
  "path_missing",
  "export_empty",
] as const;

export type RecoverableToolFailureKind = (typeof RECOVERABLE_TOOL_FAILURE_KINDS)[number];

export const RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT = 2;

export const RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT =
  "Internal execution continue: a recoverable tool failure just occurred (sandbox runtime, missing path, or empty export). Do not stop with 「请重试」. Retry with a corrected path or fallback (for example HTML→print PDF). Use any workspace_root absolute path from the tool error. Stop only for a real permission, payment/scan, or a fact only the user knows.";

/** Permanent / non-retryable failures — never classify as recoverable. */
const PERMANENT_FAILURE_RE =
  /(?:permission denied|EACCES|EPERM|access denied|not authorized|unauthorized|forbidden|invalid argument|EINVAL|bad arguments?|unknown option|usage:|cron_account:missing|requires a server-derived account|Managed multitenant sandbox requires)/iu;

const SANDBOX_RUNTIME_RE =
  /(?:Sandbox mode requires Docker|docker not found|Docker.*not (?:found|available)|container (?:exited|not running)|Cannot connect to the Docker daemon|exec host=sandbox.*unavailable)/iu;

const PATH_MISSING_RE =
  /(?:No such file or directory|ENOENT|can't cd|cannot cd|cd: .*(?:No such|not a directory)|no such file|目录不存在|路径不存在)/iu;

const EXPORT_EMPTY_RE =
  /(?:export[_\s-]?empty|empty (?:export|pptx|pdf|file)|file (?:is )?empty|size\s*[:=]\s*0\b|0\s*bytes|空壳|空文件|导出失败|产物为空|deliverable.*(?:empty|missing)|pdfinfo.*(?:empty|fail))/iu;

const RETRY_ASK_RE = /请重试|请再试|本步工具调用未能执行/u;

export type RecoverableToolFailureTool = {
  toolName?: string;
  meta?: string;
  success?: boolean;
};

export function classifyRecoverableToolFailure(
  text: string | null | undefined,
): RecoverableToolFailureKind | null {
  const blob = (text ?? "").trim();
  if (!blob) {
    return null;
  }
  // Permanent failures win even when the blob also mentions a path/sandbox phrase.
  if (PERMANENT_FAILURE_RE.test(blob)) {
    return null;
  }
  if (SANDBOX_RUNTIME_RE.test(blob)) {
    return "sandbox_runtime";
  }
  if (PATH_MISSING_RE.test(blob)) {
    return "path_missing";
  }
  if (EXPORT_EMPTY_RE.test(blob)) {
    return "export_empty";
  }
  return null;
}

/**
 * Append structured workspace_root=<abs> so the model can recover from cd/path
 * failures without guessing.
 */
export function enrichPathMissingToolError(params: {
  errorText: string;
  workspaceRoot?: string | null;
}): string {
  const text = params.errorText.trim();
  const root = params.workspaceRoot?.trim();
  if (!text) {
    return text;
  }
  // Only attach a trusted absolute workspace root (server/session-derived).
  // Reject relative paths, empties, and model-specified traversal attempts.
  if (
    !root ||
    !root.startsWith("/") ||
    root.includes("..") ||
    root.includes("\r") ||
    root.includes("\n") ||
    root.includes(String.fromCharCode(0))
  ) {
    return text;
  }
  if (/\bworkspace_root=/.test(text)) {
    return text;
  }
  if (!PATH_MISSING_RE.test(text) && !classifyRecoverableToolFailure(text)) {
    // Still attach when caller already decided this is a path failure context.
    if (!/cd |workdir|path|目录|路径/i.test(text)) {
      return text;
    }
  }
  return `${text}\nworkspace_root=${root}`;
}

function blobFromTools(tools: readonly RecoverableToolFailureTool[]): string {
  return tools
    .filter((tool) => tool.success === false)
    .map((tool) => `${tool.toolName ?? ""}\n${tool.meta ?? ""}`)
    .join("\n");
}

/**
 * True when a recent failed tool (or the stop text) is a recoverable class and
 * the assistant stopped with a retry ask / protocol failure copy, or with a
 * short failure summary after that tool. Bounded by continuesUsed.
 */
export function shouldContinueAfterRecoverableToolFailure(params: {
  stopText: string;
  toolsDisabled: boolean;
  continuesUsed?: number;
  tools?: readonly RecoverableToolFailureTool[];
  visibleTexts?: readonly string[];
}): boolean {
  if (params.toolsDisabled) {
    return false;
  }
  if ((params.continuesUsed ?? 0) >= RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT) {
    return false;
  }
  const stop = params.stopText.trim();
  const tools = params.tools ?? [];
  // Write/side-effect with unknown outcome: keep unknown, forbid auto-retry continue.
  if (
    shouldSuppressRecoverableContinueForUnknownWrite({
      tools: tools.map((tool) => ({
        toolName: tool.toolName,
        success: tool.success,
        meta: tool.meta,
        // Default write-ish tools that are not explicitly read-only when meta says unknown.
        sideEffectLevel:
          tool.toolName === "read" ||
          tool.toolName === "web_search" ||
          tool.toolName === "web_fetch" ||
          tool.toolName === "memory_search" ||
          tool.toolName === "memory_get"
            ? "none"
            : "reversible",
      })),
    })
  ) {
    return false;
  }
  const toolBlob = blobFromTools(tools);
  const visible = (params.visibleTexts ?? []).join("\n");
  const kindFromTools = classifyRecoverableToolFailure(toolBlob);
  // When tools ran this turn, classification must come from failed tool results —
  // not from guessed assistant stop text alone.
  if (tools.length > 0) {
    if (!kindFromTools) {
      return false;
    }
    const failedTools = tools.some((tool) => tool.success === false);
    return failedTools || stop === PROTOCOL_FAILURE_USER_TEXT || RETRY_ASK_RE.test(stop);
  }
  // No tool metas available: allow stop/visible text only when it classifies
  // and the assistant asked to retry / emitted protocol-failure copy.
  const kindFromText =
    classifyRecoverableToolFailure(stop) || classifyRecoverableToolFailure(visible);
  if (!kindFromText) {
    return false;
  }
  return stop === PROTOCOL_FAILURE_USER_TEXT || RETRY_ASK_RE.test(stop);
}

export function recoverableToolFailureKindFromParams(params: {
  stopText: string;
  tools?: readonly RecoverableToolFailureTool[];
  visibleTexts?: readonly string[];
}): RecoverableToolFailureKind | null {
  const tools = params.tools ?? [];
  const toolBlob = blobFromTools(tools);
  const fromTools = classifyRecoverableToolFailure(toolBlob);
  if (tools.length > 0) {
    return fromTools;
  }
  return (
    classifyRecoverableToolFailure(params.stopText) ||
    classifyRecoverableToolFailure((params.visibleTexts ?? []).join("\n"))
  );
}
