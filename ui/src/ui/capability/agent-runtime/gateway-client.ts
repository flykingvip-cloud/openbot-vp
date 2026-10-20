/**
 * `GatewayBrowserClient` 之上的类型化封装，对应 Agent Runtime Center 的 18 个
 * `agent-runtime.*` RPC 端点。
 *
 * 架构作用：
 * 与企业端 / 员工端 Gateway 客户端不同，**本客户端不在网关边界做投影**：因为
 * Agent Runtime Center 的目标用户是平台运维人员，他们正是 Runtime 字段的合法
 * 消费者；运行时数据保持原样直接返回给上层视图。投影只在 Runtime 数据流向
 * 企业端 / 员工端时由 `runtime-canonical/projection.ts` 中的纯函数完成（这通常
 * 发生在事件总线 / 反向同步链路中，不在本客户端内）。
 *
 * 该客户端的形状即 `mock-backend.ts` 在编译期需要满足的契约。
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  AGENT_RUNTIME_ENDPOINTS,
  type AcknowledgeIssueRequest,
  type AcknowledgeIssueResponse,
  type CreateBindingRequest,
  type CreateBindingResponse,
  type DeleteBindingRequest,
  type DeleteBindingResponse,
  type GetAgentRequest,
  type GetAgentResponse,
  type GetBindingRequest,
  type GetBindingResponse,
  type GetGovernanceConfigRequest,
  type GetGovernanceConfigResponse,
  type GetHealthSummaryRequest,
  type GetHealthSummaryResponse,
  type GetLifecycleHistoryRequest,
  type GetLifecycleHistoryResponse,
  type GetRuntimeKpiRequest,
  type GetRuntimeKpiResponse,
  type ListAgentsRequest,
  type ListAgentsResponse,
  type ListBindingsRequest,
  type ListBindingsResponse,
  type ListGovernanceIssuesRequest,
  type ListGovernanceIssuesResponse,
  type ListTelemetryRequest,
  type ListTelemetryResponse,
  type SeedRuntimeRequest,
  type SeedRuntimeResponse,
  type UpsertBindingRequest,
  type UpsertBindingResponse,
  type UpdateBindingPriorityRequest,
  type UpdateBindingPriorityResponse,
  type UpdateBindingStateRequest,
  type UpdateBindingStateResponse,
  type UpdateBindingStrategyRequest,
  type UpdateBindingStrategyResponse,
  type UpdateGovernanceConfigRequest,
  type UpdateGovernanceConfigResponse,
  type UpdateLifecycleRequest,
  type UpdateLifecycleResponse,
} from "./endpoints.ts";

export function createAgentRuntimeGateway(client: GatewayBrowserClient) {
  return {
    // ── Runtime Catalog ──
    listAgents(req: ListAgentsRequest): Promise<ListAgentsResponse> {
      return client.request<ListAgentsResponse>(AGENT_RUNTIME_ENDPOINTS.listAgents, req);
    },
    getAgent(req: GetAgentRequest): Promise<GetAgentResponse> {
      return client.request<GetAgentResponse>(AGENT_RUNTIME_ENDPOINTS.getAgent, req);
    },

    // ── Capability Bindings ──
    listBindings(req: ListBindingsRequest): Promise<ListBindingsResponse> {
      return client.request<ListBindingsResponse>(AGENT_RUNTIME_ENDPOINTS.listBindings, req);
    },
    getBinding(req: GetBindingRequest): Promise<GetBindingResponse> {
      return client.request<GetBindingResponse>(AGENT_RUNTIME_ENDPOINTS.getBinding, req);
    },
    seed(req: SeedRuntimeRequest): Promise<SeedRuntimeResponse> {
      return client.request<SeedRuntimeResponse>(AGENT_RUNTIME_ENDPOINTS.seed, req);
    },
    upsertBinding(req: UpsertBindingRequest): Promise<UpsertBindingResponse> {
      return client.request<UpsertBindingResponse>(AGENT_RUNTIME_ENDPOINTS.upsertBinding, req);
    },
    createBinding(req: CreateBindingRequest): Promise<CreateBindingResponse> {
      return client.request<CreateBindingResponse>(AGENT_RUNTIME_ENDPOINTS.createBinding, req);
    },
    updateBindingState(req: UpdateBindingStateRequest): Promise<UpdateBindingStateResponse> {
      return client.request<UpdateBindingStateResponse>(
        AGENT_RUNTIME_ENDPOINTS.updateBindingState,
        req,
      );
    },
    updateBindingPriority(
      req: UpdateBindingPriorityRequest,
    ): Promise<UpdateBindingPriorityResponse> {
      return client.request<UpdateBindingPriorityResponse>(
        AGENT_RUNTIME_ENDPOINTS.updateBindingPriority,
        req,
      );
    },
    updateBindingStrategy(
      req: UpdateBindingStrategyRequest,
    ): Promise<UpdateBindingStrategyResponse> {
      return client.request<UpdateBindingStrategyResponse>(
        AGENT_RUNTIME_ENDPOINTS.updateBindingStrategy,
        req,
      );
    },
    deleteBinding(req: DeleteBindingRequest): Promise<DeleteBindingResponse> {
      return client.request<DeleteBindingResponse>(AGENT_RUNTIME_ENDPOINTS.deleteBinding, req);
    },

    // ── Runtime Health ──
    listTelemetry(req: ListTelemetryRequest): Promise<ListTelemetryResponse> {
      return client.request<ListTelemetryResponse>(AGENT_RUNTIME_ENDPOINTS.listTelemetry, req);
    },
    getHealthSummary(req: GetHealthSummaryRequest): Promise<GetHealthSummaryResponse> {
      return client.request<GetHealthSummaryResponse>(
        AGENT_RUNTIME_ENDPOINTS.getHealthSummary,
        req,
      );
    },

    // ── Deployment Lifecycle ──
    updateLifecycle(req: UpdateLifecycleRequest): Promise<UpdateLifecycleResponse> {
      return client.request<UpdateLifecycleResponse>(AGENT_RUNTIME_ENDPOINTS.updateLifecycle, req);
    },
    getLifecycleHistory(req: GetLifecycleHistoryRequest): Promise<GetLifecycleHistoryResponse> {
      return client.request<GetLifecycleHistoryResponse>(
        AGENT_RUNTIME_ENDPOINTS.getLifecycleHistory,
        req,
      );
    },

    // ── Governance & Policy ──
    listGovernanceIssues(req: ListGovernanceIssuesRequest): Promise<ListGovernanceIssuesResponse> {
      return client.request<ListGovernanceIssuesResponse>(
        AGENT_RUNTIME_ENDPOINTS.listGovernanceIssues,
        req,
      );
    },
    acknowledgeIssue(req: AcknowledgeIssueRequest): Promise<AcknowledgeIssueResponse> {
      return client.request<AcknowledgeIssueResponse>(
        AGENT_RUNTIME_ENDPOINTS.acknowledgeIssue,
        req,
      );
    },
    getGovernanceConfig(req: GetGovernanceConfigRequest): Promise<GetGovernanceConfigResponse> {
      return client.request<GetGovernanceConfigResponse>(
        AGENT_RUNTIME_ENDPOINTS.getGovernanceConfig,
        req,
      );
    },
    updateGovernanceConfig(
      req: UpdateGovernanceConfigRequest,
    ): Promise<UpdateGovernanceConfigResponse> {
      return client.request<UpdateGovernanceConfigResponse>(
        AGENT_RUNTIME_ENDPOINTS.updateGovernanceConfig,
        req,
      );
    },

    // ── Runtime KPI ──
    getRuntimeKpi(req: GetRuntimeKpiRequest): Promise<GetRuntimeKpiResponse> {
      return client.request<GetRuntimeKpiResponse>(AGENT_RUNTIME_ENDPOINTS.getRuntimeKpi, req);
    },
  };
}

export type AgentRuntimeGateway = ReturnType<typeof createAgentRuntimeGateway>;
