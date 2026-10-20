import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { makeMockHttpResponse } from "../../../src/gateway/test-http-response.js";
import type { ResolvedWecomAccount } from "./types.js";
import {
  computeWecomSignature,
  decryptWecomPayload,
  encryptWecomPayload,
  handleWecomWebhookRequest,
  registerWecomWebhookTarget,
} from "./webhook.js";

describe("wecom webhook crypto", () => {
  const encodingAesKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const corpId = "ww1234567890";

  it("round-trips encrypted payloads", () => {
    const plainText =
      "<xml><MsgType><![CDATA[text]]></MsgType><FromUserName><![CDATA[u1]]></FromUserName><Content><![CDATA[hello]]></Content></xml>";
    const encrypted = encryptWecomPayload({
      encodingAesKey,
      plainText,
      corpId,
    });
    const decrypted = decryptWecomPayload({
      encodingAesKey,
      encrypted,
      corpId,
    });
    expect(decrypted).toBe(plainText);
  });

  it("computes stable callback signatures", () => {
    const signature = computeWecomSignature({
      token: "token-1",
      timestamp: "1710000000",
      nonce: "abc123",
      value: "ciphertext",
    });
    expect(signature).toMatch(/^[a-f0-9]{40}$/);
    expect(
      computeWecomSignature({
        token: "token-1",
        timestamp: "1710000000",
        nonce: "abc123",
        value: "ciphertext",
      }),
    ).toBe(signature);
  });

  it("returns the decrypted echostr for a signed callback verification request", async () => {
    const token = "test-token";
    const timestamp = "1710000000";
    const nonce = "abc123";
    const echoText = "wecom-callback-verified";
    const encryptedEcho = encryptWecomPayload({
      encodingAesKey,
      plainText: echoText,
      corpId,
    });
    const signature = computeWecomSignature({
      token,
      timestamp,
      nonce,
      value: encryptedEcho,
    });
    const account = {
      accountId: "default",
      enabled: true,
      configured: true,
      config: { webhookPath: "/wecom" },
      connectionMode: "callback",
      corpId,
      agentId: 1000001,
      secret: "test-secret",
      token,
      encodingAesKey,
    } satisfies ResolvedWecomAccount;
    const unregister = registerWecomWebhookTarget({
      account,
      config: { channels: { wecom: account.config } },
      path: "/wecom",
      runtime: {},
    });

    try {
      const query = new URLSearchParams({
        msg_signature: signature,
        timestamp,
        nonce,
        echostr: encryptedEcho,
      });
      const { res, end, setHeader } = makeMockHttpResponse();
      const handled = await handleWecomWebhookRequest(
        { method: "GET", url: `/wecom?${query.toString()}` } as IncomingMessage,
        res,
        async () => {},
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
      expect(end).toHaveBeenCalledWith(echoText);
    } finally {
      unregister();
    }
  });
});
