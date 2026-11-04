/**
 * AI 执行入口注册表 — No-bypass 审计真源。
 *
 * 每个入口必须经 `authorizeCommercialRun` / `tryAcquireEnterpriseAgentRun` 占槽。
 * `scripts/audit-commercial-run-entrypoints.ts` 与单测对照此表做静态校验。
 */

export type CommercialRunEntrypoint = {
  id: string;
  label: string;
  /** 仓库相对路径（精确路径；入口文件）。 */
  paths: string[];
  /**
   * 闸口 owner 文件（委托链末端）。审计时这些文件必须包含 requiredGateSymbols。
   * 若省略，则 paths 自身必须包含符号。
   */
  gateOwnerPaths?: string[];
  /** 必须出现的闸口符号（任一匹配即通过）。 */
  requiredGateSymbols: string[];
  /** 说明性备注。 */
  notes?: string;
};

export const COMMERCIAL_RUN_ENTRYPOINTS: readonly CommercialRunEntrypoint[] = [
  {
    id: "agent_run_governance_hub",
    label: "Commercial agent run governance hub",
    paths: ["src/gateway/billing/agent-run-governance.ts"],
    requiredGateSymbols: ["authorizeCommercialRun"],
  },
  {
    id: "agent_run_embedded",
    label: "Agent Run (embedded Pi)",
    paths: [
      "src/agent-runtime/execution/runner/admitted-turn.ts",
      "src/auto-reply/reply/followup-runner.ts",
    ],
    requiredGateSymbols: ["tryAcquireEnterpriseAgentRun"],
  },
  {
    id: "chat_reply_pipeline",
    label: "Chat / message reply pipeline",
    paths: ["src/auto-reply/reply/get-reply-run.ts", "src/auto-reply/reply/agent-runner.ts"],
    requiredGateSymbols: ["runReplyAgent", "runAdmittedTurn"],
    notes:
      "Chat ingress delegates to the admitted-turn execution API and mandatory host admission port.",
  },
  {
    id: "gateway_agent_api",
    label: "Gateway agent RPC (Chat / API / Control UI)",
    paths: ["src/gateway/server-methods/agent.ts"],
    requiredGateSymbols: ["agentCommandFromIngress"],
    notes: "RPC dispatches to embedded Pi path which acquires commercial run slot.",
  },
  {
    id: "cron_isolated_agent",
    label: "Cron / Automation isolated agent",
    paths: ["src/cron/isolated-agent/run.ts"],
    requiredGateSymbols: ["tryAcquireEnterpriseAgentRun"],
  },
  {
    id: "resources_high_tier",
    label: "Resources API high-tier gate",
    paths: ["src/gateway/server-methods/resources.ts"],
    requiredGateSymbols: ["authorizeCommercialRun"],
  },
  {
    id: "supervisor_gateway_worker",
    label: "Supervisor / Workflow gateway worker",
    paths: ["src/gateway/supervisor/worker-executor.ts"],
    requiredGateSymbols: ["acquireSupervisorCommercialRun"],
  },
  {
    id: "supervisor_commercial_gate",
    label: "Supervisor commercial run gate",
    paths: ["src/gateway/supervisor/commercial-run-gate.ts"],
    requiredGateSymbols: ["tryAcquireEnterpriseAgentRun"],
  },
  {
    id: "cli_agent_command",
    label: "CLI agent command",
    paths: ["src/commands/agent.ts", "src/commands/agent/commercial-run-gate.ts"],
    requiredGateSymbols: ["acquireAgentCommandCommercialRun", "tryAcquireEnterpriseAgentRun"],
  },
  {
    id: "supervisor_task_create",
    label: "Supervisor task create RPC",
    paths: ["src/gateway/server-methods/supervisor.ts"],
    gateOwnerPaths: [
      "src/gateway/supervisor/task-create-service.ts",
      "src/gateway/supervisor/commercial-run-gate.ts",
    ],
    requiredGateSymbols: [
      "createSupervisedTask",
      "assertSupervisorTenantCommercialCapacity",
      "tryAcquireEnterpriseAgentRun",
    ],
    notes:
      "RPC delegates to createSupervisedTask → assertSupervisorTenantCommercialCapacity / commercial-run-gate.",
  },
  {
    id: "supervisor_task_create_service",
    label: "Supervisor task create service (capacity gate owner)",
    paths: ["src/gateway/supervisor/task-create-service.ts"],
    requiredGateSymbols: ["assertSupervisorTenantCommercialCapacity"],
    notes: "Real commercial capacity gate before enqueueing supervised tasks.",
  },
  {
    id: "supervisor_tenant_capacity",
    label: "Supervisor tenant commercial capacity",
    paths: ["src/gateway/supervisor/tenant-commercial-capacity.ts"],
    requiredGateSymbols: ["resolveSupervisorTenantCommercialCapacity"],
  },
  {
    id: "lifecycle_candidate_run",
    label: "Schedule/meeting lifecycle LLM candidate producer",
    paths: ["src/gateway/lifecycle/gated-candidate-run.ts"],
    requiredGateSymbols: ["tryAcquireEnterpriseAgentRun"],
    notes:
      "Phase C1: gated LLM->candidate boundary; non-enterprise (skipped) does not call the model.",
  },
] as const;
