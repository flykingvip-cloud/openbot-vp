/**
 * wiring.ts — assemble a production FabricService (Phase B 11.1b).
 *
 * Replaces the no-op default executor with a REAL one: `buildExecuteNode` backed
 * by a `ToolRunner` over an injected AOR `ToolInvoker` (the `/tools/invoke`
 * surface). Decide uses the real exec policy probes (`createProbeDecideFor`).
 *
 * The `ToolInvoker` is injected (not constructed here) so this factory is unit-
 * testable with a fake invoker and free of gateway-bootstrap concerns. The
 * gateway bootstrap constructs the concrete invoker (loopback/in-process) and
 * calls `setFabricServiceProvider(() => createGatewayFabricService(...))`.
 *
 * Design: tasks 11.1b.
 */

import type { ToolInvoker } from "@openbot/aor-core";
import { AdapterRegistry, BUILTIN_ADAPTERS } from "./adapter-registry.js";
import { GENERIC_ADAPTERS } from "./adapters/shell-git.js";
import type { FabricExecutionRecord } from "./audit.js";
import type { ToolRequest } from "./contract.js";
import type { UsageIngestPort } from "./cost.js";
import {
  buildExecuteNode,
  createProcessRunner,
  createRoutingRunner,
  createToolInvokerRunner,
  type ProcessRunnerOptions,
} from "./execution.js";
import { createKernelAgentRunner, type KernelOrchestrator } from "./kernel.js";
import { attributionToOwnership, type LoomAttribution, type OwnershipMetadata } from "./mappers.js";
import type { ExecProbeDeps } from "./probes.js";
import { createProbeDecideFor } from "./probes.js";
import { createFabricService, type FabricService } from "./service.js";

export interface GatewayFabricDeps {
  /** Real tool execution backend (e.g. OpenBot /tools/invoke client). */
  toolInvoker: ToolInvoker;
  /** Audit sink (e.g. control-plane-audit). */
  onRecord?: (record: FabricExecutionRecord) => void;
  /**
   * Stage-2 Loom attribution resolver (compile-time governance metadata). When
   * provided, the signal is consumed by the Policy Runtime as a NEUTRAL trace
   * entry (never flips the decision, M4/D3) AND, unless `ownershipFor` is set
   * explicitly, projected into the graph-state ownership ("who") via the mapper.
   * The resolver is injected from outside `src/fabric` (no runtime registry
   * lookup / no `src → scripts` coupling, D2/D4).
   */
  attributionFor?: (request: ToolRequest) => LoomAttribution | undefined;
  /** Loom ownership resolver (compile-time metadata). Overrides attributionFor projection. */
  ownershipFor?: (request: ToolRequest) => OwnershipMetadata | undefined;
  /** Usage/billing sink. */
  usage?: UsageIngestPort;
  /** Cost estimate for costLimit enforcement. */
  estimateCostUsd?: (request: ToolRequest) => number;
  /** Override exec-policy probe deps (tests). */
  probeDeps?: ExecProbeDeps;
  /** Optional Agent Kernel (AOR) for agent-node execution. */
  orchestrator?: KernelOrchestrator;
  /** Extra adapters to register beyond built-ins + generic shell/git. */
  adapters?: ConstructorParameters<typeof AdapterRegistry>[0];
  /**
   * Enable the native process-spawn runner for declarative `generic.*` adapters
   * naming a real binary (e.g. `git`). When omitted, all execution routes through
   * the `toolInvoker` (`/tools/invoke`). Pass `{}` to enable with defaults or a
   * `ProcessRunnerOptions` to tune cwd/timeout/buffer.
   */
  processRunner?: ProcessRunnerOptions | false;
}

/**
 * Build a production-wired FabricService: real probes + real TOL runner.
 */
export function createGatewayFabricService(deps: GatewayFabricDeps): FabricService {
  const registry = new AdapterRegistry(deps.adapters ?? [...BUILTIN_ADAPTERS, ...GENERIC_ADAPTERS]);
  const toolRunner = createToolInvokerRunner(deps.toolInvoker);
  // When enabled, declarative generic.* adapters naming a real binary (git) run
  // as OS processes; everything else stays on the /tools/invoke surface.
  const runner =
    deps.processRunner === false || deps.processRunner === undefined
      ? toolRunner
      : createRoutingRunner({
          native: createProcessRunner(deps.processRunner),
          tool: toolRunner,
        });
  const agentRunner = deps.orchestrator ? createKernelAgentRunner(deps.orchestrator) : undefined;
  // Stage-2: the same compile-time attribution signal feeds both the neutral
  // policy decisionTrace (via probes) and, unless overridden, the graph-state
  // ownership projection (via the mapper).
  const ownershipFor =
    deps.ownershipFor ??
    (deps.attributionFor
      ? (request: ToolRequest) => {
          const attr = deps.attributionFor?.(request);
          return attr ? attributionToOwnership(attr) : undefined;
        }
      : undefined);
  return createFabricService({
    registry,
    pipeline: {
      decideFor: createProbeDecideFor(
        deps.probeDeps,
        deps.attributionFor ? { attributionFor: deps.attributionFor } : {},
      ),
      executeNode: buildExecuteNode(registry, runner, { agentRunner }),
    },
    onRecord: deps.onRecord,
    ownershipFor,
    usage: deps.usage,
    estimateCostUsd: deps.estimateCostUsd,
  });
}
