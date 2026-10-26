// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeUserOperationalIdentitySocialAction } from "./user-operational-identity-social-execution.js";
import type { UserOperationalIdentityCredentialSecret } from "./user-operational-identity-types.js";

function realSecret(): UserOperationalIdentityCredentialSecret {
  return {
    handleId: "h1",
    ownerId: "o1",
    provider: "x-twitter",
    kind: "oauth_token",
    accessToken: "test-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("P0a social action unsupported contract", () => {
  it("returns unsupported (not accepted) for unimplemented real actions", async () => {
    const output = await executeUserOperationalIdentitySocialAction({
      provider: "x-twitter",
      action: "search_tweets",
      payload: { message: "openbot" },
      secret: realSecret(),
    });
    expect(output.unsupported).toBe(true);
    expect(output.code).toBe("USER_IDENTITY_ACTION_UNSUPPORTED");
    expect(String(output.message)).toMatch(/not supported/i);
    expect(output).not.toHaveProperty("referenceId");
    expect(JSON.stringify(output)).not.toMatch(/accepted/i);
  });

  it("keeps post_tweet on the real HTTP path (does not mark unsupported)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "tw-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      const output = await executeUserOperationalIdentitySocialAction({
        provider: "x-twitter",
        action: "post_tweet",
        payload: { message: "hello from openbot" },
        secret: realSecret(),
      });
      expect(output.unsupported).toBeUndefined();
      expect(output.simulated).toBe(false);
      expect(output.tweetId).toBe("tw-1");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
