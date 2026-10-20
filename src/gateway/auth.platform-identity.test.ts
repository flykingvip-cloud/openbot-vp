import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Override only the platform-session reader; keep every other real export so the
// rest of the auth.ts dependency graph behaves normally.
const readPlatformAuthSessionFromRequest = vi.fn();
vi.mock("./platform-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform-auth.js")>();
  return { ...actual, readPlatformAuthSessionFromRequest };
});

const { authorizeGatewayConnect } = await import("./auth.js");

function makeLocalReq(): IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

describe("auth.mode=none identity decoupling (operational-identity-governance seam 1)", () => {
  beforeEach(() => {
    readPlatformAuthSessionFromRequest.mockReset();
  });

  it("attaches identity when a valid platform session exists under auth.mode=none", async () => {
    readPlatformAuthSessionFromRequest.mockResolvedValue({
      provider: "trusted-proxy",
      user: "alice@example.com",
      domain: "employee",
    });
    const res = await authorizeGatewayConnect({
      auth: { mode: "none", allowTailscale: false },
      connectAuth: null,
      req: makeLocalReq(),
    });
    expect(res).toMatchObject({
      ok: true,
      method: "trusted-proxy",
      user: "alice@example.com",
    });
  });

  it("stays anonymous when no platform session resolves (non-regression, R7)", async () => {
    // readPlatformAuthSessionFromRequest returns null for missing config, missing
    // cookie, AND invalid/forged signatures (it HMAC-verifies internally), so a
    // null result covers all "no trusted identity" cases.
    readPlatformAuthSessionFromRequest.mockResolvedValue(null);
    const res = await authorizeGatewayConnect({
      auth: { mode: "none", allowTailscale: false },
      connectAuth: null,
      req: makeLocalReq(),
    });
    expect(res).toEqual({ ok: true, method: "none" });
  });

  it("stays anonymous and skips session reads when no request is available", async () => {
    const res = await authorizeGatewayConnect({
      auth: { mode: "none", allowTailscale: false },
      connectAuth: null,
    });
    expect(res).toEqual({ ok: true, method: "none" });
    expect(readPlatformAuthSessionFromRequest).not.toHaveBeenCalled();
  });
});
