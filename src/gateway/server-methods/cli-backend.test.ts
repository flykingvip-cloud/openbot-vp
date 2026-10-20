import { describe, expect, it } from "vitest";
import { cliBackendHandlers } from "./cli-backend.js";

type RespondArgs = { ok: boolean; payload?: unknown; error?: unknown };
function capture() {
  const calls: RespondArgs[] = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) =>
    calls.push({ ok, payload, error });
  return { calls, respond };
}

function ctx(params: Record<string, unknown>, respond: ReturnType<typeof capture>["respond"]) {
  return {
    params,
    respond,
    client: null,
    req: {},
    isWebchatConnect: () => false,
    context: { logGateway: { info: () => {} } },
  } as never;
}

describe("cliBackend.list", () => {
  it("returns backends + presets + builtinIds (read, no side effects)", () => {
    const { calls, respond } = capture();
    void cliBackendHandlers["cliBackend.list"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      backends: Array<{ id: string }>;
      presets: Array<{ id: string }>;
      builtinIds: string[];
    };
    expect(payload.builtinIds).toEqual(
      expect.arrayContaining([
        "claude-cli",
        "codex-cli",
        "kiro-cli",
        "cursor-cli",
        "devin-cli",
        "grok-cli",
      ]),
    );
    expect(payload.presets.map((p) => p.id)).toEqual(
      expect.arrayContaining([
        "claude-cli",
        "codex-cli",
        "kiro-cli",
        "cursor-cli",
        "devin-cli",
        "grok-cli",
      ]),
    );
    expect(payload.backends.some((b) => b.id === "claude-cli")).toBe(true);
  });
});

describe("cliBackend.capabilities", () => {
  it("requires an id", () => {
    const { calls, respond } = capture();
    void cliBackendHandlers["cliBackend.capabilities"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(false);
  });

  it("returns declared capabilities for a builtin backend", () => {
    const { calls, respond } = capture();
    void cliBackendHandlers["cliBackend.capabilities"](ctx({ id: "claude-cli" }, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      backendId: string;
      models: unknown[];
      source: string;
    };
    expect(payload.backendId).toBe("claude-cli");
    expect(payload.source).toBe("declared");
    expect(Array.isArray(payload.models)).toBe(true);
  });
});

describe("cliBackend.upsert — validation (rejects before any write)", () => {
  it("rejects an invalid id", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.upsert"](
      ctx({ id: "Bad Id", config: { command: "kiro" } }, respond),
    );
    expect(calls[0]?.ok).toBe(false);
  });

  it("rejects an invalid config (missing command)", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.upsert"](ctx({ id: "kiro-cli", config: {} }, respond));
    expect(calls[0]?.ok).toBe(false);
  });
});

describe("cliBackend.remove — validation", () => {
  it("rejects removing a non-configured backend", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.remove"](
      ctx({ id: "definitely-not-configured-xyz" }, respond),
    );
    expect(calls[0]?.ok).toBe(false);
  });
});

describe("cliBackend.test — bounded executable probe", () => {
  it("requires a command or id", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.test"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(false);
  });

  it("probes an existing executable (node --version) → ok", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.test"](
      ctx({ command: "node", probeArgs: ["--version"] }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    const r = calls[0]?.payload as { ok: boolean; resolved: boolean; stdout?: string };
    expect(r.resolved).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("reports resolved=false for a missing executable", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.test"](
      ctx({ command: "openbot-no-such-binary-xyz", probeArgs: ["--version"] }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    const r = calls[0]?.payload as { ok: boolean; resolved: boolean };
    expect(r.ok).toBe(false);
    expect(r.resolved).toBe(false);
  });
});
