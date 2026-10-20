import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { CONTROL_UI_ENTERPRISE_BASE_PATH } from "./control-ui-contract.js";
import { handleEnterpriseSeatAssetsHttpRequest } from "./enterprise-seat-assets.js";
import { makeMockHttpResponse } from "./test-http-response.js";

function makeRequest(url: string, method: "GET" | "POST"): IncomingMessage {
  return { url, method, headers: {} } as IncomingMessage;
}

describe("handleEnterpriseSeatAssetsHttpRequest operational-identity delegation", () => {
  it("returns false for GET /identities so the next handler can serve the catalog", async () => {
    const { res } = makeMockHttpResponse();
    const handled = await handleEnterpriseSeatAssetsHttpRequest(
      makeRequest(`${CONTROL_UI_ENTERPRISE_BASE_PATH}/001/identities`, "GET"),
      res,
      { trustedProxy: undefined, localDirect: true },
    );
    expect(handled).toBe(false);
  });

  it("returns false for POST /identities/create", async () => {
    const { res } = makeMockHttpResponse();
    const handled = await handleEnterpriseSeatAssetsHttpRequest(
      makeRequest(`${CONTROL_UI_ENTERPRISE_BASE_PATH}/001/identities/create`, "POST"),
      res,
      { trustedProxy: undefined, localDirect: true },
    );
    expect(handled).toBe(false);
  });

  it("returns false for POST /identity-policies/upsert", async () => {
    const { res } = makeMockHttpResponse();
    const handled = await handleEnterpriseSeatAssetsHttpRequest(
      makeRequest(`${CONTROL_UI_ENTERPRISE_BASE_PATH}/001/identity-policies/upsert`, "POST"),
      res,
      { trustedProxy: undefined, localDirect: true },
    );
    expect(handled).toBe(false);
  });
});
