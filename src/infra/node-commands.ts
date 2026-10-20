export const NODE_SYSTEM_RUN_COMMANDS = [
  "system.run.prepare",
  "system.run",
  "system.which",
] as const;

export const NODE_SYSTEM_NOTIFY_COMMAND = "system.notify";
export const NODE_BROWSER_PROXY_COMMAND = "browser.proxy";

export const NODE_EXEC_APPROVALS_COMMANDS = [
  "system.execApprovals.get",
  "system.execApprovals.set",
] as const;

/**
 * Read-only local file commands.
 *
 * The exclusive `local-files-readonly` profile declares only these five.
 * A paired Mac also declares them beside `system.run`. The macOS allowlist
 * includes them so the handshake does not strip them; the node still refuses
 * a call that has no signed capability.
 * See docs/design/openbot-local-disk-read-grant-2026-09-29.md section 4.2.
 */
export const NODE_LOCAL_FILES_READONLY_COMMANDS = [
  "fs.stat",
  "fs.list",
  "fs.read",
  "archive.list",
  "archive.readEntry",
] as const;

/** Development Supervisor worker commands executed on Node Agent (M5). */
export const SUPERVISOR_WORKER_DISPATCH_COMMAND = "supervisor.worker.dispatch";
export const SUPERVISOR_WORKER_PROBE_COMMAND = "supervisor.worker.probe";
export const SUPERVISOR_WORKER_CANCEL_COMMAND = "supervisor.worker.cancel";

export const SUPERVISOR_WORKER_NODE_COMMANDS = [
  SUPERVISOR_WORKER_DISPATCH_COMMAND,
  SUPERVISOR_WORKER_PROBE_COMMAND,
  SUPERVISOR_WORKER_CANCEL_COMMAND,
] as const;

/** Node → gateway progress while a supervisor worker dispatch is in flight (M5). */
export const SUPERVISOR_WORKER_PROGRESS_EVENT = "supervisor.worker.progress";
