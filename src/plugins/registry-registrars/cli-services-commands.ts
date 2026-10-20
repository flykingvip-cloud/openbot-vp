// Registrars for CLI extensions, services, and named plugin commands.
// These three are grouped together because they're each tiny — the `cli`
// registrar is a thin pass-through, `service` is essentially an array push,
// and `command` delegates the heavy lifting to `registerPluginCommand`.

import { registerPluginCommand } from "../commands.js";
import type { PluginRecord, RegistrarContext } from "../registry-types.js";
import type {
  OpenClawPluginCliRegistrar,
  OpenClawPluginCommandDefinition,
  OpenClawPluginService,
} from "../types.js";

export type RegisterCliOptions = { commands?: string[] };

export function registerCli(
  ctx: RegistrarContext,
  record: PluginRecord,
  registrar: OpenClawPluginCliRegistrar,
  opts?: RegisterCliOptions,
): void {
  const commands = (opts?.commands ?? []).map((cmd) => cmd.trim()).filter(Boolean);
  record.cliCommands.push(...commands);
  ctx.registry.cliRegistrars.push({
    pluginId: record.id,
    register: registrar,
    commands,
    source: record.source,
  });
}

export function registerService(
  ctx: RegistrarContext,
  record: PluginRecord,
  service: OpenClawPluginService,
): void {
  const id = service.id.trim();
  if (!id) {
    return;
  }
  record.services.push(id);
  ctx.registry.services.push({
    pluginId: record.id,
    service,
    source: record.source,
  });
}

export function registerCommand(
  ctx: RegistrarContext,
  record: PluginRecord,
  command: OpenClawPluginCommandDefinition,
): void {
  const name = command.name.trim();
  if (!name) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: "command registration missing name",
    });
    return;
  }

  // Register with the plugin command system (validates name and checks for
  // duplicates across plugins).
  const result = registerPluginCommand(record.id, command);
  if (!result.ok) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: `command registration failed: ${result.error}`,
    });
    return;
  }

  record.commands.push(name);
  ctx.registry.commands.push({
    pluginId: record.id,
    command,
    source: record.source,
  });
}
