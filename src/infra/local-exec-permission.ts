import type { ExecApprovalDecision } from "./exec-approvals.js";

/**
 * Chat-facing local computer permission.
 *
 * Grok's Always / Once / Never card maps onto the existing exec-approval
 * decisions. It does not introduce a second runtime or a machine-wide `full`
 * grant. `allow-always` still persists the approved executable on the node
 * allowlist, and for the bounded Desktop path also persists the operator↔computer
 * binding so later Desktop-class ops can skip the card; `deny` rejects only this request.
 */
export const LOCAL_EXEC_PERMISSION_DECISIONS = [
  "allow-once",
  "allow-always",
  "deny",
] as const satisfies readonly ExecApprovalDecision[];

export type LocalExecPermissionDecision = (typeof LOCAL_EXEC_PERMISSION_DECISIONS)[number];

export const LOCAL_EXEC_PERMISSION_LABEL: Record<LocalExecPermissionDecision, string> = {
  "allow-always": "Always Allow",
  "allow-once": "Allow Once",
  deny: "Never",
};

/** Chinese card labels (本次授权 / 始终授权). Decision values stay allow-once|allow-always|deny. */
export const LOCAL_EXEC_PERMISSION_LABEL_ZH: Record<LocalExecPermissionDecision, string> = {
  "allow-always": "始终授权",
  "allow-once": "本次授权",
  deny: "拒绝",
};

export function isLocalExecHost(host: string | null | undefined): boolean {
  return host === "node";
}

export function formatLocalMachineLabel(params: {
  displayName?: string | null;
  nodeId?: string | null;
}): string {
  const name = params.displayName?.trim();
  if (name) {
    return name;
  }
  const nodeId = params.nodeId?.trim();
  if (nodeId) {
    return nodeId;
  }
  return "this computer";
}

/**
 * Display name stamped onto an exec-approval broadcast.
 * An explicit client name wins. When the requester omits it (CLI `nodes run`,
 * or a node list entry without `displayName`), the connected node's registry
 * name is used. The raw node id is never invented here.
 */
export function resolveBroadcastNodeDisplayName(params: {
  host?: string | null;
  supplied?: unknown;
  registryDisplayName?: unknown;
}): string | null {
  if (params.host !== "node") {
    return null;
  }
  return (
    normalizeLocalMachineDisplayName(params.supplied) ??
    normalizeLocalMachineDisplayName(params.registryDisplayName)
  );
}

export function normalizeLocalMachineDisplayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 128);
}

const DESKTOP_FILE_NAME_MAX = 180;
const DESKTOP_DELIM_RE = /^OB_DESKTOP(?:_[0-9a-f]{8})?$/;

/**
 * One path segment under the user's Desktop.
 * Hidden names and shell metacharacters stay off this route.
 */
export function isSafeDesktopFileName(fileName: string): boolean {
  if (!fileName || fileName.length > DESKTOP_FILE_NAME_MAX) {
    return false;
  }
  if (fileName.startsWith(".")) {
    return false;
  }
  for (const char of fileName) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) {
      return false;
    }
    if ("/\\`$;&|<>\"'".includes(char)) {
      return false;
    }
  }
  return true;
}

/**
 * A workspace `write` path that means the user's own Desktop file.
 * Directory-only paths and nested folders are not this route.
 */
export function parseLocalDesktopSaveTarget(rawPath: string): { fileName: string } | null {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }
  const home = trimmed.match(/^(?:~|\$HOME|\$\{HOME\})\/Desktop\/([^/]+)$/);
  const absolute = trimmed.match(/^\/(?:Users|home)\/[^/]+\/Desktop\/([^/]+)$/);
  const fileName = home?.[1] ?? absolute?.[1];
  if (!fileName || !isSafeDesktopFileName(fileName)) {
    return null;
  }
  return { fileName };
}

function desktopSaveDelimiter(content: string): string {
  const lines = content.split("\n");
  if (!lines.includes("OB_DESKTOP")) {
    return "OB_DESKTOP";
  }
  let digest = 0;
  for (let i = 0; i < content.length; i += 1) {
    digest = (digest * 33 + content.charCodeAt(i)) >>> 0;
  }
  const delim = `OB_DESKTOP_${digest.toString(16).padStart(8, "0").slice(0, 8)}`;
  if (lines.includes(delim)) {
    throw new Error("Desktop file content collides with the save delimiter");
  }
  return delim;
}

/**
 * The only shell form that may save a deliverable onto the paired computer.
 * Quoted heredoc, one file under `$HOME/Desktop`, no extra commands.
 */
export function buildDesktopSaveExecCommand(params: { fileName: string; content: string }): string {
  if (!isSafeDesktopFileName(params.fileName)) {
    throw new Error("Desktop file name is not allowed");
  }
  const delim = desktopSaveDelimiter(params.content);
  return `cat > "$HOME/Desktop/${params.fileName}" <<'${delim}'\n${params.content}\n${delim}`;
}

