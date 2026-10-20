// HTTP-route registrar — `api.registerHttpRoute({ path, handler, auth, match, replaceExisting })`.
//
// Handles four concerns:
//   1. Path normalization (defers to ./http-path)
//   2. Auth-mode validation
//   3. Overlap detection across previously registered routes
//   4. Replace-existing semantics (idempotent reload)
//
// Diagnostics, never throws — failures surface via pushDiagnostic so the
// rest of the plugin keeps loading.

import { normalizePluginHttpPath } from "../http-path.js";
import { findOverlappingPluginHttpRoute } from "../http-route-overlap.js";
import type {
  PluginHttpRouteRegistration,
  PluginRecord,
  RegistrarContext,
} from "../registry-types.js";
import type { OpenClawPluginHttpRouteParams } from "../types.js";

const describeHttpRouteOwner = (entry: PluginHttpRouteRegistration): string => {
  const plugin = entry.pluginId?.trim() || "unknown-plugin";
  const source = entry.source?.trim() || "unknown-source";
  return `${plugin} (${source})`;
};

export function registerHttpRoute(
  ctx: RegistrarContext,
  record: PluginRecord,
  params: OpenClawPluginHttpRouteParams,
): void {
  const normalizedPath = normalizePluginHttpPath(params.path);
  if (!normalizedPath) {
    ctx.pushDiagnostic({
      level: "warn",
      pluginId: record.id,
      source: record.source,
      message: "http route registration missing path",
    });
    return;
  }
  if (params.auth !== "gateway" && params.auth !== "plugin") {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: `http route registration missing or invalid auth: ${normalizedPath}`,
    });
    return;
  }
  const match = params.match ?? "exact";
  const overlappingRoute = findOverlappingPluginHttpRoute(ctx.registry.httpRoutes, {
    path: normalizedPath,
    match,
  });
  if (overlappingRoute && overlappingRoute.auth !== params.auth) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message:
        `http route overlap rejected: ${normalizedPath} (${match}, ${params.auth}) ` +
        `overlaps ${overlappingRoute.path} (${overlappingRoute.match}, ${overlappingRoute.auth}) ` +
        `owned by ${describeHttpRouteOwner(overlappingRoute)}`,
    });
    return;
  }
  const existingIndex = ctx.registry.httpRoutes.findIndex(
    (entry) => entry.path === normalizedPath && entry.match === match,
  );
  if (existingIndex >= 0) {
    const existing = ctx.registry.httpRoutes[existingIndex];
    if (!existing) {
      return;
    }
    if (!params.replaceExisting) {
      ctx.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `http route already registered: ${normalizedPath} (${match}) by ${describeHttpRouteOwner(existing)}`,
      });
      return;
    }
    if (existing.pluginId && existing.pluginId !== record.id) {
      ctx.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `http route replacement rejected: ${normalizedPath} (${match}) owned by ${describeHttpRouteOwner(existing)}`,
      });
      return;
    }
    ctx.registry.httpRoutes[existingIndex] = {
      pluginId: record.id,
      path: normalizedPath,
      handler: params.handler,
      auth: params.auth,
      match,
      source: record.source,
    };
    return;
  }
  record.httpRoutes += 1;
  ctx.registry.httpRoutes.push({
    pluginId: record.id,
    path: normalizedPath,
    handler: params.handler,
    auth: params.auth,
    match,
    source: record.source,
  });
}
