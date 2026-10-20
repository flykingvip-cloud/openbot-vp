/**
 * Stage 3 six-column **Plugin/SDK schema** slice (narrow E1/E2).
 *
 * Proposition (§5.2 Plugin/SDK schema): `src/plugin-sdk` surface + plugins
 * must not use the lint-prohibited HTTP registration (`registerHttpHandler`).
 * Allowed surface is `api.registerHttpRoute({ path, auth, match, handler })`
 * and `registerPluginHttpRoute` for dynamic webhook paths.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not Plugin authz / idempotency / errors / backward; not live plugin load
 * fleet; not full SDK export inventory (dist `check-plugin-sdk-exports`
 * after build); not Stage 1 cross-operator store.
 *
 * Anchors: `scripts/check-no-register-http-handler.mjs`,
 * `OpenClawPluginApi.registerHttpRoute` / `OpenClawPluginHttpRouteParams`,
 * `src/plugin-sdk/index.ts` (`registerPluginHttpRoute`,
 * `normalizePluginHttpPath`), `package.json` lint wiring.
 */
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDeprecatedRegisterHttpHandlerLines } from "../../scripts/check-no-register-http-handler.mjs";
import {
  collectTypeScriptFilesFromRoots,
  resolveSourceRoots,
} from "../../scripts/lib/ts-guard-utils.mjs";

describe("Stage 3 Plugin/SDK schema (E1/E2 narrow)", () => {
  it("lint finder flags registerHttpHandler and ignores registerHttpRoute", () => {
    const deprecated = findDeprecatedRegisterHttpHandlerLines(
      `api.registerHttpHandler({ path: "/legacy", handler: async () => true });`,
      "fixture.ts",
    );
    expect(deprecated.length).toBeGreaterThan(0);

    const allowed = findDeprecatedRegisterHttpHandlerLines(
      [
        `api.registerHttpRoute({ path: "/ok", auth: "plugin", handler: async () => true });`,
        `registerPluginHttpRoute({ path: "/dyn", auth: "gateway", handler: async () => true });`,
        `const registerHttpHandler = undefined; // not a property call`,
      ].join("\n"),
      "fixture.ts",
    );
    expect(allowed).toEqual([]);
  });

  it("OpenClawPluginApi exposes registerHttpRoute params, not registerHttpHandler", () => {
    const source = readFileSync("src/plugins/types.ts", "utf8");
    expect(source).toMatch(/export type OpenClawPluginHttpRouteParams\s*=\s*\{/);
    expect(source).toMatch(/path:\s*string/);
    expect(source).toMatch(/auth:\s*OpenClawPluginHttpRouteAuth/);
    expect(source).toMatch(
      /registerHttpRoute:\s*\(params:\s*OpenClawPluginHttpRouteParams\)\s*=>\s*void/,
    );
    // Deprecated API must not remain on the plugin surface type.
    expect(source).not.toMatch(/registerHttpHandler\s*:/);
  });

  it("plugin-sdk public index exports route helpers, not registerHttpHandler", () => {
    const source = readFileSync("src/plugin-sdk/index.ts", "utf8");
    expect(source).toContain(
      'export { registerPluginHttpRoute } from "../plugins/http-registry.js"',
    );
    expect(source).toContain('export { normalizePluginHttpPath } from "../plugins/http-path.js"');
    expect(source).toContain("emptyPluginConfigSchema");
    expect(source).not.toMatch(/registerHttpHandler/);
  });

  it("package.json wires no-register-http-handler into check + dedicated lint script", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:plugins:no-register-http-handler"]).toBe(
      "node scripts/check-no-register-http-handler.mjs",
    );
    expect(pkg.scripts.check).toContain("pnpm lint:plugins:no-register-http-handler");
  });

  it("production src+extensions trees have zero registerHttpHandler callsites", async () => {
    const repoRoot = process.cwd();
    const roots = resolveSourceRoots(repoRoot, ["src", "extensions"]);
    const files = await collectTypeScriptFilesFromRoots(roots, {});
    expect(files.length).toBeGreaterThan(1000);

    const violations: string[] = [];
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      for (const line of findDeprecatedRegisterHttpHandlerLines(content, filePath)) {
        violations.push(`${path.relative(repoRoot, filePath)}:${line}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  }, 60_000);
});
