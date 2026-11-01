import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOpenBotPlugins } from "../../src/plugins/loader.js";
import type { PluginRegistry } from "../../src/plugins/registry.js";

export type RegistrySnapshot = {
  plugins: Array<{ id: string; version: string }>;
  resourceCounts: {
    tools: number;
    hooks: number;
    typedHooks: number;
    channels: number;
    providers: number;
    httpRoutes: number;
    cliRegistrars: number;
    services: number;
    commands: number;
    gatewayHandlers: number;
  };
  diagnostics: { errorCount: number; warnCount: number };
};

export function buildSnapshot(registry: PluginRegistry): RegistrySnapshot {
  const plugins = registry.plugins
    .map((plugin) => ({ id: plugin.id, version: plugin.version ?? "" }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  const errorCount = registry.diagnostics.filter((d) => d.level === "error").length;
  const warnCount = registry.diagnostics.filter((d) => d.level === "warn").length;

  return {
    plugins,
    resourceCounts: {
      tools: registry.tools.length,
      hooks: registry.hooks.length,
      typedHooks: registry.typedHooks.length,
      channels: registry.channels.length,
      providers: registry.providers.length,
      httpRoutes: registry.httpRoutes.length,
      cliRegistrars: registry.cliRegistrars.length,
      services: registry.services.length,
      commands: registry.commands.length,
      gatewayHandlers: Object.keys(registry.gatewayHandlers).length,
    },
    diagnostics: { errorCount, warnCount },
  };
}

export function serializeSnapshot(snapshot: RegistrySnapshot): string {
  const ordered = {
    diagnostics: snapshot.diagnostics,
    plugins: snapshot.plugins,
    resourceCounts: snapshot.resourceCounts,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function main(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outPath = path.join(
    repoRoot,
    ".kiro/specs/gateway-plugins-monolith-decomposition/baseline",
    "loader-registry-snapshot.json",
  );

  // Keep baseline hermetic: do not discover ~/.openbot/extensions.
  const prevStateDir = process.env.OPENBOT_STATE_DIR;
  const isolatedStateDir = path.join(repoRoot, ".tmp", "loader-registry-baseline-state");
  fs.mkdirSync(isolatedStateDir, { recursive: true });
  process.env.OPENBOT_STATE_DIR = isolatedStateDir;
  let registry;
  try {
    registry = loadOpenBotPlugins({
      cache: false,
      config: { plugins: { enabled: true } },
    });
  } finally {
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
  }
  const serialized = serializeSnapshot(buildSnapshot(registry));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serialized, "utf8");
  console.log(
    `Wrote ${path.relative(repoRoot, outPath)} (${createHash("sha256").update(serialized).digest("hex").slice(0, 12)})`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
