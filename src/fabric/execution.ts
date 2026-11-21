import { spawn as nodeSpawn } from "node:child_process";
/**
 * execution.ts — Execution Plane: bind a gated node to TOL and run it (R5, R21).
 *
 * This is the boundary where Fabric delegates to the real tool surface. It:
 *  1. re-checks the gate invariant (node must carry a compile-time decision),
 *  2. resolves the adapter for the tool name,
 *  3. ENFORCES the precomputed constraints (maps to TOL controls — never
 *     re-decides policy, R21.2),
 *  4. delegates execution to an injected `ToolRunner` (the TOL boundary),
 *  5. returns a `ToolExecutionResult`; failures become `status:"failed"` and are
 *     never thrown as bare exceptions (R5.5).
 *
 * `ToolRunner` is a port: `createToolInvokerRunner` reuses the existing public
 * `/tools/invoke` surface (AOR `ToolInvoker`) for core/plugin tools. A native
 * process/sandbox runner (exec/shell/git spawn) plugs into the same port later
 * without changing the pipeline. TOL stays an independent kernel (not absorbed).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.5.
 */
import type { ToolInvoker } from "@openbot/aor-core";
import {
  operationIdentityFromIngress,
  executionOperationKey,
  type OperationIdentity,
} from "../agent-runtime/contracts/operation.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { toTolControls, type TolControls } from "./constraints.js";
import type {
  PolicyDecision,
  RuntimeNode,
  ToolAdapter,
  ToolExecutionResult,
  ToolRequest,
} from "./contract.js";
import type { ExecuteNode } from "./gateway.js";
import { constraintsFromDecision } from "./mappers.js";

/** A bound, constraint-carrying invocation handed to the TOL boundary. */
export interface ToolInvocation {
  /** Correlation only: not a durable deduplication claim or tenant authorization. */
  operationIdentity?: OperationIdentity;
  operationKey?: string;
  request: ToolRequest;
  adapter: ToolAdapter;
  /** Assembled argv (adapter argsTemplate expanded with request args). */
  argv: string[];
  /** Enforced TOL controls derived from the decision's constraints. */
  controls: TolControls;
}

/** Result from the TOL boundary (normalized stdout/stderr/exit). */
export interface RunnerResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/** The TOL execution boundary. Implementations actually run the tool. */
export interface ToolRunner {
  run(invocation: ToolInvocation): Promise<RunnerResult>;
}

let executionSeq = 0;
function nextExecutionId(): string {
  executionSeq += 1;
  return `exec-${Date.now()}-${executionSeq}`;
}

/** Expand an adapter argsTemplate; `${args}` expands to the request argv. */
export function expandArgs(template: string[] | undefined, args: string[]): string[] {
  if (!template) {
    return [...args];
  }
  const out: string[] = [];
  for (const token of template) {
    if (token === "${args}") {
      out.push(...args);
    } else {
      out.push(token);
    }
  }
  return out;
}

function gateableRequest(node: RuntimeNode): ToolRequest | null {
  return node.type === "tool" || node.type === "agent" ? node.request : null;
}

function result(
  nodeId: string,
  status: ToolExecutionResult["status"],
  start: number,
  extra: { stdout?: string; stderr?: string; exitCode?: number } = {},
): ToolExecutionResult {
  return {
    id: nodeId,
    status,
    output:
      extra.stdout !== undefined || extra.stderr !== undefined
        ? { stdout: extra.stdout, stderr: extra.stderr }
        : undefined,
    exitCode: extra.exitCode,
    timing: { start, end: Date.now() },
    trace: { policyDecisionId: nodeId, executionId: nextExecutionId() },
  };
}

/**
 * Build the gateway's injected `executeNode` from an adapter registry + a TOL
 * runner. Enforces the gate invariant and constraints; never throws. An optional
 * `agentRunner` handles cognitive (agent) nodes via the Kernel (AOR).
 */
