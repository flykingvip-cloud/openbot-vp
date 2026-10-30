#!/usr/bin/env node
/**
 * Alternative evidence path for real loopback TCP HTTP (mode=listen).
 *
 * Prints one JSON object to stdout. Does NOT use MockAgent and never claims
 * MockAgent as Live TCP.
 *
 * Usage:
 *   node --import tsx scripts/evidence/prove-loopback-http.ts
 *   OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN=1 node --import tsx scripts/evidence/prove-loopback-http.ts
 *
 * Exit codes:
 *   0  — ok:true (listen evidence) OR ok:false skipped when REQUIRE unset
 *   1  — REQUIRE=1 and listen unavailable, or unexpected failure
 */
import { tryProveRealLoopbackHttp } from "../../src/test-utils/loopback-http-receiver.ts";

async function main(): Promise<number> {
  const requireListen = process.env.OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN === "1";
  try {
    const evidence = await tryProveRealLoopbackHttp({
      listenTimeoutMs: 2_000,
      requireListen,
    });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.ok) {
      return 0;
    }
    // skipped: honest non-PASS; exit 0 unless REQUIRE forces hard-fail (thrown above)
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          code: code ?? "REQUIRE_LISTEN_FAILED",
          skipped: false,
          requireListen,
          reason: message,
        },
        null,
        2,
      )}\n`,
    );
    return 1;
  }
}

const code = await main();
process.exit(code);
