/**
 * Account-worker container client when the gateway image has a docker/podman
 * socket mounted but no `docker` binary on PATH.
 *
 * The CLI stays preferred (`OPENBOT_DOCKER_BIN` / `OPENCLAW_DOCKER_BIN`, then
 * `docker` on PATH). A mounted socket is the fallback client (Engine API over
 * the unix socket). Host exec is only for the case where both are absent.
 * A socket that exists but cannot be reached stays a visible error.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  formatProductionHostFallbackForbiddenMessage,
  isProductionExecutionModeEnabled,
  type ProductionExecutionModeProbe,
} from "./production-execution-mode.js";
import { userFacingEntitlementPreReplyFailure } from "./user-facing-entitlement-failure.js";

const log = createSubsystemLogger("docker-engine");

export const DOCKER_CLI_MISSING_CODE = "DOCKER_CLI_MISSING";

const API_PREFIX = "/v1.41";

export function formatDockerCliMissingUserMessage(): string {
  return "云电脑没有启动：网关里没有 docker 命令（DOCKER_CLI_MISSING）。已挂载的 docker.sock 或 podman.sock 会改走引擎接口；若套接字也不可用，这一轮改为在网关主机上继续，不会创建沙箱容器。请用 --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1 重新构建网关镜像。";
}

export class DockerCliMissingError extends Error {
  readonly code = DOCKER_CLI_MISSING_CODE;

  constructor(message = formatDockerCliMissingUserMessage()) {
    super(message);
    this.name = "DockerCliMissingError";
  }
}

/**
 * A socket path was present, but the engine did not accept the API call.
 * This is a daemon/permission failure, not a missing CLI. Callers must not
 * treat it as host fallback.
 */
export class DockerEngineUnreachableError extends Error {
  readonly code = "DOCKER_ENGINE_UNREACHABLE";

