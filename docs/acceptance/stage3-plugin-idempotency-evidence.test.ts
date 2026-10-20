/**
 * Stage 3 six-column **Plugin/SDK idempotency** slice (narrow E1/E2).
 *
 * Proposition (§5.2 Plugin/SDK idempotency): plugin tool calls go through
 * the same tool policy path as core tools — they are not a bypass lane.
 *
 * Evidence:
 * - `applyToolPolicyPipeline` + `getPluginToolMeta` deny / allow plugin
 *   tools with the same matcher as core (`filterToolsByPolicy`).
 * - `group:plugins` expands via `expandPolicyWithPluginGroups` into the
 *   same allow/deny lists.
 * - Product wiring: `createOpenClawTools` merges `resolvePluginTools` into
 *   the same array; `createOpenClawCodingTools` / pi-tools passes
 *   `getPluginToolMeta` into `applyToolPolicyPipeline`.
 * - Catalog path uses `toolAllowlist: ["group:plugins"]` for plugin tools.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not Plugin schema / authz / errors / backward; not live plugin load fleet;
 * not full alsoAllow / sandbox / delivery-lane matrix; not HTTP /tools/invoke
 * replay (see API-03).
 *
 * Anchors: `tool-policy-pipeline.ts`, `tool-policy.ts`
 * (`expandPolicyWithPluginGroups` / `buildPluginToolGroups`),
 * `plugins/tools.ts` (`getPluginToolMeta` / `resolvePluginTools`),
 * `openclaw-tools.ts`, `pi-tools.ts`, `tools-catalog.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyToolPolicyPipeline } from "../../src/agents/tool-policy-pipeline.js";
import {
  buildPluginToolGroups,
  expandPolicyWithPluginGroups,
} from "../../src/agents/tool-policy.js";

type DummyTool = { name: string };

function names(tools: { name: string }[]): string[] {
  return tools.map((t) => t.name).toSorted();
}

describe("Stage 3 Plugin/SDK idempotency — same tool policy path (E1/E2 narrow)", () => {
  it("deny removes plugin tools via the same pipeline as core tools", () => {
    const tools = [
      { name: "exec" },
      { name: "plugin_demo" },
      { name: "read" },
    ] as unknown as DummyTool[];
    const filtered = applyToolPolicyPipeline({
      // oxlint-disable-next-line typescript/no-explicit-any
      tools: tools as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      toolMeta: (t: any) => (t.name === "plugin_demo" ? { pluginId: "demo-plugin" } : undefined),
      warn: () => {},
      steps: [
        {
          policy: { deny: ["plugin_demo", "exec"] },
          label: "tools.deny",
        },
      ],
    });
    expect(names(filtered as unknown as DummyTool[])).toEqual(["read"]);
  });

  it("group:plugins expands so allowlist treats plugin tools like named entries", () => {
    const tools = [
      { name: "exec" },
      { name: "plugin_a" },
      { name: "plugin_b" },
    ] as unknown as DummyTool[];
    const toolMeta = (t: DummyTool) =>
      t.name.startsWith("plugin_") ? { pluginId: "bundle" } : undefined;
    const groups = buildPluginToolGroups({
      tools: tools as unknown as { name: string }[],
      // oxlint-disable-next-line typescript/no-explicit-any
      toolMeta: toolMeta as any,
    });
    expect(groups.all.toSorted()).toEqual(["plugin_a", "plugin_b"]);
    expect(groups.byPlugin.get("bundle")?.toSorted()).toEqual(["plugin_a", "plugin_b"]);

    const expanded = expandPolicyWithPluginGroups({ allow: ["exec", "group:plugins"] }, groups);
    expect(expanded?.allow?.toSorted()).toEqual(["exec", "plugin_a", "plugin_b"]);

    const filtered = applyToolPolicyPipeline({
      // oxlint-disable-next-line typescript/no-explicit-any
      tools: tools as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      toolMeta: toolMeta as any,
      warn: () => {},
      steps: [
        {
          policy: { allow: ["exec", "group:plugins"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(names(filtered as unknown as DummyTool[])).toEqual(["exec", "plugin_a", "plugin_b"]);
  });

  it("allow without plugin entry keeps core and drops plugin tools", () => {
    const tools = [{ name: "exec" }, { name: "plugin_demo" }] as unknown as DummyTool[];
    const filtered = applyToolPolicyPipeline({
      // oxlint-disable-next-line typescript/no-explicit-any
      tools: tools as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      toolMeta: (t: any) => (t.name === "plugin_demo" ? { pluginId: "demo" } : undefined),
      warn: () => {},
      steps: [
        {
          policy: { allow: ["exec"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(names(filtered as unknown as DummyTool[])).toEqual(["exec"]);
  });

  it("openclaw-tools merges resolvePluginTools into the same tool array", () => {
    const source = readFileSync("src/agents/openclaw-tools.ts", "utf8");
    expect(source).toMatch(
      /import\s+\{\s*resolvePluginTools\s*\}\s+from\s+"\.\.\/plugins\/tools\.js"/,
    );
    expect(source).toMatch(/const\s+pluginTools\s*=\s*resolvePluginTools\s*\(/);
    expect(source).toMatch(/toolAllowlist:\s*options\?\.pluginToolAllowlist/);
    expect(source).toMatch(/return\s+\[\s*\.\.\.tools\s*,\s*\.\.\.pluginTools\s*\]/);
  });

  it("pi-tools applies applyToolPolicyPipeline with getPluginToolMeta", () => {
    const source = readFileSync("src/agents/pi-tools.ts", "utf8");
    expect(source).toMatch(
      /import\s+\{\s*getPluginToolMeta\s*\}\s+from\s+"\.\.\/plugins\/tools\.js"/,
    );
    expect(source).toMatch(/applyToolPolicyPipeline\s*\(\s*\{/);
    expect(source).toMatch(/toolMeta:\s*\(tool\)\s*=>\s*getPluginToolMeta\s*\(\s*tool\s*\)/);
  });

  it("tools.catalog loads plugin tools via group:plugins allowlist on the same resolver", () => {
    const source = readFileSync("src/gateway/server-methods/tools-catalog.ts", "utf8");
    expect(source).toMatch(/resolvePluginTools/);
    expect(source).toMatch(/toolAllowlist:\s*\[\s*"group:plugins"\s*\]/);
  });
});
