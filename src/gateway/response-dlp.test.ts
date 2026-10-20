import { describe, expect, it } from "vitest";
import { applyResponseDlp } from "./response-dlp.js";

describe("applyResponseDlp", () => {
  it("redacts internal deployment paths", () => {
    const result = applyResponseDlp("Config lives at deploy/production/nginx/openbot.conf");
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain("deploy/production");
    expect(result.text).toContain("[redacted-path]");
  });

  it("redacts private network addresses", () => {
    const result = applyResponseDlp("Gateway is at 10.0.0.5:18789");
    expect(result.redacted).toBe(true);
    expect(result.text).toContain("[redacted-ip]");
  });

  it("leaves benign text unchanged", () => {
    const input = "Here is a normal answer about your task.";
    const result = applyResponseDlp(input);
    expect(result.redacted).toBe(false);
    expect(result.text).toBe(input);
  });
});