  constructor(socketPath: string, detail: string) {
    super(`cannot connect to the docker daemon at ${socketPath} (${detail})`);
    this.name = "DockerEngineUnreachableError";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

export function isDockerAccountWorkerUnavailableError(error: unknown): boolean {
  if (error instanceof DockerEngineUnreachableError) {
    return false;
  }
  if (error instanceof DockerCliMissingError) {
    return true;
  }
  if (error instanceof Error && error.cause && error.cause !== error) {
    if (isDockerAccountWorkerUnavailableError(error.cause)) {
      return true;
    }
  }
  const record =
    error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = errorText(error);
  if (code === DOCKER_CLI_MISSING_CODE) {
    return true;
  }
  // Spawn ENOENT for the docker binary only. A socket path that contains
  // "docker.sock" and fails with ENOENT is a daemon problem, not a missing CLI.
  if (
    code === "ENOENT" &&
    /spawn docker ENOENT|docker command was not found|"docker" command was not found/i.test(message)
  ) {
    return true;
  }
  return /DOCKER_CLI_MISSING|docker command was not found|Sandbox mode requires Docker|spawn docker ENOENT|"docker" command was not found/i.test(
    message,
  );
}

/**
 * Sandbox / account-worker infra that is not a per-model failure.
 * Model fallback must rethrow these instead of burning the next candidate.
 */
export function isSandboxInfraPreReplyError(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  return /云电脑没有启动|docker create failed|docker start failed|AccountWorkerFailedError|DOCKER_CLI_MISSING|cannot connect to the docker daemon|Sandbox mode requires Docker|docker command was not found|pull access denied|Unable to find image ['"]?openbot-sandbox|Unable to find image ['"]?openclaw-sandbox|Sandbox browser image not found/i.test(
    text,
  );
}

/** Prefer the 云电脑 line inside an "All models failed …" wrap. */
export function extractSandboxInfraUserFacingDetail(message: string): string | null {
  const text = message.trim();
  if (!text) {
    return null;
  }
  const cloudIdx = text.indexOf("云电脑没有启动");
  if (cloudIdx >= 0) {
    // Drop trailing "| other-provider/model: …" segments from fallback summaries.
    return text
      .slice(cloudIdx, cloudIdx + 400)
      .replace(/\s*\|\s*[^\n|]*$/u, "")
      .trim();
  }
  const createOrImageMiss =
    /docker create failed|docker start failed|Unable to find image|pull access denied|Sandbox browser image not found/i.test(
      text,
    );
  if (createOrImageMiss) {
    const compact = text.replace(/\s+/g, " ").trim().slice(0, 180);
    return `云电脑没有启动：${compact}`;
  }
  if (
    isDockerAccountWorkerUnavailableError(new Error(text)) ||
    /DOCKER_CLI_MISSING|docker command was not found|Sandbox mode requires Docker/i.test(text)
  ) {
    return formatDockerCliMissingUserMessage();
  }
  return null;
}

export function userFacingPreReplyFailure(message: string): string | null {
  const text = message.trim();
  if (!text) {
    return null;
  }
  const infra = extractSandboxInfraUserFacingDetail(text);
  if (infra) {
    return infra;
  }
  if (
    isDockerAccountWorkerUnavailableError(new Error(text)) ||
    text.includes("DOCKER_CLI_MISSING")
  ) {
    return formatDockerCliMissingUserMessage();
  }
  const entitlement = userFacingEntitlementPreReplyFailure(text);
  if (entitlement) {
    return entitlement;
  }
  return null;
}

export type AccountWorkerDockerFailureDecision =
  | { action: "raise" }
  | { action: "host"; failure: string }
  | { action: "visible-error"; failure: string };

/**
 * Missing client and missing socket degrade to host exec so the turn can still reply,
 * but only when production execution mode is not explicitly enabled.
 * Set `OPENBOT_PRODUCTION_EXECUTION_MODE=production` to forbid that host fallback
 * and return a visible error instead. `NODE_ENV` alone never enables this gate.
 * A mounted socket that refuses the connection, and other docker start failures,
 * stay visible errors and do not run on the host.
 */
export function decideAccountWorkerDockerFailure(
  error: unknown,
  probe: ProductionExecutionModeProbe = {},
): AccountWorkerDockerFailureDecision {
  const decision = decideAccountWorkerDockerFailureLegacy(error);
  if (decision.action === "host" && isProductionExecutionModeEnabled(probe)) {
    return {
      action: "visible-error",
      failure: formatProductionHostFallbackForbiddenMessage(decision.failure),
    };
  }
  return decision;
}

function decideAccountWorkerDockerFailureLegacy(
  error: unknown,
): AccountWorkerDockerFailureDecision {
  if (isDockerAccountWorkerUnavailableError(error)) {
    return { action: "host", failure: formatDockerCliMissingUserMessage() };
  }
  const message = errorText(error);
  if (
    !/AccountWorkerFailedError|docker create failed|docker start failed|cannot connect to the docker daemon|account worker did not reach RUNNING/i.test(
      message,
    )
  ) {
    return { action: "raise" };
  }
  const compact = message.replace(/\s+/g, " ").trim().slice(0, 180);
  return { action: "visible-error", failure: `云电脑没有启动：${compact}` };
}

export type DockerEngineRequest = (params: {
  socketPath: string;
  method: string;
  path: string;
  body?: unknown;
}) => Promise<{ status: number; body: string }>;

export type DockerTransport =
  | { kind: "cli"; bin: string; socketPath: string | null }
  | { kind: "socket"; socketPath: string }
  | { kind: "missing" };

type TransportProbe = {
  env?: NodeJS.ProcessEnv;
  pathExists?: (file: string) => boolean;
  isSocket?: (file: string) => boolean;
};

function defaultPathExists(file: string): boolean {
  try {
    fs.accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultIsSocket(file: string): boolean {
  try {
    return fs.statSync(file).isSocket();
  } catch {
    return false;
  }
}

function unixSocketFromEnv(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw.startsWith("unix://")) {
    return null;
  }
  const socketPath = raw.slice("unix://".length);
  return socketPath.startsWith("/") ? socketPath : null;
}

/** Absolute docker binary from OPENBOT_DOCKER_BIN / OPENCLAW_DOCKER_BIN, when executable. */
export function resolveConfiguredDockerExecutable(
  env: NodeJS.ProcessEnv,
  pathExists: (file: string) => boolean = defaultPathExists,
): string | null {
  const override = env.OPENBOT_DOCKER_BIN?.trim() || env.OPENCLAW_DOCKER_BIN?.trim() || "";
  if (override && pathExists(override)) {
    return override;
  }
  return null;
}

function cliCandidates(
  env: NodeJS.ProcessEnv,
  pathExists: (file: string) => boolean,
): string | null {
  const override = resolveConfiguredDockerExecutable(env, pathExists);
  if (override) {
    return override;
  }
  const pathValue = env.PATH ?? "";
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, "docker");
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function socketCandidates(env: NodeJS.ProcessEnv): string[] {
  const listed = [
    unixSocketFromEnv(env.DOCKER_HOST),
    unixSocketFromEnv(env.CONTAINER_HOST),
    "/var/run/docker.sock",
    "/run/docker.sock",
    "/run/podman/podman.sock",
    "/var/run/podman/podman.sock",
  ];
  const unique: string[] = [];
  for (const entry of listed) {
    if (entry && !unique.includes(entry)) {
      unique.push(entry);
    }
  }
  return unique;
}

export function resolveAccountWorkerDockerTransport(probe: TransportProbe = {}): DockerTransport {
  const env = probe.env ?? process.env;
  const pathExists = probe.pathExists ?? defaultPathExists;
  const isSocket = probe.isSocket ?? defaultIsSocket;
  const bin = cliCandidates(env, pathExists);
  const socketPath = socketCandidates(env).find((candidate) => isSocket(candidate)) ?? null;
  if (bin) {
    return { kind: "cli", bin, socketPath };
  }
  if (socketPath) {
    return { kind: "socket", socketPath };
  }
  return { kind: "missing" };
}

type EngineInspect = {
  State?: { Running?: boolean; StartedAt?: string };
  Mounts?: Array<{ Destination?: string; Source?: string }>;
  Config?: { Env?: string[] };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};

export function dockerEngineRequest(params: {
  socketPath: string;
  method: string;
  path: string;
  body?: unknown;
}): Promise<{ status: number; body: string }> {
  const payload = params.body === undefined ? null : Buffer.from(JSON.stringify(params.body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: params.socketPath,
        path: params.path,
        method: params.method,
        headers: {
          Host: "localhost",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(payload.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", (error) => {
      const errno = error as NodeJS.ErrnoException;
      const detail = errno.code ? `${errno.code}: ${error.message}` : error.message;
      reject(new DockerEngineUnreachableError(params.socketPath, detail));
    });
    if (payload) {
      req.end(payload);
    } else {
      req.end();
    }
  });
}

type CreateSpec = {
  name: string;
  image: string;
  cmd: string[];
  env: string[];
  binds: string[];
  ports: Array<{ hostIp: string; containerPort: number }>;
};

function rejectSocketBind(bind: string): void {
  const source = bind.split(":")[0] ?? "";
  const base = path.basename(source);
  if (
    base === "docker.sock" ||
    base === "podman.sock" ||
    source.includes(`${path.sep}docker.sock`)
  ) {
    throw new Error("Account worker docker driver refuses a docker.sock mount.");
  }
}

/** Parse controller-built `docker create` argv. Unknown flags are rejected. */
export function parseAccountWorkerDockerCreateArgs(args: string[]): CreateSpec {
  if (args[0] !== "create") {
    throw new Error("docker engine client expected a create command");
  }
  let name = "";
  const env: string[] = [];
  const binds: string[] = [];
  const ports: Array<{ hostIp: string; containerPort: number }> = [];
  const positionals: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index] ?? "";
    const next = args[index + 1];
    if (token === "--name" && next) {
      name = next;
      index += 1;
      continue;
    }
    // Local-only create: never registry-pull operator sandbox images.
    if (token === "--pull" && next) {
      index += 1;
      continue;
    }
    if (token.startsWith("--pull=")) {
      continue;
    }
    if (token === "-e" && next) {
      env.push(next);
      index += 1;
      continue;
    }
    if (token === "-v" && next) {
      rejectSocketBind(next);
      binds.push(next);
      index += 1;
      continue;
    }
    if (token === "-p" && next) {
      const parsed = parsePublish(next);
      ports.push(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`docker engine client refused flag ${token}`);
    }
    positionals.push(token);
  }
  const image = positionals[0] ?? "";
  if (!name || !image) {
    throw new Error("docker create is missing a name or image");
  }
  return { name, image, cmd: positionals.slice(1), env, binds, ports };
}

function parsePublish(spec: string): { hostIp: string; containerPort: number } {
  const match = /^([^:]+)::(\d+)(?:\/tcp)?$/.exec(spec.trim());
  if (!match) {
    throw new Error(`docker engine client refused publish spec ${spec}`);
  }
  const containerPort = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(containerPort)) {
    throw new Error(`docker engine client refused publish spec ${spec}`);
  }
  return { hostIp: match[1] ?? "127.0.0.1", containerPort };
}

