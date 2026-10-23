/**
 * Ops / co-located bind for Claw4 firmware HTTP compat on the gateway.
 *
 * The gateway mounts POST /api/v1/upload and GET /api/v1/conversation/.../messages
 * via handleClaw4FirmwareHttpRequest. Those routes need an in-process
 * DeviceDhService; without one they return 503 UNAVAILABLE.
 *
 * Opt-in (default off — production cam_b / grayRelease untouched):
 *   OPENBOT_CLAW4_FIRMWARE_INPROCESS=1
 *   OPENBOT_DEVICE_DH_STUB_CONFIG=/path/to/stub-clients.json
 *
 * Reuses the same stub client config and model env as the adjacent 8787 stub
 * (OPENBOT_DEVICE_DH_AGENT, OPENBOT_DEVICE_DH_APPROVAL_TOKEN, …). Does not
 * mount /api/integrations/v1 on the gateway and does not reverse-proxy 8787.
 * Does not flip grayRelease or PROMOTE anything.
 */

import { createGatewayAgentModelClient, resolveGatewayAgentConfig } from "./agent-client.js";
import { loadStubConfig } from "./config.js";
import {
  createPlaceholderModelClient,
  DeviceDhModelError,
  resolveDeviceDhModelMode,
  type DeviceDhModelClient,
} from "./model.js";
import { DeviceDhService } from "./service.js";

let injectedService: DeviceDhService | undefined;
let envBoundService: DeviceDhService | undefined;
let envBindAttempted = false;
let envBindWarning: string | undefined;

/** Production / ops hook: bind DeviceDhService into the gateway Claw4 mount. */
export function setClaw4FirmwareService(service: DeviceDhService | undefined): void {
  injectedService = service;
}

/** @deprecated Prefer setClaw4FirmwareService — kept for existing tests. */
export function setClaw4FirmwareServiceForTests(service: DeviceDhService | undefined): void {
  setClaw4FirmwareService(service);
}

export function getClaw4FirmwareService(): DeviceDhService | undefined {
  return injectedService ?? envBoundService;
}

/** Test helper: clear inject + env-bound singleton. */
export function resetClaw4FirmwareBindForTests(): void {
  injectedService = undefined;
  envBoundService = undefined;
  envBindAttempted = false;
  envBindWarning = undefined;
}

export function claw4FirmwareEnvBindWarning(): string | undefined {
  return envBindWarning;
}

function isInProcessEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.OPENBOT_CLAW4_FIRMWARE_INPROCESS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "inprocess";
}

function loadModels(env: NodeJS.ProcessEnv): DeviceDhModelClient {
  const mode = resolveDeviceDhModelMode(env);
  if (mode === "agent") {
    return createGatewayAgentModelClient({
      ...resolveGatewayAgentConfig(env),
      // Best-effort Gateway WebSocket chat.abort. HTTP abort is the guarantee.
      attemptGatewayAbort: true,
    });
  }
  return createPlaceholderModelClient();
}

/**
 * Build a DeviceDhService from the same env the adjacent stub uses.
 * Returns undefined when OPENBOT_CLAW4_FIRMWARE_INPROCESS is not set.
 * Throws DeviceDhModelError / config errors when enabled but misconfigured.
 */
export function createClaw4FirmwareServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeviceDhService | undefined {
  if (!isInProcessEnabled(env)) {
    return undefined;
  }
  const configPath = env.OPENBOT_DEVICE_DH_STUB_CONFIG?.trim();
  if (!configPath) {
    throw new Error(
      "OPENBOT_CLAW4_FIRMWARE_INPROCESS requires OPENBOT_DEVICE_DH_STUB_CONFIG (path to stub clients JSON)",
    );
  }
  const allowOrigins = (env.OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const models = loadModels(env);
  return new DeviceDhService({
    config: loadStubConfig(configPath),
    approvalToken: env.OPENBOT_DEVICE_DH_APPROVAL_TOKEN ?? "dev-approval-token",
    mediaAllowOrigins: allowOrigins,
    models,
  });
}

/**
 * Resolve the service for a Claw4 request:
 *   explicit opts.service → setClaw4FirmwareService inject → env in-process bind.
 * Env bind is attempted at most once per process (lazy singleton).
 */
export function resolveClaw4FirmwareService(
  opts: { service?: DeviceDhService } = {},
  env: NodeJS.ProcessEnv = process.env,
): DeviceDhService | undefined {
  if (opts.service) {
    return opts.service;
  }
  if (injectedService) {
    return injectedService;
  }
  if (envBoundService) {
    return envBoundService;
  }
  if (envBindAttempted) {
    return undefined;
  }
  envBindAttempted = true;
  if (!isInProcessEnabled(env)) {
    return undefined;
  }
  try {
    const created = createClaw4FirmwareServiceFromEnv(env);
    if (created) {
      envBoundService = created;
      envBindWarning = undefined;
      return created;
    }
  } catch (error) {
    const message =
      error instanceof DeviceDhModelError || error instanceof Error
        ? error.message
        : "Claw4 firmware in-process bind failed";
    envBindWarning = message;
    // Fail closed: leave routes on 503 rather than taking down the gateway.
  }
  return undefined;
}
