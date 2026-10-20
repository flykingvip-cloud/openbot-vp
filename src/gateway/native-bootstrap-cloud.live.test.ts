/**
 * Gated LIVE check for the cloud `/native/bootstrap` flow (Wave 1 内部 beta 云连通).
 *
 * The gateway owner's Wave 1 deliverable is *verification that the cloud gateway
 * is reachable and the bootstrap chain works* — not a code change. This test
 * turns that verification into a committed, reproducible artifact instead of a
 * one-off manual curl session.
 *
 * It is a `*.live.test.ts` file, so the default `pnpm test` run EXCLUDES it
 * (see `vitest.config.ts`). It only runs under `pnpm test:live` (which sets
 * `OPENCLAW_LIVE_TEST=1` / `CLAWDBOT_LIVE_TEST=1`) or when you point vitest at
 * this file with the live config:
 *
 *   # reachability + unauthenticated contract (no credentials needed):
 *   OPENCLAW_LIVE_TEST=1 pnpm vitest run --config vitest.live.config.ts \
 *     src/gateway/native-bootstrap-cloud.live.test.ts
 *
 *   # full login -> mint -> consume -> 302, against a provisioned test employee:
 *   OPENCLAW_LIVE_TEST=1 \
 *   OPENCLAW_LIVE_EMPLOYEE_EMAIL='<employee email>' \
 *   OPENCLAW_LIVE_EMPLOYEE_PASSWORD='<password>' \
 *   pnpm vitest run --config vitest.live.config.ts \
 *     src/gateway/native-bootstrap-cloud.live.test.ts
 *
 * Env knobs (OPENBOT_* aliases also accepted):
 *   OPENCLAW_LIVE_GATEWAY_BASE_URL   default https://gw.openbot.love
 *   OPENCLAW_LIVE_EMPLOYEE_EMAIL     enables the authenticated 302 case
 *   OPENCLAW_LIVE_EMPLOYEE_PASSWORD  (never logged)
 */

import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../infra/env.js";
import { NATIVE_BOOTSTRAP_MINT_PATH, NATIVE_BOOTSTRAP_PATH } from "./native-bootstrap-http.js";

const LIVE =
  isTruthyEnvValue(process.env.OPENCLAW_LIVE_TEST) ||
  isTruthyEnvValue(process.env.CLAWDBOT_LIVE_TEST) ||
  isTruthyEnvValue(process.env.LIVE);

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) {
      return value;
    }
  }
  return "";
}

const BASE_URL = (
  env("OPENCLAW_LIVE_GATEWAY_BASE_URL", "OPENBOT_LIVE_GATEWAY_BASE_URL") ||
  "https://gw.openbot.love"
).replace(/\/+$/, "");
const EMAIL = env("OPENCLAW_LIVE_EMPLOYEE_EMAIL", "OPENBOT_LIVE_EMPLOYEE_EMAIL");
const PASSWORD = env("OPENCLAW_LIVE_EMPLOYEE_PASSWORD", "OPENBOT_LIVE_EMPLOYEE_PASSWORD");
const HAS_CREDS = EMAIL.length > 0 && PASSWORD.length > 0;

const LOGIN_PATH = "/__openbot/platform-auth/login";
const TARGET = "/embed/employee/overview";
const REQUEST_TIMEOUT_MS = 20_000;

type MintResponse = { ok: boolean; token: string; target: string; bootstrapPath: string };

async function call(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      redirect: "manual", // never follow the 302 — we assert on it directly
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Collect `name=value` pairs from Set-Cookie headers into a single Cookie header value. */
function cookieHeaderFrom(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies
    .map((raw) => raw.split(";", 1)[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");
}

describe.skipIf(!LIVE)(`native-bootstrap cloud live [${BASE_URL}]`, () => {
  it("gateway base URL is reachable", async () => {
    const res = await call("/", { method: "GET" });
    // Any non-5xx answer proves the edge/gateway is up and routing.
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });

  it(`${NATIVE_BOOTSTRAP_MINT_PATH} without a session -> 401`, async () => {
    const res = await call(`${NATIVE_BOOTSTRAP_MINT_PATH}?target=${encodeURIComponent(TARGET)}`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it(`${NATIVE_BOOTSTRAP_PATH} without a token -> 400`, async () => {
    const res = await call(NATIVE_BOOTSTRAP_PATH, { method: "GET" });
    expect(res.status).toBe(400);
  });

  it(`${NATIVE_BOOTSTRAP_PATH} with a bogus token -> 401`, async () => {
    const res = await call(
      `${NATIVE_BOOTSTRAP_PATH}?token=bogus-token&target=${encodeURIComponent(TARGET)}`,
      { method: "GET" },
    );
    expect(res.status).toBe(401);
  });

  it(`${NATIVE_BOOTSTRAP_MINT_PATH} with the wrong method -> 405 Allow: POST`, async () => {
    const res = await call(NATIVE_BOOTSTRAP_MINT_PATH, { method: "GET" });
    expect(res.status).toBe(405);
    expect((res.headers.get("allow") ?? "").toUpperCase()).toContain("POST");
  });

  // Full authenticated chain. Skips (does not fail) unless a test employee
  // account is supplied, so the reachability/contract cases above can still run
  // in environments without provisioned credentials.
  it.skipIf(!HAS_CREDS)(
    "login -> mint -> consume -> 302 to embed target (single-use)",
    async () => {
      // 1) Login establishes the platform-auth (employee) session cookie.
      const loginRes = await call(LOGIN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      expect(loginRes.status, "login should succeed for the test employee account").toBe(200);
      const cookie = cookieHeaderFrom(loginRes);
      expect(cookie, "login must set a session cookie").not.toBe("");

      // 2) Mint a one-time token using the login session cookie.
      const mintRes = await call(
        `${NATIVE_BOOTSTRAP_MINT_PATH}?target=${encodeURIComponent(TARGET)}`,
        {
          method: "POST",
          headers: { cookie },
        },
      );
      expect(mintRes.status).toBe(200);
      const minted = (await mintRes.json()) as MintResponse;
      expect(minted.ok).toBe(true);
      expect(typeof minted.token).toBe("string");
      expect(minted.target).toBe(TARGET);

      // 3) Consume the token -> 302 to the embed target + HttpOnly Set-Cookie.
      const consumeRes = await call(
        `${NATIVE_BOOTSTRAP_PATH}?token=${encodeURIComponent(minted.token)}&target=${encodeURIComponent(TARGET)}`,
        { method: "GET" },
      );
      expect(consumeRes.status).toBe(302);
      expect(consumeRes.headers.get("location")).toBe(TARGET);
      expect(consumeRes.headers.getSetCookie?.().length ?? 0).toBeGreaterThan(0);

      // 4) Single-use: replaying the consumed token -> 401.
      const replayRes = await call(
        `${NATIVE_BOOTSTRAP_PATH}?token=${encodeURIComponent(minted.token)}&target=${encodeURIComponent(TARGET)}`,
        { method: "GET" },
      );
      expect(replayRes.status).toBe(401);
    },
    60_000,
  );
});
