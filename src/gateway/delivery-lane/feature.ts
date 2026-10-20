/**
 * feature.ts — DeliveryLane feature gate (Tip A).
 *
 * OFF by default. When off, lane.* RPC returns UNAVAILABLE and no supervisor
 * projection is written — zero behavior change on existing paths.
 * Enable sources (either wins):
 *  1. `OPENBOT_DELIVERY_LANE_ENABLED` env flag
 *  2. `gateway.deliveryLane.enabled` config flag
 */

import { loadConfig } from "../../config/config.js";

export const DELIVERY_LANE_ENABLED_ENV = "OPENBOT_DELIVERY_LANE_ENABLED";

function envEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[DELIVERY_LANE_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configEnabled(): boolean {
  try {
    return loadConfig().gateway?.deliveryLane?.enabled === true;
  } catch {
    return false;
  }
}

export function isDeliveryLaneEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: () => boolean = configEnabled,
): boolean {
  return envEnabled(env) || readConfig();
}

/** Path-1 cross-bot acceptSeal required when config/env says so. */
export function isDeliveryLanePath1CrossBotEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: () => boolean = () => {
    try {
      return loadConfig().gateway?.deliveryLane?.path1CrossBot === true;
    } catch {
      return false;
    }
  },
): boolean {
  const raw = env.OPENBOT_DELIVERY_LANE_PATH1?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return readConfig();
}
