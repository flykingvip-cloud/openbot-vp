// Internal-hook registrar (named events; not the typed hook system).
// Plugins register handlers via `api.registerHook(events, handler, opts)`.

import path from "node:path";
import { registerInternalHook } from "../../hooks/internal-hooks.js";
import type { HookEntry } from "../../hooks/types.js";
import type { PluginRecord, RegistrarContext } from "../registry-types.js";
import type { OpenClawPluginApi, OpenClawPluginHookOptions } from "../types.js";

export function registerHook(
  ctx: RegistrarContext,
  record: PluginRecord,
  events: string | string[],
  handler: Parameters<typeof registerInternalHook>[1],
  opts: OpenClawPluginHookOptions | undefined,
  config: OpenClawPluginApi["config"],
): void {
  const eventList = Array.isArray(events) ? events : [events];
  const normalizedEvents = eventList.map((event) => event.trim()).filter(Boolean);
  const entry = opts?.entry ?? null;
  const name = entry?.hook.name ?? opts?.name?.trim();
  if (!name) {
    ctx.pushDiagnostic({
      level: "warn",
      pluginId: record.id,
      source: record.source,
      message: "hook registration missing name",
    });
    return;
  }

  const description = entry?.hook.description ?? opts?.description ?? "";
  const hookEntry: HookEntry = entry
    ? {
        ...entry,
        hook: {
          ...entry.hook,
          name,
          description,
          source: "openclaw-plugin",
          pluginId: record.id,
        },
        metadata: {
          ...entry.metadata,
          events: normalizedEvents,
        },
      }
    : {
        hook: {
          name,
          description,
          source: "openclaw-plugin",
          pluginId: record.id,
          filePath: record.source,
          baseDir: path.dirname(record.source),
          handlerPath: record.source,
        },
        frontmatter: {},
        metadata: { events: normalizedEvents },
        invocation: { enabled: true },
      };

  record.hookNames.push(name);
  ctx.registry.hooks.push({
    pluginId: record.id,
    entry: hookEntry,
    events: normalizedEvents,
    source: record.source,
  });

  const hookSystemEnabled = config?.hooks?.internal?.enabled === true;
  if (!hookSystemEnabled || opts?.register === false) {
    return;
  }

  for (const event of normalizedEvents) {
    registerInternalHook(event, handler);
  }
}
