/**
 * supervisor/wiring.ts — production wiring for Development Supervisor (M1→M2).
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { FabricService } from "../../fabric/service.js";
import type { NodeRegistry } from "../node-registry.js";
import { getFabricService } from "../server-methods/fabric.js";
import { startSupervisorDriver, tickSupervisedTask } from "./driver.js";
import type { SupervisorPorts } from "./engine.js";
import { createSupportCaseEscalatorPort, type EscalatorPort } from "./escalator.js";
import { createGatewayExecutionContextPort } from "./execution-context.js";
import { isSupervisorEnabled } from "./feature.js";
import { isSupervisorRunnerEnabled, resolveSupervisorRunnerConfig } from "./feature.js";
import { createDefaultNodeAgentRegistry } from "./node-agent-registry.js";
import { NodeRegistryInvokePort, UnavailableNodeInvokePort } from "./node-invoke-port.js";
import { createJsonReporterPort, type ReporterPort } from "./reporter.js";
import { startSupervisorRunner } from "./runner.js";
import { resumeActive as resumeActiveTasks } from "./store.js";
import { createFabricValidatorPort, type ValidatorPort } from "./validator.js";
import {
  createRoutingWorkerPort,
  GatewayWorkerExecutor,
  NodeAgentWorkerExecutor,
} from "./worker-executor.js";
import { createWorkspacePort, type WorkspacePort } from "./workspace.js";
import { createCompositeWorkspaceProvider } from "./workspace.js";

export function createSupervisorPorts(params: {
  cfg: OpenBotConfig;
  fabricService: FabricService;
  nodeRegistry?: NodeRegistry;
}): SupervisorPorts {
  const nodeAgentRegistry = createDefaultNodeAgentRegistry(params.nodeRegistry);
  const executionContext = createGatewayExecutionContextPort({
    cfg: params.cfg,
    nodeAgentRegistry,
  });
  const nodeInvoke = params.nodeRegistry
    ? new NodeRegistryInvokePort(params.nodeRegistry)
    : new UnavailableNodeInvokePort();
  const worker = createRoutingWorkerPort([
    new GatewayWorkerExecutor(params.cfg),
    new NodeAgentWorkerExecutor(nodeInvoke),
  ]);
  const validator: ValidatorPort = createFabricValidatorPort(() => params.fabricService);
  const workspaceProvider = createCompositeWorkspaceProvider({ fabric: params.fabricService });
  const workspace: WorkspacePort = createWorkspacePort(workspaceProvider);
  const escalator: EscalatorPort = createSupportCaseEscalatorPort();
  const reporter: ReporterPort = createJsonReporterPort();
  return {
    executionContext,
    worker,
    validator,
    workspace,
    escalator,
    reporter,
    nodeAgentRegistry,
    nodeInvoke,
  };
}

export function resolveSupervisorPorts(params: {
  cfg: OpenBotConfig;
  nodeRegistry?: NodeRegistry;
}): SupervisorPorts | null {
  if (!isSupervisorEnabled()) {
    return null;
  }
  const fabricService = getFabricService();
  if (!fabricService) {
    return null;
  }
  return createSupervisorPorts({
    cfg: params.cfg,
    fabricService,
    ...(params.nodeRegistry ? { nodeRegistry: params.nodeRegistry } : {}),
  });
}

export async function startSupervisorRuntime(params: {
  cfg: OpenBotConfig;
  storeDir?: string;
  nodeRegistry?: NodeRegistry;
}): Promise<{ stop: () => void; resumed: number; runnerEnabled: boolean } | null> {
  const ports = resolveSupervisorPorts({
    cfg: params.cfg,
    ...(params.nodeRegistry ? { nodeRegistry: params.nodeRegistry } : {}),
  });
  if (!ports) {
    return null;
  }
  const runnerEnabled = isSupervisorRunnerEnabled();
  const runnerConfig = resolveSupervisorRunnerConfig(params.cfg);
  const { stop } = runnerEnabled
    ? startSupervisorRunner({
        ports,
        storeDir: params.storeDir,
        config: runnerConfig,
      })
    : startSupervisorDriver({ ports, storeDir: params.storeDir });

  const resumed = await resumeActiveTasks(async (t) => {
    await tickSupervisedTask(t.taskId, ports, { storeDir: params.storeDir });
  }, params.storeDir);

  return { stop, resumed, runnerEnabled };
}
