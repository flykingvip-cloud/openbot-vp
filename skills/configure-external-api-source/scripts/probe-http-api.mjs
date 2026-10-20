#!/usr/bin/env node

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import process from "node:process";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

function fail(message) {
  console.log(JSON.stringify({ ok: false, errorType: "configuration", error: message }, null, 2));
  process.exit(1);
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    fail(`invalid argument near ${key ?? "end of command"}`);
  }
  args.set(key.slice(2), value);
}

const urlText = args.get("url");
if (!urlText) fail("--url is required");
let url;
try {
  url = new URL(urlText);
} catch {
  fail("--url must be a valid absolute URL");
}
if (url.protocol !== "https:" && args.get("allow-http") !== "true") {
  fail("plain HTTP requires --allow-http true");
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [first, second] = address.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
  fail("URL target is blocked by the network policy");
}
let resolvedAddress;
try {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    fail("URL target is blocked by the network policy");
  }
  resolvedAddress = addresses[0];
} catch (error) {
  fail(
    `URL hostname could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const method = (args.get("method") ?? "GET").toUpperCase();
if (!["GET", "HEAD", "POST"].includes(method)) {
  fail("--method must be GET, HEAD, or POST");
}

const headerName = args.get("header-name");
const apiKeyEnv = args.get("api-key-env");
const headers = { accept: args.get("accept") ?? "application/json" };
let secret = null;
if (headerName || apiKeyEnv) {
  if (!headerName || !apiKeyEnv) {
    fail("--header-name and --api-key-env must be provided together");
  }
  secret = process.env[apiKeyEnv];
  if (!secret) fail(`environment variable ${apiKeyEnv} is not set`);
  headers[headerName] = secret;
}

const timeoutMs = Number(args.get("timeout-ms") ?? "10000");
if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
  fail("--timeout-ms must be between 100 and 60000");
}

const body = args.get("body");
if (body !== undefined && Buffer.byteLength(body) > MAX_REQUEST_BODY_BYTES) {
  fail("request body exceeds 64 KiB");
}
if (body !== undefined) headers["content-type"] = args.get("content-type") ?? "application/json";
const startedAt = Date.now();

function headerValue(value) {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function requestPinned() {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      url,
      {
        method,
        headers,
        lookup: (_requestedHostname, _options, callback) => {
          callback(null, resolvedAddress.address, resolvedAddress.family);
        },
      },
      resolve,
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timed out")));
    request.once("error", reject);
    if (method === "POST" && body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

try {
  const response = await requestPinned();
  const contentType = headerValue(response.headers["content-type"]);
  const declaredBytes = Number(headerValue(response.headers["content-length"]) || "0");
  if (declaredBytes > MAX_RESPONSE_BYTES) {
    throw new Error("response exceeds 2 MiB");
  }
  let text = "";
  if (method !== "HEAD") {
    const chunks = [];
    let totalBytes = 0;
    for await (const value of response) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        response.destroy();
        throw new Error("response exceeds 2 MiB");
      }
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks, totalBytes).toString("utf8");
  }
  let parsed = null;
  let parseError = null;
  if (text && contentType.toLowerCase().includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const expectedField = args.get("expect-field");
  let fieldCursor = parsed;
  const fieldPresent = expectedField
    ? expectedField.split(".").every((segment) => {
        if (fieldCursor === null || typeof fieldCursor !== "object") return false;
        fieldCursor = fieldCursor[segment];
        return fieldCursor !== undefined;
      })
    : null;
  const previewChars = Number(args.get("preview-chars") ?? "0");
  if (!Number.isInteger(previewChars) || previewChars < 0 || previewChars > 2000) {
    throw new Error("--preview-chars must be an integer between 0 and 2000");
  }
  const preview = previewChars > 0 ? text.slice(0, previewChars) : null;
  const output = {
    ok:
      (response.statusCode ?? 0) >= 200 &&
      (response.statusCode ?? 0) < 300 &&
      !parseError &&
      fieldPresent !== false,
    url: `${url.origin}${url.pathname}`,
    method,
    status: response.statusCode ?? 0,
    latencyMs: Date.now() - startedAt,
    contentType: contentType || null,
    retryAfter: headerValue(response.headers["retry-after"]) || null,
    bytes: Buffer.byteLength(text),
    jsonParsed: parsed !== null,
    parseError,
    expectedField: expectedField ?? null,
    expectedFieldPresent: fieldPresent,
    preview: preview && secret ? preview.replaceAll(secret, "[REDACTED]") : preview,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.ok ? 0 : 2;
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        url: `${url.origin}${url.pathname}`,
        method,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
}
