/**
 * Stage 3 six-column **Plugin/SDK errors** slice (narrow E1/E2).
 *
 * Proposition (§5.2 Plugin/SDK errors): rejection returns an error, not an
 * empty success — `{ ok: false, error: ... }` / diagnostics, never a silent
 * `{ ok: true }` or missing error payload.
 *
 * Evidence:
 * - `registerPluginCommand` rejects malformed / duplicate / reserved names
 *   with `ok: false` and a non-empty `error` string (never empty success).
 * - Registrar `registerCommand` surfaces `result.error` via
 *   `pushDiagnostic(level: "error")` and does not append to
 *   `record.commands` / `registry.commands` on failure.
 * - Plugin JSON Schema validation (`validateJsonSchemaValue`) returns
 *   `{ ok: false, errors: [...] }` with at least one error on invalid input.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not Plugin schema / authz / idempotency / backward; not live plugin load
 * fleet; not HTTP /tools/invoke (see API-03); not full install/update matrix.
 *
 * Anchors: `src/plugins/commands.ts` (`registerPluginCommand`),
 * `src/plugins/registry-registrars/cli-services-commands.ts` (`registerCommand`),
 * `src/plugins/schema-validator.ts` (`validateJsonSchemaValue`).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { clearPluginCommands, registerPluginCommand } from "../../src/plugins/commands.js";
import { validateJsonSchemaValue } from "../../src/plugins/schema-validator.js";

afterEach(() => {
  clearPluginCommands();
});

describe("Stage 3 Plugin/SDK errors — reject returns error, not empty success (E1/E2 narrow)", () => {
  it("registerPluginCommand rejects with ok:false and non-empty error (never empty success)", () => {
    const malformed = registerPluginCommand("demo-plugin", {
      name: undefined as unknown as string,
      description: "Demo",
      handler: async () => ({ text: "ok" }),
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(typeof malformed.error).toBe("string");
      expect(malformed.error.length).toBeGreaterThan(0);
    }

    const emptyDesc = registerPluginCommand("demo-plugin", {
      name: "demo",
      description: "   ",
      handler: async () => ({ text: "ok" }),
    });
    expect(emptyDesc).toEqual({
      ok: false,
      error: "Command description cannot be empty",
    });

    const ok = registerPluginCommand("demo-plugin", {
      name: "demo",
      description: "Demo",
      handler: async () => ({ text: "ok" }),
    });
    expect(ok).toEqual({ ok: true });

    const duplicate = registerPluginCommand("other-plugin", {
      name: "demo",
      description: "Other",
      handler: async () => ({ text: "ok" }),
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error).toMatch(/already registered/i);
      expect(duplicate.error.length).toBeGreaterThan(0);
    }
  });

  it("registerCommand registrar wires reject to error diagnostic, not silent success", () => {
    const source = readFileSync("src/plugins/registry-registrars/cli-services-commands.ts", "utf8");
    expect(source).toMatch(/const\s+result\s*=\s*registerPluginCommand\s*\(/);
    expect(source).toMatch(/if\s*\(\s*!result\.ok\s*\)/);
    expect(source).toMatch(/pushDiagnostic\s*\(\s*\{/);
    expect(source).toMatch(/level:\s*"error"/);
    expect(source).toMatch(/command registration failed:\s*\$\{result\.error\}/);
    // Success path only: push name after ok — reject must return before these.
    const failBlock = source.slice(
      source.indexOf("if (!result.ok)"),
      source.indexOf("record.commands.push"),
    );
    expect(failBlock).toMatch(/return;/);
    expect(failBlock).not.toMatch(/record\.commands\.push/);
  });

  it("validateJsonSchemaValue returns ok:false with non-empty errors on invalid value", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
      },
      required: ["name"],
      additionalProperties: false,
    } as const;

    const bad = validateJsonSchemaValue({
      schema: schema as unknown as Record<string, unknown>,
      cacheKey: "stage3-plugin-errors-evidence",
      value: {},
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Array.isArray(bad.errors)).toBe(true);
      expect(bad.errors.length).toBeGreaterThan(0);
      expect(bad.errors[0]?.message?.length ?? 0).toBeGreaterThan(0);
    }

    const good = validateJsonSchemaValue({
      schema: schema as unknown as Record<string, unknown>,
      cacheKey: "stage3-plugin-errors-evidence",
      value: { name: "ok" },
    });
    expect(good).toEqual({ ok: true });
  });
});
