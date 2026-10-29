/**
 * Classify recoverable exec/tool-digest failures and drive a bounded continue
 * instead of stopping on PROTOCOL_FAILURE_USER_TEXT / 「请重试」.
 *
 * Classes: sandbox_runtime | path_missing | export_empty.
 * Wired beside execution-stall-continue (same bounded loop in attempt.ts).
 */
import { PROTOCOL_FAILURE_USER_TEXT } from "./model-output-boundary.js";

export const RECOVERABLE_TOOL_FAILURE_KINDS = [
  "sandbox_runtime",
  "path_missing",
  "export_empty",
] as const;

export type RecoverableToolFailureKind = (typeof RECOVERABLE_TOOL_FAILURE_KINDS)[number];

export const RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT = 2;

export const RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT =
  "Internal execution continue: a recoverable tool failure just occurred (sandbox runtime, missing path, or empty export). Do not stop with 「请重试」. Retry with a corrected path or fallback (for example HTML→print PDF). Use any workspace_root absolute path from the tool error. Stop only for a real permission, payment/scan, or a fact only the user knows.";

const SANDBOX_RUNTIME_RE =
  /(?:Sandbox mode requires Docker|docker not found|Docker.*not (?:found|available)|Managed multitenant sandbox|container (?:exited|not running)|Cannot connect to the Docker daemon|exec host=sandbox.*unavailable)/iu;

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
  if (!root) {
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
  const toolBlob = blobFromTools(params.tools ?? []);
  const visible = (params.visibleTexts ?? []).join("\n");
  const combined = [stop, toolBlob, visible].filter(Boolean).join("\n");
  const kind =
    classifyRecoverableToolFailure(toolBlob) ||
    classifyRecoverableToolFailure(combined) ||
    classifyRecoverableToolFailure(stop);
  if (!kind) {
    return false;
  }
  // Prefer continuing when the model asked the user to retry, emitted the
  // protocol-failure copy, or stopped right after a failed recoverable tool.
  const failedTools = (params.tools ?? []).some((tool) => tool.success === false);
  if (
    stop === PROTOCOL_FAILURE_USER_TEXT ||
    RETRY_ASK_RE.test(stop) ||
    failedTools ||
    classifyRecoverableToolFailure(stop)
  ) {
    return true;
  }
  return false;
}

export function recoverableToolFailureKindFromParams(params: {
  stopText: string;
  tools?: readonly RecoverableToolFailureTool[];
  visibleTexts?: readonly string[];
}): RecoverableToolFailureKind | null {
  const toolBlob = blobFromTools(params.tools ?? []);
  const combined = [params.stopText, toolBlob, ...(params.visibleTexts ?? [])]
    .filter(Boolean)
    .join("\n");
  return (
    classifyRecoverableToolFailure(toolBlob) ||
    classifyRecoverableToolFailure(combined) ||
    classifyRecoverableToolFailure(params.stopText)
  );
}
