import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { BExecutionServer } from "./b-server.js";
import { ExecHttpClient } from "./client.js";
import { isolationConfigToEnv, loadExecProtocolConfigFromEnv } from "./config.js";
import { ExecConfigError } from "./errors.js";
import { createHostCommandProbe } from "./host-fallback.js";
import { hashLeaseToken, isLeaseTokenFormat } from "./lease.js";
import { FileExecStore } from "./store.js";
import type { ExecLeaseRecord } from "./types.js";

const REQUIRED_PROCESS_ENV = [
  "OPENBOT_EXEC_PROTOCOL_ROLE",
  "OPENBOT_EXEC_PROTOCOL_STORE_DIR",
  "OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES",
  "OPENBOT_EXEC_PROTOCOL_SUBJECT",
] as const;

export async function runExecProtocolProcess(
  env: NodeJS.ProcessEnv,
): Promise<{ stop: () => Promise<void> }> {
  const missing: string[] = [];
  for (const key of REQUIRED_PROCESS_ENV) {
    if (!env[key] || env[key]?.trim() === "") {
      missing.push(key);
    }
  }
  const role = env.OPENBOT_EXEC_PROTOCOL_ROLE?.trim();
  if (
    role === "a" &&
    (!env.OPENBOT_EXEC_PROTOCOL_B_URL || env.OPENBOT_EXEC_PROTOCOL_B_URL.trim() === "")
  ) {
    missing.push("OPENBOT_EXEC_PROTOCOL_B_URL");
  }
  if (
    role === "a" &&
    (!env.OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE ||
      env.OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE.trim() === "")
  ) {
    missing.push("OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE");
  }
  if (missing.length > 0) {
    throw new ExecConfigError(
      `exec protocol process refused to start: missing ${missing.join(", ")}`,
      missing,
    );
  }
  const config = loadExecProtocolConfigFromEnv(env);
  const maxRequestBodyBytes = Number.parseInt(
    env.OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES ?? "",
    10,
  );
  if (!Number.isInteger(maxRequestBodyBytes) || maxRequestBodyBytes <= 0) {
    throw new ExecConfigError(
      "exec protocol process refused to start: OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES must be a positive integer",
      ["OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES"],
    );
  }
  const storeDir = env.OPENBOT_EXEC_PROTOCOL_STORE_DIR!.trim();
  const subject = env.OPENBOT_EXEC_PROTOCOL_SUBJECT!.trim();
  const store = new FileExecStore(storeDir);
  await store.load();

  const seedLease = env.OPENBOT_EXEC_PROTOCOL_SEED_LEASE?.trim();
  if (seedLease) {
    if (!isLeaseTokenFormat(seedLease)) {
      throw new ExecConfigError(
        "exec protocol process refused to start: seed lease has an invalid format",
        ["OPENBOT_EXEC_PROTOCOL_SEED_LEASE"],
      );
    }
    const nowMs = Date.now();
    const record: ExecLeaseRecord = {
      hash: hashLeaseToken(seedLease),
      subject,
      tenantId: env.OPENBOT_EXEC_PROTOCOL_SEED_LEASE_TENANT?.trim() || undefined,
      iat: new Date(nowMs).toISOString(),
      exp: new Date(nowMs + config.leaseTtlMs).toISOString(),
      iatMs: nowMs,
      expMs: nowMs + config.leaseTtlMs,
    };
    await store.putLease(record);
  }

  const hostCommandProbe = createHostCommandProbe();
  let stop: () => Promise<void>;
  let baseUrl: string;
  let listenPort: number;
  let processRole: "control-plane" | "execution-site";

  if (role === "b") {
    const server = new BExecutionServer({
      config,
      store,
      maxRequestBodyBytes,
      hostCommandProbe,
    });
    const addr = await server.start();
    baseUrl = server.baseUrl;
    listenPort = addr.port;
    processRole = "execution-site";
    stop = () => server.stop();
  } else if (role === "a") {
    const client = new ExecHttpClient({
      baseUrl: env.OPENBOT_EXEC_PROTOCOL_B_URL!.trim(),
      config,
      leaseToken: env.OPENBOT_EXEC_PROTOCOL_CLIENT_LEASE!.trim(),
      maxRequestBodyBytes,
    });
    const plane = new AControlPlane({
      config,
      store,
      client,
      maxRequestBodyBytes,
      hostCommandProbe,
      subject,
    });
    const server = new AControlServer({
      config,
      store,
      plane,
      maxRequestBodyBytes,
      hostCommandProbe,
    });
    const addr = await server.start();
    baseUrl = server.baseUrl;
    listenPort = addr.port;
    processRole = "control-plane";
    stop = () => server.stop();
  } else {
    throw new ExecConfigError(
      "exec protocol process refused to start: OPENBOT_EXEC_PROTOCOL_ROLE must be a or b",
      ["OPENBOT_EXEC_PROTOCOL_ROLE"],
    );
  }

  await mkdir(storeDir, { recursive: true });
  const ready = {
    role: processRole,
    port: listenPort,
    bind: config.bind,
    baseUrl,
    pid: process.pid,
    envEcho: isolationConfigToEnv(config),
  };
  await writeFile(join(storeDir, "ready.json"), `${JSON.stringify(ready, null, 2)}\n`, "utf8");
  process.stdout.write(`EXEC_PROTOCOL_READY ${listenPort}\n`);
  return { stop };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const running = await runExecProtocolProcess(env);
    const shutdown = async () => {
      await running.stop();
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
