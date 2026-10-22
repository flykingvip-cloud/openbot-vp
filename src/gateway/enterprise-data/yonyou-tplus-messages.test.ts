import { createCipheriv } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEnterpriseDataConnectorOAuthHttpRequest } from "./connector-oauth-http.js";
import {
  listYonyouTplusMessageEvents,
  loadYonyouTplusAppTicket,
  loadYonyouTplusOrgPermanentAuth,
  saveYonyouTplusAppTicket,
} from "./yonyou-tplus-message-store.js";
import { YONYOU_TPLUS_CHANJET_MESSAGE_PATH } from "./yonyou-tplus-messages.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-yonyou-tplus-messages-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

function encrypt(plain: string, key: string): string {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

async function postMessage(body: unknown): Promise<{ statusCode: number; json: unknown }> {
  const req = new Readable({ read() {} }) as IncomingMessage;
  req.method = "POST";
  req.url = YONYOU_TPLUS_CHANJET_MESSAGE_PATH;
  req.headers = { host: "gw.example" };
  let payload = "";
  const res = {
    statusCode: 0,
    setHeader() {
      return res;
    },
    end(chunk?: string) {
      payload = chunk ?? "";
      return res;
    },
  } as unknown as ServerResponse;
  const pending = handleEnterpriseDataConnectorOAuthHttpRequest(req, res, {});
  req.push(JSON.stringify(body));
  req.push(null);
  const handled = await pending;
  expect(handled).toBe(true);
  return { statusCode: res.statusCode, json: JSON.parse(payload) as unknown };
}

describe("yonyou tplus chanjet messages", () => {
  beforeEach(() => {
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
    fs.mkdirSync(testPaths.tmpDir, { recursive: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("acknowledges the address-check message", async () => {
    const response = await postMessage({
      id: "msg-1",
      appKey: "ak-test",
      msgType: "APP_TEST",
      time: "1603877707372",
      bizContent: { message: "畅捷通开放平台消息测试" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ result: "success" });
    const events = await listYonyouTplusMessageEvents();
    expect(events[0]?.note).toBe("address_check");
  });

  it("stores an encrypted appTicket and still acknowledges", async () => {
    const key = "1234567890abcdef";
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MESSAGE_KEY", key);
    const plain = JSON.stringify({
      id: "msg-2",
      appKey: "ak-test",
      msgType: "APP_TICKET",
      time: "1603856412356",
      bizContent: { appTicket: "ticket-from-platform" },
    });
    const response = await postMessage({ encryptMsg: encrypt(plain, key) });
    expect(response.json).toEqual({ result: "success" });
    expect(await loadYonyouTplusAppTicket("ak-test")).toBe("ticket-from-platform");
  });

  it("exchanges an enterprise temp auth code and stubs other events", async () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "ak-test");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET", "as-test");
    await saveYonyouTplusAppTicket({
      appKey: "ak-test",
      appTicket: "ticket-1",
      receivedAt: "2026-10-22T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/auth/appAuth/getAppAccessToken")) {
          return Response.json({
            code: "200",
            result: { appAccessToken: "app-access", expireTime: 7200 },
          });
        }
        if (url.endsWith("/auth/orgAuth/getPermanentAuthCode")) {
          return Response.json({
            code: "200",
            result: {
              permanentAuthCode: "org-permanent",
              orgId: "90001198862",
              appName: "tpluscloud",
              appId: "59",
            },
          });
        }
        return Response.json({ code: "500", message: "unexpected" });
      }),
    );
    const exchanged = await postMessage({
      id: "msg-3",
      appKey: "ak-test",
      msgType: "TEMP_AUTH_CODE",
      time: "1603867062816",
      bizContent: { tempAuthCode: "temp-1", state: "xyz" },
    });
    expect(exchanged.json).toEqual({ result: "success" });
    const stored = await loadYonyouTplusOrgPermanentAuth("90001198862");
    expect(stored?.permanentAuthCode).toBe("org-permanent");
    expect(stored?.appName).toBe("tpluscloud");

    const stubbed = await postMessage({
      id: "msg-4",
      appKey: "ak-test",
      msgType: "APP_CANCEL_OPEN",
      time: "1718349976429",
      bizContent: { orgId: "90001198862" },
    });
    expect(stubbed.json).toEqual({ result: "success" });
    const events = await listYonyouTplusMessageEvents();
    expect(events[0]?.note).toBe("subscribed_event_stub");
    expect(events[0]?.orgId).toBe("90001198862");
  });
});
