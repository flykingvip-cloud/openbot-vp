import type { Server as HttpServer } from "node:http";
import { GatewayLockError } from "../../infra/gateway-lock.js";
import { describePortOwner } from "../../infra/ports.js";
import { sleep } from "../../utils.js";

const EADDRINUSE_MAX_RETRIES_DEFAULT = 4;
const EADDRINUSE_RETRY_INTERVAL_MS_DEFAULT = 500;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Bind-retry budget.
 *
 * The default (4 x 500ms) only covers a socket left in TIME_WAIT by a process that
 * exited cleanly. A container restart is harsher: `podman restart` SIGTERMs the old
 * gateway and only SIGKILLs it after the stop timeout, and with `--network host` an
 * orphaned predecessor can keep :18789 on the host namespace for far longer. When the
 * budget is too small the new instance exits non-zero, the restart policy relaunches it,
 * and the two crash-loop instead of converging. Deployments that restart in place should
 * raise the budget to at least their container stop timeout via these env vars; the
 * default is left alone so a local `gateway run` against an already-running gateway still
 * fails fast instead of hanging.
 */
function resolveEaddrinuseRetryPolicy(env: NodeJS.ProcessEnv = process.env): {
  maxRetries: number;
  intervalMs: number;
} {
  return {
    maxRetries: readPositiveInt(
      env.OPENBOT_GATEWAY_BIND_RETRIES ?? env.OPENCLAW_GATEWAY_BIND_RETRIES,
      EADDRINUSE_MAX_RETRIES_DEFAULT,
    ),
    intervalMs: readPositiveInt(
      env.OPENBOT_GATEWAY_BIND_RETRY_INTERVAL_MS ?? env.OPENCLAW_GATEWAY_BIND_RETRY_INTERVAL_MS,
      EADDRINUSE_RETRY_INTERVAL_MS_DEFAULT,
    ),
  };
}

async function closeServerQuietly(httpServer: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      httpServer.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export async function listenGatewayHttpServer(params: {
  httpServer: HttpServer;
  bindHost: string;
  port: number;
}) {
  const { httpServer, bindHost, port } = params;
  const { maxRetries, intervalMs } = resolveEaddrinuseRetryPolicy();

  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          httpServer.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          resolve();
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, bindHost);
      });
      return; // bound successfully
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && attempt < maxRetries) {
        // Port may still be in TIME_WAIT after a recent process exit; retry.
        await closeServerQuietly(httpServer);
        await sleep(intervalMs);
        continue;
      }
      if (code === "EADDRINUSE") {
        // Name the holder. Without this the failure is indistinguishable from a
        // healthy singleton guard, which is what made a container restart race read
        // as an unexplained crash loop instead of "an orphaned predecessor holds the
        // port". Diagnostics are best-effort: never mask the original bind failure.
        let owner: string | undefined;
        try {
          owner = await describePortOwner(port);
        } catch {
          owner = undefined;
        }
        throw new GatewayLockError(
          `another gateway instance is already listening on ws://${bindHost}:${port}` +
            (owner ? `\nport holder:\n${owner}` : ""),
          err,
        );
      }
      throw new GatewayLockError(
        `failed to bind gateway socket on ws://${bindHost}:${port}: ${String(err)}`,
        err,
      );
    }
  }
}