export function buildExecuteNode(
  registry: AdapterRegistry,
  runner: ToolRunner,
  opts: { agentRunner?: ExecuteNode } = {},
): ExecuteNode {
  return async (node: RuntimeNode, decision: PolicyDecision): Promise<ToolExecutionResult> => {
    const start = Date.now();
    // Gate invariant (defense in depth): only ALLOW/MODIFY reach here.
    if (decision.decision === "DENY") {
      return result(node.id, "denied", start, { stderr: decision.reason });
    }
    const request = gateableRequest(node);
    if (!request) {
      return result(node.id, "failed", start, { stderr: `node "${node.id}" is not executable` });
    }
    // Agent (cognitive) nodes delegate to the Kernel, not the tool registry.
    if (node.type === "agent") {
      if (!opts.agentRunner) {
        return result(node.id, "failed", start, {
          stderr: `no agent runner configured for "${request.tool.name}"`,
        });
      }
      try {
        return await opts.agentRunner(node, decision);
      } catch (err) {
        return result(node.id, "failed", start, {
          stderr: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const adapter = registry.resolve(request.tool.name);
    if (!adapter) {
      return result(node.id, "failed", start, {
        stderr: `no adapter registered for tool "${request.tool.name}"`,
      });
    }
    const constraints = constraintsFromDecision(decision) ?? {};
    const controls = toTolControls(constraints);
    const argv = expandArgs(adapter.execute.argsTemplate, request.input.args ?? []);
    try {
      const operationIdentity =
        request.source.tenantId && request.trace.taskId
          ? operationIdentityFromIngress({
              ingress: "fabric",
              tenantId: request.source.tenantId,
              taskId: request.trace.taskId,
              persistedExecutionId: request.trace.correlationId,
              persistedStepId: node.id,
              persistedOperationId: request.id,
            })
          : undefined;
      const r = await runner.run({
        request,
        adapter,
        argv,
        controls,
        ...(operationIdentity
          ? { operationIdentity, operationKey: executionOperationKey(operationIdentity) }
          : {}),
      });
      return result(node.id, r.ok ? "success" : "failed", start, {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
      });
    } catch (err) {
      // Never leak a bare exception to the caller (R5.5).
      return result(node.id, "failed", start, {
        stderr: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * A `ToolRunner` backed by the public `/tools/invoke` surface (AOR `ToolInvoker`).
 * Routes core/plugin tools by name; structured args travel as `{ argv }`.
 */
export function createToolInvokerRunner(invoker: ToolInvoker): ToolRunner {
  return {
    async run(invocation: ToolInvocation): Promise<RunnerResult> {
      const { request } = invocation;
      const res = await invoker.invoke({
        tool: request.tool.name,
        args: { argv: invocation.argv },
        sessionKey: request.trace.sessionId,
        operationIdentity: invocation.operationIdentity,
      });
      if (!res.ok) {
        return { ok: false, stderr: res.error ?? "tool invocation failed" };
      }
      const stdout =
        typeof res.result === "string" ? res.result : JSON.stringify(res.result ?? null);
      return { ok: true, stdout };
    },
  };
}

/** Tunables for the native process-spawn runner. */
export interface ProcessRunnerOptions {
  /** cwd when the request does not specify one (default: `process.cwd()`). */
  defaultCwd?: string;
  /** Hard ceiling on runtime (ms) regardless of constraints (default 120s). */
  maxTimeoutMs?: number;
  /** Max captured bytes per stream (default 1 MiB); extra output is dropped. */
  maxBufferBytes?: number;
  /** Injectable spawn (tests). */
  spawnImpl?: typeof nodeSpawn;
}

/**
 * A `ToolRunner` that runs the adapter command as a real OS process (R8.4).
 *
 * This is the native execution boundary for declarative adapters whose
 * `execute.command` is an actual binary (e.g. `git`), as opposed to a registered
 * tool name routed through `/tools/invoke`. Safety posture:
 *  - argv is passed directly (`shell: false`) — no shell interpolation (R4.4),
 *  - the precomputed `timeoutMs` is enforced (process killed on overrun),
 *  - cwd/env come from the (already gated) request,
 *  - **fail-safe**: if the decision's constraints require a sandbox this runner
 *    cannot provide (`execHost === "sandbox"` / `sandbox.enabled`), it REFUSES
 *    rather than running unsandboxed (R21).
 *
 * It never bypasses the Policy Gate: `buildExecuteNode` only reaches a runner for
 * ALLOW/MODIFY nodes whose command-safety/allowlist/approval already cleared.
 */
export function createProcessRunner(opts: ProcessRunnerOptions = {}): ToolRunner {
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const maxTimeoutMs = opts.maxTimeoutMs ?? 120_000;
  const maxBufferBytes = opts.maxBufferBytes ?? 1024 * 1024;
  return {
    run(invocation: ToolInvocation): Promise<RunnerResult> {
      const { adapter, argv, controls, request } = invocation;
      // Fail-safe: never run unsandboxed when isolation was required.
      if (controls.execHost === "sandbox" || controls.sandbox?.enabled) {
        return Promise.resolve({
          ok: false,
          stderr: "process runner cannot satisfy required sandbox isolation",
        });
      }
      const command = adapter.execute.command;
      const timeoutMs = Math.min(controls.timeoutMs ?? maxTimeoutMs, maxTimeoutMs);
      const cwd = request.input.cwd ?? opts.defaultCwd ?? process.cwd();
      const env = request.input.env ? { ...process.env, ...request.input.env } : process.env;
      return new Promise<RunnerResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const done = (r: RunnerResult) => {
          if (!settled) {
            settled = true;
            resolve(r);
          }
        };
        let child: ReturnType<typeof spawnImpl>;
        try {
          child = spawnImpl(command, argv, { cwd, env, shell: false });
        } catch (err) {
          done({ ok: false, stderr: err instanceof Error ? err.message : String(err) });
          return;
        }
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          done({ ok: false, stderr: `process timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        const append = (buf: string, chunk: unknown): string =>
          buf.length >= maxBufferBytes ? buf : buf + String(chunk);
        child.stdout?.on("data", (c) => {
          stdout = append(stdout, c);
        });
        child.stderr?.on("data", (c) => {
          stderr = append(stderr, c);
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          done({ ok: false, stderr: err.message });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          done({
            ok: code === 0,
            stdout: stdout || undefined,
            stderr: stderr || undefined,
            exitCode: code ?? undefined,
          });
        });
      });
    },
  };
}

/**
 * Compose a native (process) runner and a tool (`/tools/invoke`) runner, routing
 * each invocation by adapter. By default an adapter is "native" when its id is
 * namespaced `generic.*` AND its command is not the `exec` tool surface — i.e.
 * declarative adapters that name a real binary (`git`). Everything else routes to
 * the tool surface. The predicate is overridable.
 */
export function createRoutingRunner(opts: {
  native: ToolRunner;
  tool: ToolRunner;
  isNative?: (invocation: ToolInvocation) => boolean;
}): ToolRunner {
  const isNative =
    opts.isNative ??
    ((invocation: ToolInvocation): boolean =>
      invocation.adapter.id.startsWith("generic.") &&
      invocation.adapter.execute.command !== "exec");
  return {
    run(invocation: ToolInvocation): Promise<RunnerResult> {
      return (isNative(invocation) ? opts.native : opts.tool).run(invocation);
    },
  };
}
