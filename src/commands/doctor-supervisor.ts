import { formatCliCommand } from "../cli/command-format.js";
import type { OpenBotConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { note } from "../terminal/note.js";

const SECTION = "Development Supervisor";

/** Mirrors the `supervisor.status` gateway payload (ungated; always registered). */
type SupervisorStatusPayload = {
  enabled?: boolean;
  envEnabled?: boolean;
  configEnabled?: boolean;
  runnerEnabled?: boolean;
};

/** Subset of `supervisor.node.list` node summaries needed for the readiness check. */
type SupervisorNodeSummary = {
  nodeId: string;
  supportsSupervisorWorker?: boolean;
};

/** Subset of `supervisor.worker.list` descriptors needed for the readiness check. */
type SupervisorWorkerSummary = {
  backendId: string;
};

/**
 * Development Supervisor readiness check for `openbot doctor`.
 *
 * Verifies the end-to-end chain that lets the employee "本机 Node" panel detect a
 * usable Node and run supervised tasks: subsystem enabled → an online Node that
 * advertises `supervisor.worker.dispatch` → at least one worker-capable CLI backend.
 *
 * Stays silent when the subsystem is disabled (off by default) or fully healthy,
 * matching the surrounding doctor checks; only warns when the operator has opted
 * into supervision but the execution chain is broken.
 */
export async function noteSupervisorReadiness(params: {
  cfg: OpenBotConfig;
  healthOk: boolean;
  timeoutMs?: number;
}): Promise<void> {
  // Gateway unreachable: doctor-gateway-health already reported it; nothing to probe.
  if (!params.healthOk) {
    return;
  }
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : 8_000;

  let status: SupervisorStatusPayload;
  try {
    status = await callGateway<SupervisorStatusPayload>({
      method: "supervisor.status",
      timeoutMs,
      config: params.cfg,
    });
  } catch {
    // `supervisor.status` is ungated and always registered; a failure here means the
    // gateway build predates the check or the probe was transient. Stay silent.
    return;
  }

  // Off by default — not a problem worth flagging during a routine doctor run.
  if (status.enabled !== true) {
    return;
  }

  let nodes: SupervisorNodeSummary[] = [];
  let workers: SupervisorWorkerSummary[] = [];
  const probeErrors: string[] = [];
  try {
    const result = await callGateway<{ nodes?: SupervisorNodeSummary[] }>({
      method: "supervisor.node.list",
      timeoutMs,
      config: params.cfg,
    });
    nodes = result.nodes ?? [];
  } catch (err) {
    probeErrors.push(
      `supervisor.node.list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const result = await callGateway<{ workers?: SupervisorWorkerSummary[] }>({
      method: "supervisor.worker.list",
      timeoutMs,
      config: params.cfg,
    });
    workers = result.workers ?? [];
  } catch (err) {
    probeErrors.push(
      `supervisor.worker.list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (probeErrors.length > 0) {
    note(
      [
        "Development Supervisor is enabled but its readiness could not be fully probed:",
        ...probeErrors.map((line) => `- ${line}`),
        `Verify: ${formatCliCommand("openbot gateway call supervisor.node.list --params '{}'")}`,
      ].join("\n"),
      SECTION,
    );
    return;
  }

  const capableNodes = nodes.filter((node) => node.supportsSupervisorWorker === true);
  const nodeListHint = `Verify: ${formatCliCommand("openbot gateway call supervisor.node.list --params '{}'")}`;

  // Neither execution path is available: no Node for local-IDE CLIs and no
  // worker-capable backend for gateway-host CLIs. Supervised tasks cannot run.
  if (capableNodes.length === 0 && workers.length === 0) {
    note(
      [
        "Development Supervisor is enabled but no execution backend is ready:",
        "- No online Node advertises supervisor.worker.dispatch (local-IDE CLIs cursor/devin/grok/kiro cannot run).",
        "- No CLI backend exposes `worker` metadata (gateway-host CLIs codex/claude cannot run either).",
        "Fix (pick a path):",
        "- Local-IDE path: open Mac OpenBot in Node mode, connect it to this gateway, then bind the seat.",
        `- Gateway path: configure a worker-capable CLI backend (e.g. codex-cli/claude-cli) and its API key via ${formatCliCommand(
          "openbot configure",
        )}.`,
        nodeListHint,
      ].join("\n"),
      SECTION,
    );
    return;
  }

  // No worker-capable CLI backend at all (gateway-host path unavailable).
  if (workers.length === 0) {
    note(
      [
        "Development Supervisor is enabled but no CLI backend exposes `worker` metadata.",
        "Supervised tasks have no execution backend on the gateway host.",
        `Fix: configure a worker-capable CLI backend (e.g. codex-cli/claude-cli) via ${formatCliCommand(
          "openbot configure",
        )}, or rely on a local-IDE Node.`,
      ].join("\n"),
      SECTION,
    );
    return;
  }

  // Workers exist (gateway-host path works) but no Node can run local-IDE CLIs.
  // Informational: only local-IDE CLIs (cursor/devin/grok/kiro) need a Node.
  if (capableNodes.length === 0) {
    if (nodes.length === 0) {
      note(
        [
          `Development Supervisor is enabled with ${workers.length} worker backend(s) (gateway-host execution), but no local Node is online.`,
          "Local-IDE CLIs (cursor/devin/grok/kiro) require a Node; codex/claude run on the gateway host without one.",
          "To use local-IDE CLIs: open Mac OpenBot in Node mode, connect it to this gateway, then bind the seat.",
          nodeListHint,
        ].join("\n"),
        SECTION,
      );
      return;
    }
    note(
      [
        `Development Supervisor: ${nodes.length} node(s) online but none advertise supervisor.worker.dispatch.`,
        "Local-IDE CLIs cannot run on these nodes. Update Mac OpenBot to a version that supports Development Supervisor and keep Node mode online.",
        nodeListHint,
      ].join("\n"),
      SECTION,
    );
    return;
  }

  // Healthy: capable node(s) + worker backend(s) available — stay silent to match
  // the surrounding doctor checks, which only speak up on problems.
}
