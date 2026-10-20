/**
 * Stage 3 six-column **CLI idempotency** slice (narrow E1/E2).
 *
 * Proposition (§5.2 CLI idempotency): fast-path (`routes.ts`) and Commander
 * registration share the same command entrypoints for routed commands, so the
 * same argv reaches the same handler exit semantics. Incomplete/invalid
 * `--timeout` on the fast path returns false and falls through to Commander
 * (usage exit parity). Not Stage 3 overall PASS. stage8_eligible stays false.
 *
 * Anchors: `src/cli/program/routes.ts`, `register.status-health-sessions.ts`,
 * `src/cli/route.ts` (`tryRouteCli` fallthrough). Not a full argv spawn suite;
 * not CLI authz/errors columns.
 */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRoutedCommand } from "../../src/cli/program/routes.js";

const healthCommandMock = vi.hoisted(() =>
  vi.fn(async (_opts: unknown, runtime: { exit: (code: number) => void }) => {
    runtime.exit(7);
  }),
);
const statusCommandMock = vi.hoisted(() =>
  vi.fn(async (_opts: unknown, runtime: { exit: (code: number) => void }) => {
    runtime.exit(7);
  }),
);
const sessionsCommandMock = vi.hoisted(() =>
  vi.fn(async (_opts: unknown, runtime: { exit: (code: number) => void }) => {
    runtime.exit(7);
  }),
);

vi.mock("../../src/commands/health.js", () => ({
  healthCommand: healthCommandMock,
}));
vi.mock("../../src/commands/status.js", () => ({
  statusCommand: statusCommandMock,
}));
vi.mock("../../src/commands/sessions.js", () => ({
  sessionsCommand: sessionsCommandMock,
}));

const exitMock = vi.hoisted(() => vi.fn());
const errorMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: errorMock,
    exit: exitMock,
  },
}));

describe("Stage 3 CLI idempotency (E1/E2 narrow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes and Commander registration both import the same status/health/sessions commands", () => {
    const routesSrc = readFileSync("src/cli/program/routes.ts", "utf8");
    const registerSrc = readFileSync("src/cli/program/register.status-health-sessions.ts", "utf8");
    expect(routesSrc).toMatch(/import\("\.\.\/\.\.\/commands\/health\.js"\)/);
    expect(routesSrc).toMatch(/import\("\.\.\/\.\.\/commands\/status\.js"\)/);
    expect(routesSrc).toMatch(/import\("\.\.\/\.\.\/commands\/sessions\.js"\)/);
    expect(registerSrc).toMatch(/from "\.\.\/\.\.\/commands\/health\.js"/);
    expect(registerSrc).toMatch(/from "\.\.\/\.\.\/commands\/status\.js"/);
    expect(registerSrc).toMatch(/from "\.\.\/\.\.\/commands\/sessions\.js"/);
  });

  it("tryRouteCli falls through when OPENCLAW_DISABLE_ROUTE_FIRST is set", async () => {
    const routeSrc = readFileSync("src/cli/route.ts", "utf8");
    expect(routeSrc).toMatch(/OPENCLAW_DISABLE_ROUTE_FIRST/);
    expect(routeSrc).toMatch(/findRoutedCommand/);
    expect(routeSrc).toMatch(/return route\.run\(argv\)/);
  });

  it("fast-path falls through on incomplete or invalid --timeout (Commander usage path)", async () => {
    const health = findRoutedCommand(["health"]);
    const status = findRoutedCommand(["status"]);
    expect(health).not.toBeNull();
    expect(status).not.toBeNull();

    await expect(health!.run(["node", "openbot", "health", "--timeout"])).resolves.toBe(false);
    await expect(health!.run(["node", "openbot", "health", "--timeout", "nope"])).resolves.toBe(
      false,
    );
    await expect(status!.run(["node", "openbot", "status", "--timeout=nope"])).resolves.toBe(false);
    expect(healthCommandMock).not.toHaveBeenCalled();
    expect(statusCommandMock).not.toHaveBeenCalled();
  });

  it("fast-path and Commander invoke the same healthCommand and share exit code", async () => {
    const route = findRoutedCommand(["health"]);
    expect(route).not.toBeNull();
    await expect(
      route!.run(["node", "openbot", "health", "--json", "--timeout", "5000"]),
    ).resolves.toBe(true);
    expect(healthCommandMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(7);
    const routeOpts = healthCommandMock.mock.calls[0][0];

    exitMock.mockClear();
    healthCommandMock.mockClear();

    const { registerStatusHealthSessionsCommands } =
      await import("../../src/cli/program/register.status-health-sessions.js");
    const program = new Command();
    program.exitOverride();
    registerStatusHealthSessionsCommands(program);
    await program.parseAsync(["node", "openbot", "health", "--json", "--timeout", "5000"]);
    expect(healthCommandMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(7);
    expect(healthCommandMock.mock.calls[0][0]).toEqual(routeOpts);
  });

  it("fast-path and Commander invoke the same statusCommand and share exit code", async () => {
    const route = findRoutedCommand(["status"]);
    expect(route).not.toBeNull();
    await expect(
      route!.run(["node", "openbot", "status", "--json", "--deep", "--timeout", "3000"]),
    ).resolves.toBe(true);
    expect(statusCommandMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(7);
    const routeOpts = statusCommandMock.mock.calls[0][0];

    exitMock.mockClear();
    statusCommandMock.mockClear();

    const { registerStatusHealthSessionsCommands } =
      await import("../../src/cli/program/register.status-health-sessions.js");
    const program = new Command();
    program.exitOverride();
    registerStatusHealthSessionsCommands(program);
    await program.parseAsync([
      "node",
      "openbot",
      "status",
      "--json",
      "--deep",
      "--timeout",
      "3000",
    ]);
    expect(statusCommandMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(7);
    expect(statusCommandMock.mock.calls[0][0]).toEqual(routeOpts);
  });
});
