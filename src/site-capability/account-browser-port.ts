/**
 * TrustedPagePort backed by the existing account-worker control bridge.
 *
 * Looks up BROWSER_BRIDGES by account-browser scopeKey and talks to the
 * control-plane HTTP API (browserNavigate + browserSnapshot aria). No CDP
 * read, no evaluate / script passthrough. Missing bridge → fail-closed
 * BROWSER_UNAVAILABLE (same observable fault as the previous default port).
 */

import type { Server } from "node:http";
import { BROWSER_BRIDGES } from "../agents/sandbox/browser-bridges.js";
import { setBridgeAuthForPort } from "../browser/bridge-auth-registry.js";
import type { BrowserBridge } from "../browser/bridge-server.js";
import { browserNavigate } from "../browser/client-actions-core.js";
import { browserSnapshot, type SnapshotAriaNode } from "../browser/client.js";
import type { BrowserServerState } from "../browser/server-context.js";
import { TrustedOperationFault, type TrustedPagePort } from "./operations.js";

/** Honest bridge kind for diagnostics and R2 acceptance wording. */
export type AccountBrowserBridgeKind = "control-bridge" | "fixture-bridge";

export type AccountBrowserBridgeRef = {
  baseUrl: string;
  kind: AccountBrowserBridgeKind;
};

/** Marker containerName for in-process HTTP fixture bridges used by tests. */
export const SAR_FIXTURE_BRIDGE_CONTAINER = "__sar_fixture_bridge__";

export function lookupAccountBrowserBridge(scopeKey: string): AccountBrowserBridgeRef | undefined {
  const key = scopeKey.trim();
  if (!key) {
    return undefined;
  }
  const entry = BROWSER_BRIDGES.get(key);
  if (!entry) {
    return undefined;
  }
  const baseUrl = entry.bridge?.baseUrl?.trim();
  if (!baseUrl) {
    return undefined;
  }
  return {
    baseUrl,
    kind:
      entry.containerName === SAR_FIXTURE_BRIDGE_CONTAINER ? "fixture-bridge" : "control-bridge",
  };
}

export const failClosedAccountBrowserPort: TrustedPagePort = {
  navigate: async () => {
    throw new TrustedOperationFault("BROWSER_UNAVAILABLE");
  },
  readFields: async () => {
    throw new TrustedOperationFault("BROWSER_UNAVAILABLE");
  },
  requestContext: async () => {
    throw new TrustedOperationFault("BROWSER_UNAVAILABLE");
  },
  capture: async () => {
    throw new TrustedOperationFault("BROWSER_UNAVAILABLE");
  },
};

/**
 * Default runtime factory: real control bridge when present, else fail-closed.
 * Cross-account isolation is by scopeKey lookup — bridge A is never used for scope B.
 */
export function createAccountBrowserPort(scopeKey: string): TrustedPagePort {
  const bridge = lookupAccountBrowserBridge(scopeKey);
  if (!bridge) {
    return failClosedAccountBrowserPort;
  }
  return createPortFromBridge(bridge);
}

function createPortFromBridge(bridge: AccountBrowserBridgeRef): TrustedPagePort {
  let lastUrl = "";
  return {
    async navigate(url: string) {
      try {
        const result = await browserNavigate(bridge.baseUrl, { url });
        lastUrl = result.url?.trim() || url;
        return { finalUrl: lastUrl };
      } catch (err) {
        throw mapBridgeFault(err);
      }
    },
    async readFields(fields) {
      const snap = await takeAriaSnapshot(bridge.baseUrl);
      lastUrl = snap.url || lastUrl;
      return extractFieldsFromAria(snap, fields);
    },
    async requestContext(name) {
      const snap = await takeAriaSnapshot(bridge.baseUrl);
      lastUrl = snap.url || lastUrl;
      let origin = "";
      try {
        origin = new URL(lastUrl || snap.url).origin;
      } catch {
        origin = "";
      }
      return {
        origin,
        data: {
          name,
          url: lastUrl || snap.url,
          nodeCount: snap.nodes.length,
        },
      };
    },
    async capture(fields) {
      const snap = await takeAriaSnapshot(bridge.baseUrl);
      lastUrl = snap.url || lastUrl;
      const strings = extractFieldsFromAria(snap, fields);
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(strings)) {
        data[key] = value;
      }
      if (fields.includes("nodes")) {
        data.nodes = snap.nodes;
      }
      return data;
    },
  };
}

type AriaSnap = {
  url: string;
  nodes: SnapshotAriaNode[];
};

async function takeAriaSnapshot(baseUrl: string): Promise<AriaSnap> {
  try {
    const snap = await browserSnapshot(baseUrl, { format: "aria" });
    if (!snap.ok || snap.format !== "aria") {
      throw new TrustedOperationFault("BROWSER_UNAVAILABLE");
    }
    return { url: snap.url, nodes: snap.nodes };
  } catch (err) {
    throw mapBridgeFault(err);
  }
}

/**
 * Map aria nodes onto declared field names without any page script.
 * Supports url / title, exact name match, ref match, and "field:value" names.
 */
function extractFieldsFromAria(
  snap: AriaSnap,
  fields: readonly string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of fields) {
    if (field === "url") {
      out[field] = snap.url || null;
      continue;
    }
    if (field === "title") {
      const title = snap.nodes.find(
        (node) => node.role === "document" || node.role === "RootWebArea",
      );
      out[field] = title?.name ?? null;
      continue;
    }
    const byName = snap.nodes.find((node) => node.name === field);
    if (byName) {
      out[field] = byName.value ?? byName.name;
      continue;
    }
    const byRef = snap.nodes.find((node) => node.ref === field);
    if (byRef) {
      out[field] = byRef.value ?? byRef.name;
      continue;
    }
    const prefixed = snap.nodes.find((node) => node.name.startsWith(`${field}:`));
    if (prefixed) {
      const rest = prefixed.name.slice(field.length + 1).trim();
      out[field] = rest || prefixed.value || null;
      continue;
    }
    out[field] = null;
  }
  return out;
}

function mapBridgeFault(err: unknown): TrustedOperationFault {
  if (err instanceof TrustedOperationFault) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/AUTH_REQUIRED|login required|not authenticated/i.test(message)) {
    return new TrustedOperationFault("AUTH_REQUIRED");
  }
  return new TrustedOperationFault("BROWSER_UNAVAILABLE");
}

/**
 * Install a loopback HTTP control-plane fixture into BROWSER_BRIDGES.
 * Honest label: kind === "fixture-bridge". Not a real account-worker CDP attach.
 */
export function installFixtureAccountBrowserBridge(opts: {
  scopeKey: string;
  baseUrl: string;
  port: number;
  authToken?: string;
}): void {
  const token = opts.authToken?.trim() || "sar-fixture-token";
  const bridge = {
    server: null as unknown as Server,
    port: opts.port,
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    state: {} as BrowserServerState,
  } as BrowserBridge;
  BROWSER_BRIDGES.set(opts.scopeKey.trim(), {
    bridge,
    containerName: SAR_FIXTURE_BRIDGE_CONTAINER,
    authToken: token,
  });
  setBridgeAuthForPort(opts.port, { token });
}

export function uninstallAccountBrowserBridge(scopeKey: string): void {
  BROWSER_BRIDGES.delete(scopeKey.trim());
}