function renderInspect(format: string, inspect: EngineInspect): string {
  if (format.trim() === "{{.State.Running}}") {
    return inspect.State?.Running ? "true" : "false";
  }
  if (format.includes("{{range .Config.Env}}")) {
    return `${(inspect.Config?.Env ?? []).join("\n")}\n`;
  }
  if (format.includes("{{range .Mounts}}")) {
    const running = inspect.State?.Running ? "true" : "false";
    const started = inspect.State?.StartedAt ?? "";
    const mounts = inspect.Mounts ?? [];
    const lines = mounts.map((mount) => `${mount.Destination ?? ""}=${mount.Source ?? ""}`);
    const head = `${running}\t${started}\t${lines[0] ?? ""}`;
    return [head, ...lines.slice(1)].join("\n");
  }
  throw new Error(`docker inspect format is not supported by the engine API client: ${format}`);
}

function renderPort(inspect: EngineInspect, portSpec: string): string {
  // Exited containers keep PortBindings. Publishing those ports makes noVNC
  // reconnect forever against a dead upstream.
  if (inspect.State?.Running !== true) {
    return "";
  }
  const key = portSpec.includes("/") ? portSpec : `${portSpec}/tcp`;
  const bindings = inspect.NetworkSettings?.Ports?.[key] ?? [];
  const lines = bindings
    .map((binding) => {
      const hostPort = binding.HostPort?.trim() ?? "";
      if (!hostPort) {
        return "";
      }
      const hostIp = binding.HostIp?.trim() || "0.0.0.0";
      return `${hostIp}:${hostPort}`;
    })
    .filter(Boolean);
  return lines.join("\n");
}

