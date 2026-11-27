import { expect, it } from "vitest";
import { adapterConfigFromEnv } from "./config.js";
it("selects an explicit test target without enabling it", () => {
  const config = adapterConfigFromEnv({
    OPENBOT_KNOWLEDGE_SDK_V2_BASE_URL: "http://127.0.0.1:12345",
    OPENBOT_KNOWLEDGE_SDK_V2_TEST_TENANTS: "t1, t2",
  });
  expect(config.enabled).toBe(false);
  expect(config.baseUrl).toBe("http://127.0.0.1:12345");
  expect(config.allowedTenantIds).toEqual(["t1", "t2"]);
});
