import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { BExecutionServer } from "./b-server.js";
import { encodeInlineJsonBytes, sha256Of } from "./checksum.js";
import { ExecHttpClient } from "./client.js";
import { isolationProfile, type ExecProtocolConfig } from "./config.js";
import { createHostCommandProbe } from "./host-fallback.js";
import { mintLease } from "./lease.js";
import { FileExecStore } from "./store.js";
import type { ExecInput, ExecLeaseRecord, HostCommandProbe } from "./types.js";

export const MAX_REQUEST_BODY_BYTES = 1_000_000;
export const TEST_TENANT = "tenant-isolation-1";
export const TEST_SUBJECT = "a-prime";

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a free loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function inlineJsonInput(json: unknown): ExecInput {
  const bytes = encodeInlineJsonBytes(json);
  return {
    kind: "inline-json",
    json,
    sha256: sha256Of(bytes),
    byteCount: bytes.byteLength,
  };
}

export function uniqueIdempotencyKey(prefix = "idem"): string {
  return `${prefix}-${sha256Of(Buffer.from(`${Date.now()}-${Math.random()}`, "utf8")).slice(0, 24)}`;
}

export async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 8000,
  intervalMs = 25,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for condition; last=${JSON.stringify(last)}`);
}

export type IsolatedPair = {
  a: AControlServer;
  b: BExecutionServer;
  plane: AControlPlane;
  probe: HostCommandProbe;
  aClient: ExecHttpClient;
  bClient: ExecHttpClient;
  leaseToken: string;
  leaseRecord: ExecLeaseRecord;
  aStore: FileExecStore;
  bStore: FileExecStore;
  aDir: string;
  bDir: string;
  configA: ExecProtocolConfig;
  configB: ExecProtocolConfig;
  tenantId: string;
  stop: () => Promise<void>;
};

export async function startIsolatedPair(
  overrides: Partial<ExecProtocolConfig> = {},
  options: { autoStartExecution?: boolean; leaseTenantId?: string | null } = {},
): Promise<IsolatedPair> {
  const aPort = await getFreePort();
  const bPort = await getFreePort();
  const aDir = await mkdtemp(join(tmpdir(), "exec-protocol-a-"));
  const bDir = await mkdtemp(join(tmpdir(), "exec-protocol-b-"));
  const configA = isolationProfile({ ...overrides, port: aPort });
  const configB = isolationProfile({ ...overrides, port: bPort });
  const leaseTenantId =
    options.leaseTenantId === undefined ? TEST_TENANT : options.leaseTenantId || undefined;
  const minted = mintLease({
    subject: TEST_SUBJECT,
    nowMs: Date.now(),
    ttlMs: configA.leaseTtlMs,
    tenantId: leaseTenantId,
  });
  const aStore = new FileExecStore(aDir);
  const bStore = new FileExecStore(bDir);
  await aStore.load();
  await bStore.load();
  const probe = createHostCommandProbe();
  const b = new BExecutionServer({
    config: configB,
    store: bStore,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    autoStartExecution: options.autoStartExecution,
    hostCommandProbe: probe,
  });
  await b.start();
  await b.registerLease(minted.record);
  const bClient = new ExecHttpClient({
    baseUrl: b.baseUrl,
    config: configA,
    leaseToken: minted.token,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
  });
  const plane = new AControlPlane({
    config: configA,
    store: aStore,
    client: bClient,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    hostCommandProbe: probe,
    subject: TEST_SUBJECT,
  });
  const a = new AControlServer({
    config: configA,
    store: aStore,
    plane,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    hostCommandProbe: probe,
  });
  await a.start();
  await a.registerLease(minted.record);
  const aClient = new ExecHttpClient({
    baseUrl: a.baseUrl,
    config: configA,
    leaseToken: minted.token,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
  });
  return {
    a,
    b,
    plane,
    probe,
    aClient,
    bClient,
    leaseToken: minted.token,
    leaseRecord: minted.record,
    aStore,
    bStore,
    aDir,
    bDir,
    configA,
    configB,
    tenantId: TEST_TENANT,
    stop: async () => {
      await a.stop();
      await b.stop();
      await aStore.close();
      await bStore.close();
      await rm(aDir, { recursive: true, force: true });
      await rm(bDir, { recursive: true, force: true });
    },
  };
}

export function baseSubmitBody(params: {
  input?: ExecInput;
  kind?: "echo" | "sleep" | "fail" | "side-effect-probe" | "corrupt-checksum" | "ignore-cancel";
  toolCallId?: string;
  idempotencyKey?: string;
  tenantId?: string;
  probeId?: string;
  sleepMs?: number;
}): Record<string, unknown> {
  return {
    "exec-api-version": 1,
    idempotencyKey: params.idempotencyKey ?? uniqueIdempotencyKey(),
    tenantId: params.tenantId ?? TEST_TENANT,
    toolCallId: params.toolCallId ?? uniqueIdempotencyKey("tool"),
    kind: params.kind ?? "echo",
    input: params.input ?? inlineJsonInput({ hello: "isolation" }),
    ...(params.probeId ? { probeId: params.probeId } : {}),
    ...(params.sleepMs !== undefined ? { sleepMs: params.sleepMs } : {}),
  };
}

export async function createReconcileClient(pair: IsolatedPair): Promise<{
  token: string;
  record: ExecLeaseRecord;
  client: ExecHttpClient;
}> {
  const minted = mintLease({
    subject: "reconcile-operator",
    nowMs: Date.now(),
    ttlMs: pair.configA.leaseTtlMs,
    tenantId: pair.tenantId,
    roles: ["reconcile"],
  });
  await pair.a.registerLease(minted.record);
  return {
    token: minted.token,
    record: minted.record,
    client: new ExecHttpClient({
      baseUrl: pair.a.baseUrl,
      config: pair.configA,
      leaseToken: minted.token,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    }),
  };
}

export function uniqueReconcileRequestId(prefix = "recon"): string {
  return uniqueIdempotencyKey(prefix);
}
