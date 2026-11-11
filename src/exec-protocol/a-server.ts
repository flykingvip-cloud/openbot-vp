import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AControlPlane } from "./a-control-plane.js";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError, isExecProtocolError } from "./errors.js";
import {
  assertExecApiVersion,
  hasJsonContentType,
  parseJsonObject,
  readRequestBody,
  writeJson,
  writeProtocolError,
} from "./http-json.js";
import { hashLeaseToken, parseBearerToken, validateLease } from "./lease.js";
import { FileExecStore } from "./store.js";
import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  ROLE_CONTROL_PLANE,
  SUCCESS_HTTP_IDEMPOTENT_OR_READ,
  type ExecLeaseRecord,
  type HostCommandProbe,
} from "./types.js";

export type AServerOptions = {
  config: ExecProtocolConfig;
  store: FileExecStore;
  plane: AControlPlane;
  maxRequestBodyBytes: number;
  now?: () => number;
  hostCommandProbe?: HostCommandProbe;
};

export class AControlServer {
  readonly role = ROLE_CONTROL_PLANE;
  readonly config: ExecProtocolConfig;
  readonly store: FileExecStore;
  readonly plane: AControlPlane;
  readonly maxRequestBodyBytes: number;
  private readonly now: () => number;
  private server: Server | undefined;
  private address: { host: string; port: number } | undefined;

  constructor(options: AServerOptions) {
    this.config = options.config;
    this.store = options.store;
    this.plane = options.plane;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes;
    this.now = options.now ?? (() => Date.now());
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.plane.loadAndReconcile();
    try {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.config.port, this.config.bind, () => resolve());
      });
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new ExecProtocolError("EXEC_INTERNAL", "A' server failed to bind a TCP port");
      }
      this.address = { host: addr.address, port: addr.port };
      return this.address;
    } catch (error) {
      this.server = undefined;
      this.address = undefined;
      await this.store.close();
      throw error;
    }
  }

  get listenAddress(): { host: string; port: number } {
    if (!this.address) {
      throw new ExecProtocolError("EXEC_INTERNAL", "A' server is not listening");
    }
    return this.address;
  }

  get baseUrl(): string {
    const addr = this.listenAddress;
    const bind = this.config.bind === "localhost" ? "127.0.0.1" : this.config.bind;
    const host = bind.includes(":") ? `[${bind}]` : bind;
    return `http://${host}:${addr.port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await this.store.close();
  }

  async registerLease(record: ExecLeaseRecord): Promise<void> {
    await this.store.putLease(record);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (method !== "POST") {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "isolation protocol routes accept POST JSON only",
        );
      }
      if (!hasJsonContentType(req.headers["content-type"])) {
        throw new ExecProtocolError(
          "EXEC_INTERNAL",
          "Content-Type must be application/json; charset=utf-8",
        );
      }
      const body = await readRequestBody(
        req,
        this.maxRequestBodyBytes,
        this.config.requestTimeoutMs,
      );
      const payload = parseJsonObject(body);
      assertExecApiVersion(payload);

      const token = parseBearerToken(req.headers.authorization);
      const hash = token ? hashLeaseToken(token) : undefined;
      const leaseRecord = hash ? this.store.getLeaseByHash(hash) : undefined;
      const tenantHint = typeof payload.tenantId === "string" ? payload.tenantId : undefined;
      const lease = validateLease({
        token,
        record: leaseRecord,
        nowMs: this.now(),
        config: this.config,
        requestTenantId: tenantHint,
      });

      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/v1/tasks") {
        const result = await this.plane.submit(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/tasks/status") {
        const result = await this.plane.status(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/tasks/cancel") {
        const result = await this.plane.cancel(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/tasks/artifact") {
        const result = await this.plane.artifact(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/artifacts/upload") {
        const result = await this.plane.upload(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/tasks/reconcile") {
        const result = await this.plane.reconcile(payload, lease);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/revoke") {
        const result = await this.plane.revoke(payload);
        writeJson(res, result.status, result.body);
        return;
      }
      if (path === "/v1/debug/site") {
        writeJson(res, SUCCESS_HTTP_IDEMPOTENT_OR_READ, {
          [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
          ...this.plane.debug(),
        });
        return;
      }
      throw new ExecProtocolError("EXEC_NOT_FOUND", "unknown protocol route");
    } catch (error) {
      if (isExecProtocolError(error)) {
        const includeTask =
          error.code !== "EXEC_UNAUTHORIZED" && error.code !== "EXEC_VERSION_UNSUPPORTED";
        writeProtocolError(res, error, { includeTask });
        return;
      }
      writeProtocolError(
        res,
        new ExecProtocolError(
          "EXEC_INTERNAL",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}
