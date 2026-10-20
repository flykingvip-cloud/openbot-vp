/**
 * Stage 3 six-column **CLI authz** slice (narrow E1/E2).
 *
 * Proposition (§5.2 CLI authz): Gateway-bound CLI commands inherit Gateway auth;
 * local filesystem commands document their trust assumption.
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 *
 * Anchors: `src/cli/gateway-rpc.ts` (`addGatewayClientOptions` / `callGatewayFromCli`),
 * `src/gateway/call.ts` (`ensureExplicitGatewayAuth`), `src/cli/local-files-cli.ts`,
 * `src/cli/program/register.backup.ts` + `docs/cli/backup.md`.
 * Not a live Gateway handshake suite; not CLI errors column; not full argv spawn.
 */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { addGatewayClientOptions, callGatewayFromCli } from "../../src/cli/gateway-rpc.js";
import { ensureExplicitGatewayAuth } from "../../src/gateway/call.js";

describe("Stage 3 CLI authz (E1/E2 narrow)", () => {
  it("addGatewayClientOptions exposes --url/--token/--password for Gateway auth inheritance", () => {
    const program = new Command();
    const cmd = program.command("sample");
    addGatewayClientOptions(cmd);
    const names = cmd.options.map((o) => o.long ?? o.short);
    expect(names).toEqual(
      expect.arrayContaining(["--url", "--token", "--password", "--timeout", "--expect-final"]),
    );
  });

  it("callGatewayFromCli wires token/password and CLI client identity into callGateway", () => {
    const src = readFileSync("src/cli/gateway-rpc.ts", "utf8");
    expect(src).toMatch(/password\?:\s*string/);
    expect(src).toMatch(/\.option\("--password <password>"/);
    expect(src).toMatch(/password:\s*opts\.password/);
    expect(src).toMatch(/clientName:\s*GATEWAY_CLIENT_NAMES\.CLI/);
    expect(src).toMatch(/mode:\s*GATEWAY_CLIENT_MODES\.CLI/);
    expect(src).toMatch(/token:\s*opts\.token/);
    // Exported helper is the shared inheritance path used by cron / local-files.
    expect(typeof callGatewayFromCli).toBe("function");
  });

  it("Gateway-facing CLI modules call through callGatewayFromCli or callGateway with CLI mode", () => {
    const cronAdd = readFileSync("src/cli/cron-cli/register.cron-add.ts", "utf8");
    const localFiles = readFileSync("src/cli/local-files-cli.ts", "utf8");
    const gatewayCall = readFileSync("src/cli/gateway-cli/call.ts", "utf8");
    expect(cronAdd).toMatch(/addGatewayClientOptions/);
    expect(cronAdd).toMatch(/callGatewayFromCli/);
    expect(localFiles).toMatch(/callGatewayFromCli/);
    expect(localFiles).toMatch(/\.option\("--password <password>"/);
    expect(localFiles).toMatch(/The key is read from the live/);
    expect(localFiles).toMatch(/authenticated node connection gateway-side/);
    expect(localFiles).toMatch(/operator to mistype or substitute/);
    expect(gatewayCall).toMatch(/clientName:\s*GATEWAY_CLIENT_NAMES\.CLI/);
    expect(gatewayCall).toMatch(/mode:\s*GATEWAY_CLIENT_MODES\.CLI/);
    expect(gatewayCall).toMatch(/password:\s*opts\.password/);
  });

  it("ensureExplicitGatewayAuth rejects CLI URL override without explicit credentials", () => {
    expect(() =>
      ensureExplicitGatewayAuth({
        urlOverride: "wss://attacker.example/ws",
        urlOverrideSource: "cli",
        explicitAuth: {},
        errorHint: "Fix: pass --token or --password.",
      }),
    ).toThrow(/explicit credentials/);

    expect(() =>
      ensureExplicitGatewayAuth({
        urlOverride: "wss://attacker.example/ws",
        urlOverrideSource: "cli",
        explicitAuth: { token: "t" },
        errorHint: "Fix: pass --token or --password.",
      }),
    ).not.toThrow();

    expect(() =>
      ensureExplicitGatewayAuth({
        urlOverride: "wss://attacker.example/ws",
        urlOverrideSource: "cli",
        explicitAuth: { password: "p" },
        errorHint: "Fix: pass --token or --password.",
      }),
    ).not.toThrow();
  });

  it("local backup command documents OS-user STATE_DIR trust and does not call Gateway", () => {
    const registerSrc = readFileSync("src/cli/program/register.backup.ts", "utf8");
    const docs = readFileSync("docs/cli/backup.md", "utf8");
    expect(registerSrc).toMatch(/backupCreateCommand/);
    expect(registerSrc).not.toMatch(/callGateway/);
    expect(registerSrc).toMatch(/local filesystem; no Gateway auth/);
    expect(registerSrc).toMatch(/does not call Gateway/);
    expect(docs).toMatch(/Trust assumption \(local filesystem command\)/);
    expect(docs).toMatch(/does \*\*not\*\* call the Gateway/);
    expect(docs).toMatch(/OS user/);
  });
});
