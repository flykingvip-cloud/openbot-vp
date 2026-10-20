import { EventEmitter } from "node:events";
import type { ToolInvoker } from "@openbot/aor-core";
import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry, BUILTIN_ADAPTERS } from "./adapter-registry.js";
import { GENERIC_ADAPTERS, GIT_ADAPTER } from "./adapters/shell-git.js";
import type { PolicyDecision, RuntimeNode, ToolRequest } from "./contract.js";
import {
  buildExecuteNode,
  createProcessRunner,
  createRoutingRunner,
  createToolInvokerRunner,
  expandArgs,
  type RunnerResult,
  type ToolInvocation,
  type ToolRunner,
} from "./execution.js";
import { compileAndRunSingle, type PipelineDeps } from "./gateway.js";
import { type GraphContext } from "./plan-adapter.js";

const ctx: GraphContext = { graphId: "g1", sessionId: "s1", correlationId: "c1" };

function req(name = "git", args: string[] = ["status"]): ToolRequest {
  return {
    id: "n1",
    source: { type: "cursor" },
    tool: { name },
    input: { args },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

function toolNode(request: ToolRequest): RuntimeNode {
  return { id: request.id, type: "tool", request, dependsOn: [], status: "pending" };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function registry() {
  return new AdapterRegistry([...BUILTIN_ADAPTERS, ...GENERIC_ADAPTERS]);
}

describe("execution — expandArgs", () => {
  it("expands ${args} token; passes through literals", () => {
    expect(expandArgs(["${args}"], ["status", "-s"])).toEqual(["status", "-s"]);
    expect(expandArgs(["--no-pager", "${args}"], ["log"])).toEqual(["--no-pager", "log"]);
    expect(expandArgs(undefined, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("execution — buildExecuteNode", () => {
  function captureRunner(): { runner: ToolRunner; calls: ToolInvocation[] } {
    const calls: ToolInvocation[] = [];
    const runner: ToolRunner = {
      run: vi.fn(async (inv: ToolInvocation): Promise<RunnerResult> => {
        calls.push(inv);
        return { ok: true, stdout: "ok", exitCode: 0 };
      }),
    };
    return { runner, calls };
  }

  it("resolves adapter, enforces constraints, returns success", async () => {
    const { runner, calls } = captureRunner();
    const execute = buildExecuteNode(registry(), runner);
    const MODIFY: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict" },
      matchedRules: [],
      decisionTrace: [],
    };
    const res = await execute(toolNode(req("git", ["status"])), MODIFY);
    expect(res.status).toBe("success");
    expect(res.output?.stdout).toBe("ok");
    // git adapter argsTemplate is ["${args}"] → argv expands to request args.
    expect(calls[0]?.argv).toEqual(["status"]);
    // strict sandbox constraint mapped to controls.
    expect(calls[0]?.controls.sandbox?.workspaceAccess).toBe("ro");
    expect(calls[0]?.controls.sandbox?.network).toBe(false);
  });

  it("fails (not throws) when no adapter is registered for the tool", async () => {
    const { runner } = captureRunner();
    const execute = buildExecuteNode(new AdapterRegistry([]), runner);
    const res = await execute(toolNode(req("unknown-tool")), ALLOW);
    expect(res.status).toBe("failed");
    expect(res.output?.stderr).toContain("no adapter");
  });

  it("converts runner failure into status:failed (no bare throw)", async () => {
    const runner: ToolRunner = {
      run: async () => {
        throw new Error("spawn exploded");
      },
    };
    const execute = buildExecuteNode(registry(), runner);
    const res = await execute(toolNode(req("git")), ALLOW);
    expect(res.status).toBe("failed");
    expect(res.output?.stderr).toBe("spawn exploded");
  });

  it("runner ok:false → status failed with stderr", async () => {
    const runner: ToolRunner = { run: async () => ({ ok: false, stderr: "nonzero exit" }) };
    const execute = buildExecuteNode(registry(), runner);
    const res = await execute(toolNode(req("git")), ALLOW);
    expect(res.status).toBe("failed");
    expect(res.output?.stderr).toBe("nonzero exit");
  });
});

describe("execution — createToolInvokerRunner (reuses /tools/invoke)", () => {
  it("maps a successful ToolInvoker result to stdout", async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: { lines: 3 } }));
    const invoker: ToolInvoker = { invoke };
    const runner = createToolInvokerRunner(invoker);
    const r = await runner.run({
      request: req("tools.invoke"),
      adapter: BUILTIN_ADAPTERS.find((a) => a.id === "builtin.tools_invoke")!,
      argv: ["x"],
      controls: { fs: {} },
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe(JSON.stringify({ lines: 3 }));
    expect(invoke).toHaveBeenCalledWith({
      tool: "tools.invoke",
      args: { argv: ["x"] },
      sessionKey: "s1",
    });
  });

  it("maps a ToolInvoker error to ok:false", async () => {
    const invoker: ToolInvoker = { invoke: async () => ({ ok: false, error: "denied upstream" }) };
    const runner = createToolInvokerRunner(invoker);
    const r = await runner.run({
      request: req("tools.invoke"),
      adapter: BUILTIN_ADAPTERS.find((a) => a.id === "builtin.tools_invoke")!,
      argv: [],
      controls: { fs: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe("denied upstream");
  });
});

type SpawnFn = typeof import("node:child_process").spawn;

function fakeSpawn(opts: {
  stdout?: string;
  stderr?: string;
  code?: number;
  emitError?: Error;
  throwOnSpawn?: Error;
  capture?: (cmd: string, argv: string[], spawnOpts: unknown) => void;
}): SpawnFn {
  return ((cmd: string, argv: string[], spawnOpts: unknown) => {
    opts.capture?.(cmd, argv, spawnOpts);
    if (opts.throwOnSpawn) {
      throw opts.throwOnSpawn;
    }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      if (opts.emitError) {
        child.emit("error", opts.emitError);
        return;
      }
      if (opts.stdout) {
        child.stdout.emit("data", opts.stdout);
      }
      if (opts.stderr) {
        child.stderr.emit("data", opts.stderr);
      }
      child.emit("close", opts.code ?? 0);
    });
    return child;
  }) as unknown as SpawnFn;
}

function gitInvocation(over: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    request: req("git", ["status"]),
    adapter: GIT_ADAPTER,
    argv: ["status"],
    controls: { fs: {} },
    ...over,
  };
}

describe("execution — createProcessRunner (native spawn, R8.4)", () => {
  it("spawns the binary with argv and maps exit 0 to ok:true", async () => {
    let captured: { cmd: string; argv: string[] } | undefined;
    const runner = createProcessRunner({
      spawnImpl: fakeSpawn({
        stdout: "On branch main",
        code: 0,
        capture: (cmd, argv) => (captured = { cmd, argv }),
      }),
    });
    const r = await runner.run(gitInvocation());
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("On branch main");
    expect(r.exitCode).toBe(0);
    expect(captured).toEqual({ cmd: "git", argv: ["status"] });
  });

  it("maps a nonzero exit to ok:false with the exit code + stderr", async () => {
    const runner = createProcessRunner({
      spawnImpl: fakeSpawn({ stderr: "fatal: not a repo", code: 128 }),
    });
    const r = await runner.run(gitInvocation());
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(128);
    expect(r.stderr).toBe("fatal: not a repo");
  });

  it("maps a spawn 'error' event to ok:false", async () => {
    const runner = createProcessRunner({
      spawnImpl: fakeSpawn({ emitError: new Error("ENOENT git") }),
    });
    const r = await runner.run(gitInvocation());
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe("ENOENT git");
  });

  it("never throws when spawn itself throws", async () => {
    const runner = createProcessRunner({
      spawnImpl: fakeSpawn({ throwOnSpawn: new Error("spawn EACCES") }),
    });
    const r = await runner.run(gitInvocation());
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe("spawn EACCES");
  });

  it("REFUSES (fail-safe) when constraints require a sandbox it cannot provide", async () => {
    const spawnImpl = vi.fn(fakeSpawn({ code: 0 }));
    const runner = createProcessRunner({ spawnImpl: spawnImpl as unknown as SpawnFn });
    const r = await runner.run(
      gitInvocation({
        controls: {
          fs: {},
          execHost: "sandbox",
          sandbox: { enabled: true, workspaceAccess: "ro", network: false },
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("sandbox");
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

describe("execution — createRoutingRunner", () => {
  it("routes generic.* binary adapters to native, others to the tool runner", async () => {
    const native: ToolRunner = { run: vi.fn(async () => ({ ok: true, stdout: "native" })) };
    const tool: ToolRunner = { run: vi.fn(async () => ({ ok: true, stdout: "tool" })) };
    const runner = createRoutingRunner({ native, tool });

    const gitRes = await runner.run(gitInvocation());
    expect(gitRes.stdout).toBe("native");

    const toolRes = await runner.run({
      request: req("tools.invoke"),
      adapter: BUILTIN_ADAPTERS.find((a) => a.id === "builtin.tools_invoke")!,
      argv: [],
      controls: { fs: {} },
    });
    expect(toolRes.stdout).toBe("tool");

    // shell adapter command is "exec" (a tool surface), so it routes to tool too.
    const shellRes = await runner.run({
      request: req("shell", ["ls"]),
      adapter: GENERIC_ADAPTERS.find((a) => a.id === "generic.shell")!,
      argv: ["ls"],
      controls: { fs: {} },
    });
    expect(shellRes.stdout).toBe("tool");
  });
});

describe("execution — end-to-end through the gateway pipeline", () => {
  it("ALLOW → executes via runner → success", async () => {
    const runner: ToolRunner = { run: async () => ({ ok: true, stdout: "done", exitCode: 0 }) };
    const deps: PipelineDeps = {
      decideFor: () => ALLOW,
      executeNode: buildExecuteNode(registry(), runner),
    };
    const res = await compileAndRunSingle(req("git", ["status"]), ctx, deps);
    expect(res.status).toBe("success");
    expect(res.output?.stdout).toBe("done");
  });
});
