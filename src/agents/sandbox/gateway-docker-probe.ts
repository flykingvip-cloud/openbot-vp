/**
 * Cross-tenant gateway sandbox docker readiness probe.
 *
 * When sandbox.mode requires spawning containers (or account-worker docker is
 * on), the gateway must have either a docker CLI on PATH or a usable engine
 * socket. Missing both is the LIVE "spawn docker ENOENT" class of failure —
 * do not report healthy / ready in that state.
 *
 * No tenant IDs: this is an infrastructure check for every tenant on the host.
 */
import { isAccountWorkerEnvFlagOn } from "./account-worker-flags.js";
import {
  resolveAccountWorkerDockerTransport,
  type DockerTransport,
} from "./docker-engine-client.js";

export const GATEWAY_DOCKER_PROBE_CRITICAL =
  "CRITICAL: gateway docker runtime unavailable (CLI and engine socket both missing). " +
  "Rebuild with --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1 and/or mount docker.sock / podman.sock. " +
  "Sandbox exec will fail with spawn docker ENOENT for every tenant until fixed.";

export type GatewayDockerProbeResult = {
  ok: boolean;
  transport: DockerTransport;
  /** Operator-safe detail; never includes tenant/user identifiers. */
  detail: string;
  criticalMessage: string | null;
};

export type GatewayDockerProbeOptions = {
  env?: NodeJS.ProcessEnv;
  pathExists?: (file: string) => boolean;
  isSocket?: (file: string) => boolean;
};

/**
 * Sync transport probe. Prefer CLI; a mounted engine socket is also ok.
 * Does not spawn `docker version` (avoids hanging unit tests / flaky CI);
 * callers that need a live daemon check can run `docker version` after ok.
 */
export function probeGatewayDockerRuntime(
  options: GatewayDockerProbeOptions = {},
): GatewayDockerProbeResult {
  const transport = resolveAccountWorkerDockerTransport({
    env: options.env,
    pathExists: options.pathExists,
    isSocket: options.isSocket,
  });
  if (transport.kind === "cli") {
    return {
      ok: true,
      transport,
      detail: `docker CLI available (${transport.bin})`,
      criticalMessage: null,
    };
  }
  if (transport.kind === "socket") {
    return {
      ok: true,
      transport,
      detail: `docker engine socket available (${transport.socketPath})`,
      criticalMessage: null,
    };
  }
  return {
    ok: false,
    transport,
    detail: "docker CLI and engine socket both missing",
    criticalMessage: GATEWAY_DOCKER_PROBE_CRITICAL,
  };
}

/**
 * True when this process is expected to spawn sandbox / account-worker
 * containers and therefore must pass {@link probeGatewayDockerRuntime}.
 */
export function gatewayRequiresDockerRuntime(params: {
  cfg?: { agents?: { defaults?: { sandbox?: { mode?: string } } } };
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = params.env ?? process.env;
  const mode = params.cfg?.agents?.defaults?.sandbox?.mode ?? "off";
  if (mode === "all" || mode === "non-main") {
    return true;
  }
  return (
    isAccountWorkerEnvFlagOn(env.OPENBOT_ACCOUNT_WORKER) &&
    isAccountWorkerEnvFlagOn(env.OPENBOT_ACCOUNT_WORKER_DOCKER)
  );
}
