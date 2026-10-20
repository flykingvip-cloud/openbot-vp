import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe-http-api.mjs");

test("rejects loopback targets even when plain HTTP is explicitly enabled", () => {
  const result = spawnSync(
    process.execPath,
    [script, "--url", "http://127.0.0.1:8080/status", "--allow-http", "true"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error, /network policy/);
});

test("does not accept credentials without an environment variable", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--url",
      "https://8.8.8.8/status",
      "--header-name",
      "X-API-Key",
      "--api-key-env",
      "DEFINITELY_MISSING_SOURCE_KEY",
    ],
    { encoding: "utf8", env: { ...process.env, DEFINITELY_MISSING_SOURCE_KEY: "" } },
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error, /is not set/);
});