function createBody(spec: CreateSpec): Record<string, unknown> {
  const exposed: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};
  for (const published of spec.ports) {
    const key = `${published.containerPort}/tcp`;
    exposed[key] = {};
    portBindings[key] = [{ HostIp: published.hostIp, HostPort: "" }];
  }
  return {
    Image: spec.image,
    Cmd: spec.cmd,
    Env: spec.env,
    ExposedPorts: exposed,
    HostConfig: {
      Binds: spec.binds,
      PortBindings: portBindings,
    },
  };
}

async function engineCall(
  request: DockerEngineRequest,
  socketPath: string,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return request({ socketPath, method, path: `${API_PREFIX}${apiPath}`, body });
}

/** Split `name:tag`, keeping a registry port (`host:5000/repo:tag`). */
function splitDockerImageRef(ref: string): { repo: string; tag: string } {
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash && colon < ref.length - 1) {
    return { repo: ref.slice(0, colon), tag: ref.slice(colon + 1) };
  }
  return { repo: ref, tag: "latest" };
}

function imageInspectName(args: string[]): string {
  const positionals = args.slice(2).filter((arg) => arg && !arg.startsWith("-"));
  return positionals.at(-1) ?? "";
}

function softDockerFailure(
  message: string,
  allowFailure: boolean,
): { stdout: string; stderr: string; code: number } {
  if (!allowFailure) {
    throw new Error(message);
  }
  return { stdout: "", stderr: message, code: 1 };
}

/**
 * A missing verb is a client gap, not an engine HTTP error. Callers that passed
 * `allowFailure` (image inspect / tag) must get stderr + a non-zero code.
 * Throwing here used to skip that contract and abort the agent turn before a reply.
 */
function unimplementedVerb(
  verb: string,
  allowFailure: boolean,
): { stdout: string; stderr: string; code: number } {
  const message = `docker engine client does not implement: ${verb}`;
  if (!allowFailure) {
    throw new Error(message);
  }
  log.warn(message);
  return { stdout: "", stderr: message, code: 1 };
}

function asResult(
  status: number,
  body: string,
  allowFailure: boolean,
): { stdout: string; stderr: string; code: number } {
  if (status >= 200 && status < 300) {
    return { stdout: body, stderr: "", code: 0 };
  }
  const stderr = body.trim() || `docker engine API status ${status}`;
  if (!allowFailure) {
    throw new Error(stderr);
  }
  return { stdout: "", stderr, code: status === 0 ? 1 : status };
}

