import type { TaskActionBoundary } from "../agent-runtime/state/task-action.js";
import type { SeatPolicyControls } from "../gateway/seat-rules/priority-compiler.js";
import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";
import type { SafeBinProfileFixture } from "../infra/exec-safe-bin-policy.js";
import type { LocalExecPermissionDecision } from "../infra/local-exec-permission.js";
import type { BashSandboxConfig } from "./bash-tools.shared.js";

export type ExecToolDefaults = {
  taskBoundary?: TaskActionBoundary;
  host?: ExecHost;
  security?: ExecSecurity;
  ask?: ExecAsk;
  /**
   * 席位在企业天花板内的收紧偏好。不能放宽 ask / security，也不能改 host。
   */
  seatExecPreference?: Pick<SeatPolicyControls, "security" | "ask" | "host">;
  /**
   * Node bound to the active operator seat. When set, bounded Desktop commands
   * may request host=node even if tools.exec.host stays sandbox.
   */
  operatorComputerNodeId?: string;
  /** Skip the Desktop permission card after Always Allow for this seat↔node. */
  operatorComputerAlwaysAllowDesktop?: boolean;
  /**
   * Active seat identity used to persist Always Allow (始终授权) as a durable
   * operator↔computer binding when the user approves.
   */
  operatorComputerBindingTarget?: {
    tenantId: string;
    seatId: string;
    operatorUserId: string;
  };
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  safeBinTrustedDirs?: string[];
  safeBinProfiles?: Record<string, SafeBinProfileFixture>;
  agentId?: string;
  backgroundMs?: number;
  timeoutSec?: number;
  approvalRunningNoticeMs?: number;
  sandbox?: BashSandboxConfig;
  elevated?: ExecElevatedDefaults;
  allowBackground?: boolean;
  scopeKey?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  messageProvider?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  accountId?: string;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  cwd?: string;
  /**
   * When true (tools.fs.workspaceOnly / forceWorkspaceOnly), host exec
   * mutations targeting paths outside workspaceRoot are denied by the
   * shared-fs-resource INTERSECT SoT (write-deny ⇒ exec-deny for that path).
   */
  workspaceOnly?: boolean;
  /** Workspace root for shared-fs INTERSECT; defaults to cwd when unset. */
  workspaceRoot?: string;
};

export type ExecElevatedDefaults = {
  enabled: boolean;
  allowed: boolean;
  defaultLevel: "on" | "off" | "ask" | "full";
};

export type ExecToolDetails =
  | {
      status: "running";
      sessionId: string;
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      aggregated: string;
      cwd?: string;
    }
  | {
      status: "approval-pending";
      approvalId: string;
      approvalSlug: string;
      expiresAtMs: number;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      nodeDisplayName?: string;
      /** Present for host=node. Same three decisions as exec.approval.resolve. */
      allowedDecisions?: readonly LocalExecPermissionDecision[];
      localExecution?: boolean;
      warningText?: string;
    }
  | {
      status: "approval-unavailable";
      reason:
        | "initiating-platform-disabled"
        | "initiating-platform-unsupported"
        | "no-approval-route";
      channelLabel?: string;
      sentApproverDms?: boolean;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
      nodeDisplayName?: string;
      warningText?: string;
    };
