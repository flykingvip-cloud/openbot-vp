// Gateway-method registrar — `api.registerGatewayMethod(method, handler)`.
// Performs collision detection against both core methods and previously
// registered plugin methods, surfaces a diagnostic on conflict, and never
// silently overwrites.

import type { GatewayRequestHandler } from "../../gateway/server-methods/types.js";
import type { PluginRecord, RegistrarContext } from "../registry-types.js";

export function registerGatewayMethod(
  ctx: RegistrarContext,
  record: PluginRecord,
  method: string,
  handler: GatewayRequestHandler,
): void {
  const trimmed = method.trim();
  if (!trimmed) {
    return;
  }
  if (ctx.coreGatewayMethods.has(trimmed) || ctx.registry.gatewayHandlers[trimmed]) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: `gateway method already registered: ${trimmed}`,
    });
    return;
  }
  ctx.registry.gatewayHandlers[trimmed] = handler;
  record.gatewayMethods.push(trimmed);
}