function fileNameFromDesktopRedirect(raw: string): string | null {
  const match = raw.match(/^"\$HOME\/Desktop\/([^"]+)"$/);
  if (!match?.[1] || !isSafeDesktopFileName(match[1])) {
    return null;
  }
  return match[1];
}

function isPrintfDesktopSave(command: string): boolean {
  if (command.includes("\n") || /[;&|`]/.test(command) || command.includes("$(")) {
    return false;
  }
  const match = command.match(/^printf '(?:[^']|\\')*' > ("\$HOME\/Desktop\/[^"]+")$/);
  return match?.[1] != null && fileNameFromDesktopRedirect(match[1]) != null;
}

function isCatDesktopSave(command: string): boolean {
  const normalized = command.replace(/\r\n/g, "\n");
  const header = normalized.match(
    /^cat > ("\$HOME\/Desktop\/[^"]+") <<'(OB_DESKTOP(?:_[0-9a-f]{8})?)'\n/,
  );
  if (!header?.[1] || !header[2] || !DESKTOP_DELIM_RE.test(header[2])) {
    return false;
  }
  if (!fileNameFromDesktopRedirect(header[1])) {
    return false;
  }
  const bodyStart = header[0].length;
  const closer = `\n${header[2]}`;
  if (!normalized.endsWith(closer) && !normalized.endsWith(`${closer}\n`)) {
    return false;
  }
  const end = normalized.endsWith(`${closer}\n`)
    ? normalized.length - closer.length - 1
    : normalized.length - closer.length;
  if (end < bodyStart) {
    return false;
  }
  const body = normalized.slice(bodyStart, end);
  return !body.split("\n").includes(header[2]);
}

/** True only for the documented Desktop save command, not a general shell. */
export function isDesktopSaveExecCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  return isCatDesktopSave(trimmed) || isPrintfDesktopSave(trimmed);
}

/** Node exec of a Desktop save is the paired computer, not a sandbox escape. */
export function desktopSaveRunsOnNode(host: string, command: string): boolean {
  return host === "node" && isDesktopSaveExecCommand(command);
}

export function formatDesktopSaveRoutingError(params: {
  fileName: string;
  content?: string;
}): string {
  const command =
    params.content == null
      ? `cat > "$HOME/Desktop/${params.fileName}" <<'OB_DESKTOP'\n<file contents>\nOB_DESKTOP`
      : buildDesktopSaveExecCommand({ fileName: params.fileName, content: params.content });
  return [
    "This path is the user's own Desktop, not the workspace.",
    'Call exec with host "node" and exactly this command, then wait for Always Allow / Allow Once / Never:',
    command,
    "Do not call write or edit for this file. A previous Desktop list does not approve the write.",
  ].join("\n");
}

export function buildLocalDesktopSavePromptLines(execToolName: string): string[] {
  return [
    "## Local Desktop",
    "Saving a deliverable onto the user's own computer Desktop (本机桌面, ~/Desktop, /Users/<name>/Desktop) is not a workspace file.",
    `Do not call write, edit, or apply_patch for that path. Call ${execToolName} with host "node" and a command that writes only "$HOME/Desktop/<file>" (cat > "$HOME/Desktop/<file>" <<'OB_DESKTOP', or base64 -d for a binary file).`,
    "While tools.exec.host stays sandbox, host=node is allowed for the bounded Desktop write/probe set so the chat can show 本次授权 / 始终授权. Other host=node commands are denied.",
    "The sandbox home directory is not the Mac Desktop. While waiting for the card, say 等待授权 — never say the computer is missing or tell the user to open settings.",
    "The chat shows 始终授权 (Always Allow) / 本次授权 (Allow Once) / 拒绝 (Never) before the command runs. A previous read or list of the Desktop does not approve the write.",
    "The right-pane cloud computer is not this Desktop.",
    "Personal email is user_operational_identity, not mail or sendmail in exec.",
  ];
}

export function buildLocalExecPermissionLines(params: { machineLabel: string }): string[] {
  return [
    "Allow OpenBot and all bots to run commands on this computer?",
    `Machine: ${params.machineLabel}`,
    "始终授权 (Always Allow) → allow-always (remembers this command on the node allowlist and persists operator↔this computer for bounded Desktop ops; it does not grant unrestricted shell).",
    "本次授权 (Allow Once) → allow-once (this approved command / turn only; no durable computer binding).",
    "拒绝 (Never) → deny (this request). Set exec approvals security=deny to stop prompting.",
    "Applies to OpenBot and every bot. Change it under Nodes → Exec approvals.",
  ];
}
