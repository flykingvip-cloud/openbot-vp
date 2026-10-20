import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { DevicePlatformError, type DevicePlatformEnvironment } from "./types.js";

const BLOCKED_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
]);

const PRIVATE_NETS = new BlockList();
PRIVATE_NETS.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_NETS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NETS.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_NETS.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_NETS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NETS.addSubnet("192.0.0.0", 24, "ipv4");
PRIVATE_NETS.addSubnet("192.0.2.0", 24, "ipv4");
PRIVATE_NETS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_NETS.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE_NETS.addSubnet("198.51.100.0", 24, "ipv4");
PRIVATE_NETS.addSubnet("203.0.113.0", 24, "ipv4");
PRIVATE_NETS.addSubnet("224.0.0.0", 4, "ipv4");
PRIVATE_NETS.addSubnet("240.0.0.0", 4, "ipv4");
PRIVATE_NETS.addSubnet("fc00::", 7, "ipv6");
PRIVATE_NETS.addSubnet("fe80::", 10, "ipv6");
PRIVATE_NETS.addSubnet("ff00::", 8, "ipv6");
PRIVATE_NETS.addAddress("::", "ipv6");

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export function parseDevicePlatformEnvironment(
  value: string | undefined,
): DevicePlatformEnvironment {
  if (value === undefined || value.trim() === "") {
    return "production";
  }
  if (value === "production" || value === "staging" || value === "development") {
    return value;
  }
  throw new DevicePlatformError("VALIDATION", "environment is invalid");
}

/** Syntactic URL check. Rejects userinfo and non-HTTP schemes. Does not resolve DNS. */
export function normalizeServiceBaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl is required");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl is invalid");
  }
  if (url.username || url.password) {
    throw new DevicePlatformError("SECRET_REJECTED", "serviceBaseUrl must not contain credentials");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl is invalid");
  }
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}${path}`;
}

/**
 * Anti-SSRF gate for the connector base URL and callback allowlist.
 * Loopback is allowed only in development so the frozen device-control draft
 * on 127.0.0.1 can be tested. Production and staging require https and a public host.
 */
export function assertSafeServiceBaseUrl(
  value: string | undefined,
  environment: DevicePlatformEnvironment,
): string {
  const normalized = normalizeServiceBaseUrl(value);
  const url = new URL(normalized);
  if (environment !== "development" && url.protocol !== "https:") {
    throw new DevicePlatformError(
      "VALIDATION",
      "serviceBaseUrl must use https outside development",
    );
  }
  assertHostnameAllowed(url.hostname, environment);
  return normalized;
}

export function assertSafeCallbackUrl(
  value: string,
  environment: DevicePlatformEnvironment,
): string {
  return assertSafeServiceBaseUrl(value, environment);
}

/** Resolve the host and reject private, link-local, and metadata addresses. */
export async function assertResolvedServiceHost(
  serviceBaseUrl: string,
  environment: DevicePlatformEnvironment,
): Promise<void> {
  const hostname = new URL(serviceBaseUrl).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    assertIpAllowed(hostname, environment);
    return;
  }
  let records: Array<{ address: string }> = [];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host did not resolve");
  }
  if (records.length === 0) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host did not resolve");
  }
  for (const record of records) {
    assertIpAllowed(record.address, environment);
  }
}

function assertHostnameAllowed(hostname: string, environment: DevicePlatformEnvironment): void {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host || host === "0" || /^\d+$/.test(host)) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
  }
  const loopbackName = host === "localhost" || host.endsWith(".localhost");
  if (loopbackName) {
    if (environment !== "development") {
      throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
    }
    return;
  }
  if (
    BLOCKED_NAMES.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  ) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
  }
  if (isIP(host)) {
    assertIpAllowed(host, environment);
  }
}

function assertIpAllowed(address: string, environment: DevicePlatformEnvironment): void {
  const candidate = unwrapMappedIpv4(address.trim().toLowerCase());
  const family = isIP(candidate);
  if (family !== 4 && family !== 6) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
  }
  const type = family === 4 ? "ipv4" : "ipv6";
  if (LOOPBACK.check(candidate, type)) {
    if (environment !== "development") {
      throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
    }
    return;
  }
  if (PRIVATE_NETS.check(candidate, type)) {
    throw new DevicePlatformError("VALIDATION", "serviceBaseUrl host is not allowed");
  }
}

function unwrapMappedIpv4(address: string): string {
  const prefix = "::ffff:";
  if (address.startsWith(prefix)) {
    const rest = address.slice(prefix.length);
    if (isIP(rest) === 4) {
      return rest;
    }
  }
  return address;
}
