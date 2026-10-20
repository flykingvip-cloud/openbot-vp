/**
 * supervisor/worker-auth-probe.ts — read-only worker install/auth health (M0.5/M5).
 *
 * Never returns secrets. Gateway workers use bounded CLI probe; local-IDE workers
 * probe via Node Agent when `supervisor.worker.probe` is declared.
 */

import { describeCliBackends } from "../../agents/cli-backend-admin.js";
import {
  probeCliBackendCommand,
  type CliBackendProbeResult,
} from "../../agents/cli-backend-probe.js";
import type { OpenBotConfig } from "../../config/config.js";
import type {
  ResolvedIdentity,
  ResolvedPlacement,
  WorkerAuthProbe,
} from "../../fabric/worker/types.js";
import { SUPERVISOR_WORKER_PROBE_COMMAND } from "../../infra/node-commands.js";
import { probeLocalIdeLoginOnGateway } from "./local-ide-gateway-probe.js";
import type { SupervisorWorkerProbeResult } from "./node-agent-commands.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { readNodeInvokePayload } from "./node-invoke-port.js";

export type WorkerAuthProbeResult = Awaited<ReturnType<WorkerAuthProbe["probe"]>>;

type ProbeFn = (command: string, probeArgs?: string[]) => Promise<CliBackendProbeResult>;

export class GatewayWorkerAuthProbe implements WorkerAuthProbe {
  constructor(
    private readonly cfg?: OpenBotConfig,
    private readonly runCommandProbe: ProbeFn = probeCliBackendCommand,
    private readonly nodeInvoke?: NodeInvokePort,
  ) {}

  async probe(input: {
    workerId: string;
    placement: ResolvedPlacement;
    identity: ResolvedIdentity;
  }): Promise<WorkerAuthProbeResult> {
    const { workerId, placement, identity } = input;

    if (identity.policy === "local_ide_login") {
      return this.probeLocalIdeLogin({ workerId, placement, identity });
    }

    if (placement.executor !== "gateway") {
      return {
        installed: false,
        authenticated: false,
        status: identity.status,
        source: "declared",
        reason: "Gateway CLI probe skipped for non-gateway placement",
      };
    }

    const entry = describeCliBackends(this.cfg ?? ({} as OpenBotConfig)).find(
      (backend) => backend.id === workerId,
    );
    const command = entry?.effective?.command?.trim() ?? "";
    if (!command) {
      return {
        installed: false,
        authenticated: false,
        status: identity.status,
        source: "probe",
        reason: "CLI command not configured",
      };
    }

    const probeResult = await this.runCommandProbe(command);
    const installed = probeResult.resolved;
    const authenticated = installed && identity.status === "validated";

    return {
      installed,
      authenticated,
      status: identity.status,
      source: "probe",
      reason: !installed
        ? "CLI not found on gateway host"
        : !authenticated
          ? "Credential missing or invalid"
          : undefined,
    };
  }

  private async probeLocalIdeLogin(input: {
    workerId: string;
    placement: ResolvedPlacement;
    identity: ResolvedIdentity;
  }): Promise<WorkerAuthProbeResult> {
    const { workerId, placement, identity } = input;
    const nodeId = placement.nodeAgentId?.trim();
    if (
      placement.executor === "node_agent" &&
      nodeId &&
      this.nodeInvoke?.isConnected(nodeId) &&
      this.nodeInvoke.getDeclaredCommands(nodeId).includes(SUPERVISOR_WORKER_PROBE_COMMAND)
    ) {
      const result = await this.nodeInvoke.invoke({
        nodeId,
        command: SUPERVISOR_WORKER_PROBE_COMMAND,
        params: { workerId },
        timeoutMs: 45_000,
        idempotencyKey: `probe:${workerId}:${nodeId}`,
      });
      if (result.ok) {
        const payload = readNodeInvokePayload(result) as SupervisorWorkerProbeResult | null;
        const status = payload?.status ?? identity.status;
        if (payload?.authenticated) {
          return {
            installed: payload.installed ?? true,
            authenticated: true,
            status,
            source: "probe",
            ...(payload.reason ? { reason: payload.reason } : {}),
          };
        }
        // Node reported unauthenticated — double-check host CLI. Mac Node whoami
        // detectors can misread cursor-agent's "Starting login process..." banner.
        const gatewayFallbackAfterNodeNeg = await probeLocalIdeLoginOnGateway(workerId, this.cfg);
        if (gatewayFallbackAfterNodeNeg?.authenticated) {
          return {
            ...gatewayFallbackAfterNodeNeg,
            reason:
              gatewayFallbackAfterNodeNeg.reason ??
              "Node probe unauthenticated; host CLI login validated",
          };
        }
        return {
          installed: payload?.installed ?? gatewayFallbackAfterNodeNeg?.installed ?? false,
          authenticated: false,
          status,
          source: "probe",
          ...(payload?.reason || gatewayFallbackAfterNodeNeg?.reason
            ? { reason: payload?.reason ?? gatewayFallbackAfterNodeNeg?.reason }
            : {}),
        };
      }
      // Node probe failed/timed out: fall through to same-host Gateway CLI probe so
      // create gate is not stuck when macOS Node is busy but local IDE CLI is logged in.
      const gatewayFallbackAfterNodeFail = await probeLocalIdeLoginOnGateway(workerId, this.cfg);
      if (gatewayFallbackAfterNodeFail?.authenticated) {
        return {
          ...gatewayFallbackAfterNodeFail,
          reason:
            gatewayFallbackAfterNodeFail.reason ??
            `Node probe failed (${result.error?.message ?? "unknown"}); host CLI login validated`,
        };
      }
      return {
        installed: gatewayFallbackAfterNodeFail?.installed ?? false,
        authenticated: false,
        status: identity.status,
        source: "probe",
        reason: result.error?.message ?? "Node Agent worker probe failed",
      };
    }

    const gatewayFallback = await probeLocalIdeLoginOnGateway(workerId, this.cfg);
    if (gatewayFallback) {
      return gatewayFallback;
    }

    if (placement.executor !== "node_agent" || !nodeId) {
      return {
        installed: false,
        authenticated: false,
        status: identity.status,
        source: "declared",
        reason:
          placement.executor === "node_agent"
            ? "Node Agent placement not available"
            : "Local IDE login requires Node Agent on the employee workstation",
      };
    }

    if (!this.nodeInvoke?.isConnected(nodeId)) {
      return {
        installed: false,
        authenticated: false,
        status: identity.status,
        source: "declared",
        reason: `Node Agent "${nodeId}" is offline`,
      };
    }

    return {
      installed: false,
      authenticated: false,
      status: identity.status,
      source: "declared",
      reason: `Node Agent "${nodeId}" does not declare ${SUPERVISOR_WORKER_PROBE_COMMAND}`,
    };
  }
}

export function createGatewayWorkerAuthProbe(
  cfg: OpenBotConfig,
  nodeInvoke?: NodeInvokePort,
): WorkerAuthProbe {
  return new GatewayWorkerAuthProbe(cfg, probeCliBackendCommand, nodeInvoke);
}
