/**
 * Blocks unsupervised IDE CLI usage when Development Supervisor is enabled.
 *
 * Target: default chat agent paths (model=codex-cli / exec invoking codex…) — NOT
 * `supervisor.task.create` → WorkerExecutor → runCliAgent({ supervisedRun: true }).
 */

import { createWorkerFromBackend } from "../../agents/cli-backend-worker.js";
import { FailoverError } from "../../agents/failover-error.js";
import type { OpenBotConfig } from "../../config/config.js";
import { isExplicitIdeRequest } from "../server-methods/daibai-supervisor-draft.js";
import { isSupervisorEnabled } from "./feature.js";

export const FREE_CHAT_CLI_BLOCKED_MESSAGE =
  "开发监督已启用：不能通过自由聊天直接运行 IDE CLI 修改仓库。请在员工工作台 → 大白助手创建「开发监督任务」，或打开「我的任务 → 开发监督」手动建任务。";

const noopCliRun = async () => ({
  ok: false as const,
  exitCode: 1,
  stdout: "",
  stderr: "",
});

/** CLI backend declares a Fabric Worker surface (supervisor-governed). */
export function isSupervisorGovernedCliBackend(backendId: string, cfg?: OpenBotConfig): boolean {
  const id = backendId.trim();
  if (!id) {
    return false;
  }
  return createWorkerFromBackend(cfg, id, noopCliRun) !== null;
}

export function assertFreeChatCliRunAllowed(params: {
  backendId: string;
  config?: OpenBotConfig;
  /** Set by Supervisor WorkerExecutor only. */
  supervisedRun?: boolean;
}): void {
  if (params.supervisedRun) {
    return;
  }
  if (!isSupervisorEnabled()) {
    return;
  }
  if (!isSupervisorGovernedCliBackend(params.backendId, params.config)) {
    return;
  }
  throw new FailoverError(FREE_CHAT_CLI_BLOCKED_MESSAGE, {
    reason: "unknown",
    provider: params.backendId.trim(),
    status: 403,
  });
}

/** Detect shell/exec invocations that bypass runCliAgent but spawn IDE CLIs directly. */
export function detectUnsupervisedIdeCliShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  const patterns = [
    /(?:^|[|;&]\s*)codex(?:\s+exec|\s+)/i,
    /(?:^|[|;&]\s*)traecli(?:\s+exec|\s+)/i,
    /(?:^|[|;&]\s*)trae-cli(?:\s+exec|\s+)/i,
    /(?:^|[|;&]\s*)cursor-agent\b/i,
    /(?:^|[|;&]\s*)cursor\s+--/i,
    /(?:^|[|;&]\s*)devin(?:\s+|-)/i,
    /(?:^|[|;&]\s*)kiro(?:\s+|-)/i,
    /(?:^|[|;&]\s*)claude\s+(?:-p|--print)/i,
    /(?:^|[|;&]\s*)grok(?:\s+|-)/i,
  ];
  return patterns.some((pattern) => pattern.test(trimmed));
}

export function assertFreeChatExecCommandAllowed(params: {
  command: string;
  supervisedRun?: boolean;
}): void {
  if (params.supervisedRun) {
    return;
  }
  if (!isSupervisorEnabled()) {
    return;
  }
  if (!detectUnsupervisedIdeCliShellCommand(params.command)) {
    return;
  }
  throw new Error(FREE_CHAT_CLI_BLOCKED_MESSAGE);
}

function throwFreeChatSessionsSpawnBlocked(): never {
  throw new Error(FREE_CHAT_CLI_BLOCKED_MESSAGE);
}

/** Block sessions_spawn bypass of supervised IDE CLI (subagent / ACP) in free chat. */
export function assertFreeChatSessionsSpawnAllowed(params: {
  task: string;
  runtime?: "subagent" | "acp";
  model?: string;
  config?: OpenBotConfig;
  supervisedRun?: boolean;
}): void {
  if (params.supervisedRun) {
    return;
  }
  if (!isSupervisorEnabled()) {
    return;
  }
  if (params.runtime === "acp") {
    throwFreeChatSessionsSpawnBlocked();
  }
  const model = params.model?.trim();
  if (model && isSupervisorGovernedCliBackend(model, params.config)) {
    throwFreeChatSessionsSpawnBlocked();
  }
  if (isExplicitIdeRequest(params.task)) {
    throwFreeChatSessionsSpawnBlocked();
  }
}
