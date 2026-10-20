/**
 * supervisor/node-sessions.ts — read-only connected node summaries for supervisor UI/API.
 */

import { SUPERVISOR_WORKER_NODE_COMMANDS } from "../../infra/node-commands.js";
import type { NodeRegistry, NodeSession } from "../node-registry.js";

export type SupervisorNodeSessionSummary = {
  nodeId: string;
  online: true;
  displayName?: string;
  platform?: string;
  version?: string;
  connectedAtMs: number;
  supervisorWorkerCommands: string[];
  supportsSupervisorWorker: boolean;
};

export function listSupervisorNodeSessions(
  nodeRegistry: NodeRegistry,
): SupervisorNodeSessionSummary[] {
  return nodeRegistry.listConnected().map((session) => summarizeNodeSession(session));
}

export function summarizeNodeSession(session: NodeSession): SupervisorNodeSessionSummary {
  const declared = new Set(session.commands);
  const supervisorWorkerCommands = SUPERVISOR_WORKER_NODE_COMMANDS.filter((command) =>
    declared.has(command),
  );
  return {
    nodeId: session.nodeId,
    online: true,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    ...(session.platform ? { platform: session.platform } : {}),
    ...(session.version ? { version: session.version } : {}),
    connectedAtMs: session.connectedAtMs,
    supervisorWorkerCommands,
    supportsSupervisorWorker: supervisorWorkerCommands.includes("supervisor.worker.dispatch"),
  };
}
