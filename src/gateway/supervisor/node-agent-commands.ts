export {
  SUPERVISOR_WORKER_CANCEL_COMMAND,
  SUPERVISOR_WORKER_DISPATCH_COMMAND,
  SUPERVISOR_WORKER_NODE_COMMANDS,
  SUPERVISOR_WORKER_PROBE_COMMAND,
  SUPERVISOR_WORKER_PROGRESS_EVENT,
} from "../../infra/node-commands.js";

export type SupervisorWorkerDispatchResult = {
  summary?: string;
  exitCode?: number;
  usage?: { input?: number; output?: number };
};

export type SupervisorWorkerProbeResult = {
  installed: boolean;
  authenticated: boolean;
  status?: "missing" | "configured" | "validated" | "expired" | "invalid";
  reason?: string;
};
