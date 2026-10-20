import { describe, expect, it, vi } from "vitest";
import * as cliBackendProbe from "../../agents/cli-backend-probe.js";
import { probeLocalIdeLoginOnGateway } from "./local-ide-gateway-probe.js";

describe("probeLocalIdeLoginOnGateway", () => {
  it("detects grok-cli login via grok models on the gateway host", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "version") {
        return { ok: true, resolved: true, stdout: "grok 0.2.93" };
      }
      return {
        ok: true,
        resolved: true,
        stdout: "You are logged in with grok.com.",
      };
    });
    const result = await probeLocalIdeLoginOnGateway("grok-cli");
    expect(result?.installed).toBe(true);
    expect(result?.authenticated).toBe(true);
    expect(result?.source).toBe("probe");
    vi.restoreAllMocks();
  });

  it("detects cursor-cli login via whoami output", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "cursor-agent 1.0" };
      }
      return {
        ok: true,
        resolved: true,
        stdout: "Logged in as user@example.com",
      };
    });
    const result = await probeLocalIdeLoginOnGateway("cursor-cli");
    expect(result?.authenticated).toBe(true);
    vi.restoreAllMocks();
  });

  it("detects cursor-cli login when whoami prints Starting login process then success", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "cursor-agent 1.0" };
      }
      return {
        ok: true,
        resolved: true,
        stdout:
          "\n Starting login process...\n\nChecking authentication status...\n\n ✓ Login successful!\n Logged in (unable to fetch user details)\n",
      };
    });
    const result = await probeLocalIdeLoginOnGateway("cursor-cli");
    expect(result?.authenticated).toBe(true);
    vi.restoreAllMocks();
  });

  it("rejects cursor-cli when whoami reports not logged in", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "cursor-agent 1.0" };
      }
      return { ok: true, resolved: true, stdout: "Not logged in" };
    });
    const result = await probeLocalIdeLoginOnGateway("cursor-cli");
    expect(result?.authenticated).toBe(false);
    vi.restoreAllMocks();
  });

  it("detects kiro-cli login via whoami", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "kiro-cli 1.0" };
      }
      return { ok: true, resolved: true, stdout: "user@corp.example" };
    });
    const result = await probeLocalIdeLoginOnGateway("kiro-cli");
    expect(result?.authenticated).toBe(true);
    vi.restoreAllMocks();
  });

  it("returns null for workers without a gateway probe spec", async () => {
    expect(await probeLocalIdeLoginOnGateway("windsurf-cli")).toBeNull();
  });

  it("detects codex-cli login via login status", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "codex-cli 0.141.0" };
      }
      return {
        ok: true,
        resolved: true,
        stdout: "Logged in using an API key - sk-test",
      };
    });
    const result = await probeLocalIdeLoginOnGateway("codex-cli");
    expect(result?.installed).toBe(true);
    expect(result?.authenticated).toBe(true);
    vi.restoreAllMocks();
  });

  it("detects trae-cli login via login status", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockImplementation(async (_cmd, args) => {
      if (args?.[0] === "--version") {
        return { ok: true, resolved: true, stdout: "traecli 0.207.1" };
      }
      return {
        ok: true,
        resolved: true,
        stdout: "Logged in as user@example.com",
      };
    });
    const result = await probeLocalIdeLoginOnGateway("trae-cli");
    expect(result?.installed).toBe(true);
    expect(result?.authenticated).toBe(true);
    vi.restoreAllMocks();
  });
});
