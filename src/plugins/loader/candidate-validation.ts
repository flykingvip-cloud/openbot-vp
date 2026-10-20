/**
 * Plugin loader candidate-validation helpers.
 *
 * Owns config-schema validation and module-export resolution previously
 * inlined in `src/plugins/loader.ts`. Extracted per the
 * `gateway-plugins-monolith-decomposition` spec (Task 3.4). Behavior is
 * byte-for-byte equivalent: `validatePluginConfig` keeps the same cache-key
 * fallback (`JSON.stringify(schema)` when no explicit key is supplied) and
 * `resolvePluginModuleExport` keeps the same `default`-then-self resolution
 * order plus the `register ?? activate` fallback (Req 4.5, 4.7, 4.8).
 */

import { validateJsonSchemaValue } from "../schema-validator.js";
import type { OpenClawPluginDefinition } from "../types.js";

/**
 * Validate the plugin's user-supplied config against its declared JSON
 * schema. When no schema is present, the value is treated as already valid
 * and returned as-is so callers can still flow it through to `pluginConfig`.
 */
export function validatePluginConfig(params: {
  schema?: Record<string, unknown>;
  cacheKey?: string;
  value?: unknown;
}): { ok: boolean; value?: Record<string, unknown>; errors?: string[] } {
  const schema = params.schema;
  if (!schema) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  const cacheKey = params.cacheKey ?? JSON.stringify(schema);
  const result = validateJsonSchemaValue({
    schema,
    cacheKey,
    value: params.value ?? {},
  });
  if (result.ok) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  return { ok: false, errors: result.errors.map((error) => error.text) };
}

/**
 * Normalize the loaded plugin module export into a `{ definition, register }`
 * pair. Plugins may export either a default function (the register handler)
 * or a definition object containing `register` / `activate`.
 */
export function resolvePluginModuleExport(moduleExport: unknown): {
  definition?: OpenClawPluginDefinition;
  register?: OpenClawPluginDefinition["register"];
} {
  const resolved =
    moduleExport &&
    typeof moduleExport === "object" &&
    "default" in (moduleExport as Record<string, unknown>)
      ? (moduleExport as { default: unknown }).default
      : moduleExport;
  if (typeof resolved === "function") {
    return {
      register: resolved as OpenClawPluginDefinition["register"],
    };
  }
  if (resolved && typeof resolved === "object") {
    const def = resolved as OpenClawPluginDefinition;
    const register = def.register ?? def.activate;
    return { definition: def, register };
  }
  return {};
}