export async function runDockerEngineApi(
  args: string[],
  opts: {
    socketPath: string;
    allowFailure?: boolean;
    request?: DockerEngineRequest;
  },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const request = opts.request ?? dockerEngineRequest;
  const allowFailure = opts.allowFailure === true;
  const verb = args[0] ?? "";
  if (verb === "create") {
    const spec = parseAccountWorkerDockerCreateArgs(args);
    const created = await engineCall(
      request,
      opts.socketPath,
      "POST",
      `/containers/create?name=${encodeURIComponent(spec.name)}`,
      createBody(spec),
    );
    if (created.status === 409) {
      const stderr =
        created.body.trim() || `Conflict. The container name ${spec.name} is already in use`;
      if (!allowFailure) {
        throw new Error(stderr);
      }
      return { stdout: "", stderr, code: 1 };
    }
    return asResult(created.status, created.body, allowFailure);
  }
  if (verb === "start" || verb === "stop") {
    const name = args[1] ?? "";
    const response = await engineCall(
      request,
      opts.socketPath,
      "POST",
      `/containers/${encodeURIComponent(name)}/${verb}`,
    );
    if (response.status === 304) {
      return { stdout: "", stderr: "", code: 0 };
    }
    return asResult(response.status, response.body, allowFailure);
  }
  if (verb === "rm") {
    const name = args.filter((arg) => arg !== "-f" && arg !== "rm").at(-1) ?? "";
    const response = await engineCall(
      request,
      opts.socketPath,
      "DELETE",
      `/containers/${encodeURIComponent(name)}?force=1`,
    );
    if (response.status === 404) {
      return allowFailure
        ? { stdout: "", stderr: response.body, code: 1 }
        : asResult(response.status, response.body, false);
    }
    return asResult(response.status, response.body, allowFailure);
  }
  if (verb === "inspect") {
    const formatIndex = args.indexOf("-f");
    const format = formatIndex >= 0 ? (args[formatIndex + 1] ?? "") : "";
    const name = args.at(-1) ?? "";
    const response = await engineCall(
      request,
      opts.socketPath,
      "GET",
      `/containers/${encodeURIComponent(name)}/json`,
    );
    if (response.status === 404) {
      return allowFailure
        ? { stdout: "", stderr: response.body, code: 1 }
        : asResult(response.status, response.body, false);
    }
    if (response.status < 200 || response.status >= 300) {
      return asResult(response.status, response.body, allowFailure);
    }
    const inspect = JSON.parse(response.body) as EngineInspect;
    return { stdout: renderInspect(format, inspect), stderr: "", code: 0 };
  }
  if (verb === "port") {
    const name = args[1] ?? "";
    const portSpec = args[2] ?? "";
    const response = await engineCall(
      request,
      opts.socketPath,
      "GET",
      `/containers/${encodeURIComponent(name)}/json`,
    );
    if (response.status < 200 || response.status >= 300) {
      return asResult(response.status, response.body, allowFailure);
    }
    const inspect = JSON.parse(response.body) as EngineInspect;
    if (inspect.State?.Running !== true) {
      return { stdout: "", stderr: "container is not running", code: 1 };
    }
    return { stdout: renderPort(inspect, portSpec), stderr: "", code: 0 };
  }
  if (verb === "ps") {
    const filters = encodeURIComponent(JSON.stringify({ name: ["aw-browser-"] }));
    const response = await engineCall(
      request,
      opts.socketPath,
      "GET",
      `/containers/json?filters=${filters}`,
    );
    if (response.status < 200 || response.status >= 300) {
      return asResult(response.status, response.body, allowFailure);
    }
    const listed = JSON.parse(response.body) as Array<{ Names?: string[] }>;
    const names = listed
      .flatMap((entry) => entry.Names ?? [])
      .map((name) => name.replace(/^\//, ""))
      .filter((name) => name.startsWith("aw-browser-"));
    return { stdout: names.join("\n"), stderr: "", code: 0 };
  }
  if (verb === "image") {
    const sub = args[1] ?? "";
    if (sub !== "inspect") {
      return unimplementedVerb(sub ? `image ${sub}` : "image", allowFailure);
    }
    const name = imageInspectName(args);
    if (!name) {
      return softDockerFailure("docker image inspect is missing an image name", allowFailure);
    }
    const response = await engineCall(
      request,
      opts.socketPath,
      "GET",
      `/images/${encodeURIComponent(name)}/json`,
    );
    if (response.status === 404) {
      const stderr = /no such image|no such object/i.test(response.body)
        ? response.body
        : `No such image: ${name}${response.body.trim() ? `\n${response.body}` : ""}`;
      return softDockerFailure(stderr, allowFailure);
    }
    return asResult(response.status, response.body, allowFailure);
  }
  if (verb === "tag") {
    const from = args[1] ?? "";
    const to = args[2] ?? "";
    if (!from || !to) {
      return softDockerFailure("docker tag is missing a source or target", allowFailure);
    }
    const { repo, tag } = splitDockerImageRef(to);
    const response = await engineCall(
      request,
      opts.socketPath,
      "POST",
      `/images/${encodeURIComponent(from)}/tag?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`,
    );
    if (response.status === 404) {
      const stderr = response.body.trim() || `No such image: ${from}`;
      return softDockerFailure(stderr, allowFailure);
    }
    return asResult(response.status, response.body, allowFailure);
  }
  return unimplementedVerb(verb || "(empty)", allowFailure);
}

export async function executeAccountWorkerDockerCommand(
  args: string[],
  opts?: {
    allowFailure?: boolean;
    env?: NodeJS.ProcessEnv;
    runCli?: (
      args: string[],
      opts?: { allowFailure?: boolean },
    ) => Promise<{
      stdout: string;
      stderr: string;
      code: number;
    }>;
    request?: DockerEngineRequest;
    pathExists?: (file: string) => boolean;
    isSocket?: (file: string) => boolean;
  },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const transport = resolveAccountWorkerDockerTransport({
    env: opts?.env,
    pathExists: opts?.pathExists,
    isSocket: opts?.isSocket,
  });
  if (transport.kind === "cli") {
    if (!opts?.runCli) {
      const { execDocker } = await import("./docker.js");
      try {
        return await execDocker(args, { allowFailure: opts?.allowFailure });
      } catch (error) {
        if (!isDockerAccountWorkerUnavailableError(error) || !transport.socketPath) {
          throw error;
        }
        return runDockerEngineApi(args, {
          socketPath: transport.socketPath,
          allowFailure: opts?.allowFailure,
          request: opts?.request,
        });
      }
    }
    try {
      return await opts.runCli(args, { allowFailure: opts.allowFailure });
    } catch (error) {
      if (!isDockerAccountWorkerUnavailableError(error) || !transport.socketPath) {
        throw error;
      }
      return runDockerEngineApi(args, {
        socketPath: transport.socketPath,
        allowFailure: opts.allowFailure,
        request: opts.request,
      });
    }
  }
  if (transport.kind === "socket") {
    return runDockerEngineApi(args, {
      socketPath: transport.socketPath,
      allowFailure: opts?.allowFailure,
      request: opts?.request,
    });
  }
  throw new DockerCliMissingError();
}

export async function readDockerPortViaEngine(params: {
  socketPath: string;
  containerName: string;
  port: number;
  request?: DockerEngineRequest;
}): Promise<number | null> {
  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await runDockerEngineApi(["port", params.containerName, `${params.port}/tcp`], {
      socketPath: params.socketPath,
      allowFailure: true,
      request: params.request,
    });
  } catch (error) {
    if (error instanceof DockerEngineUnreachableError) {
      return null;
    }
    throw error;
  }
  if (result.code !== 0) {
    return null;
  }
  const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
  const match = /:(\d+)\s*$/.exec(line);
  if (!match) {
    return null;
  }
  const mapped = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(mapped) ? mapped : null;
}

export async function readDockerContainerEnvViaEngine(params: {
  socketPath: string;
  containerName: string;
  envVar: string;
  request?: DockerEngineRequest;
}): Promise<string | null> {
  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await runDockerEngineApi(
      ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", params.containerName],
      {
        socketPath: params.socketPath,
        allowFailure: true,
        request: params.request,
      },
    );
  } catch (error) {
    if (error instanceof DockerEngineUnreachableError) {
      return null;
    }
    throw error;
  }
  if (result.code !== 0) {
    return null;
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith(`${params.envVar}=`)) {
      return line.slice(params.envVar.length + 1);
    }
  }
  return null;
}

/**
 * Running / stopped / unknown from the engine API.
 * `unknown` means the socket could not be asked; callers must not treat that
 * as a dead browser.
 */
export async function readDockerContainerLivenessViaEngine(params: {
  socketPath: string;
  containerName: string;
  request?: DockerEngineRequest;
}): Promise<"running" | "stopped" | "unknown"> {
  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await runDockerEngineApi(
      ["inspect", "-f", "{{.State.Running}}", params.containerName],
      {
        socketPath: params.socketPath,
        allowFailure: true,
        request: params.request,
      },
    );
  } catch (error) {
    if (error instanceof DockerEngineUnreachableError) {
      return "unknown";
    }
    throw error;
  }
  if (result.code !== 0) {
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (text.includes("no such") || text.includes("not found")) {
      return "stopped";
    }
    return "unknown";
  }
  return result.stdout.trim() === "true" ? "running" : "stopped";
}
