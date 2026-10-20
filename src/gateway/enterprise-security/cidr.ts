import { normalizeClientIp } from "./client-ip.js";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function ipv4ToInt(ip: string): number | null {
  if (!IPV4.test(ip)) {
    return null;
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function canonicalIpv4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) {
    return null;
  }
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

/** Exact IPv6 or IPv4, or an IPv4 CIDR. Returns the stored canonical form. */
export function canonicalAllowlistEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed || trimmed.length > 80 || /\s/.test(trimmed)) {
    return null;
  }
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    const normalized = normalizeClientIp(trimmed);
    if (!normalized) {
      return null;
    }
    const v4 = canonicalIpv4(normalized);
    if (v4) {
      return v4;
    }
    if (normalized.includes(":") && /^[0-9a-fA-F:]+$/.test(normalized)) {
      return normalized.toLowerCase();
    }
    return null;
  }
  const addr = canonicalIpv4(trimmed.slice(0, slash));
  const prefix = Number(trimmed.slice(slash + 1));
  if (!addr || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }
  return `${addr}/${prefix}`;
}

export function validateAllowlist(cidrs: string[]): { ok: true; cidrs: string[] } | { ok: false } {
  if (cidrs.length > 50) {
    return { ok: false };
  }
  const normalized: string[] = [];
  for (const entry of cidrs) {
    const canonical = canonicalAllowlistEntry(entry);
    if (!canonical) {
      return { ok: false };
    }
    normalized.push(canonical);
  }
  return { ok: true, cidrs: normalized };
}

function matchesEntry(ip: string, entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) {
    return ip.toLowerCase() === entry.toLowerCase();
  }
  const network = ipv4ToInt(entry.slice(0, slash));
  const address = ipv4ToInt(ip);
  const prefix = Number(entry.slice(slash + 1));
  if (network === null || address === null || !Number.isInteger(prefix)) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (network & mask) === (address & mask);
}

/** Empty allowlist permits every caller. A missing IP never matches a non-empty list. */
export function ipMatchesAllowlist(ip: string | undefined, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) {
    return true;
  }
  const normalized = normalizeClientIp(ip);
  if (!normalized) {
    return false;
  }
  const v4 = canonicalIpv4(normalized) ?? normalized;
  return cidrs.some((entry) => matchesEntry(v4, entry));
}
