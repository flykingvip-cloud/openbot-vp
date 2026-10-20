import { isLoopbackHost } from "../gateway/net.js";

type HostSource = string | null | undefined;

type CanvasHostUrlParams = {
  canvasPort?: number;
  hostOverride?: HostSource;
  requestHost?: HostSource;
  forwardedProto?: HostSource | HostSource[];
  localAddress?: HostSource;
  scheme?: "http" | "https";
  /**
   * Explicit public base URL for canvas assets (e.g. `https://gw.example.com`).
   * Use when the gateway binds loopback behind a reverse proxy — remote nodes
   * cannot fetch `http://127.0.0.1:...` URLs advertised from the server.
   */
  baseUrl?: HostSource;
  /**
   * When true, never advertise loopback hosts. Remote node clients cannot reach
   * the gateway's loopback interface.
   */
  rejectLoopback?: boolean;
};

const normalizeHost = (value: HostSource, rejectLoopback: boolean) => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (rejectLoopback && isLoopbackHost(trimmed)) {
    return "";
  }
  return trimmed;
};

type ParsedHostHeader = {
  host: string;
  port?: number;
};

const parseHostHeader = (value: HostSource): ParsedHostHeader => {
  if (!value) {
    return { host: "" };
  }
  try {
    const parsed = new URL(`http://${String(value).trim()}`);
    const portRaw = parsed.port.trim();
    const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
    return {
      host: parsed.hostname,
      port: Number.isFinite(port) ? port : undefined,
    };
  } catch {
    return { host: "" };
  }
};

const parseForwardedProto = (value: HostSource | HostSource[]) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

/** Normalize `https://host[:port][/...]` to `scheme://host[:port]` (no path). */
export function normalizeCanvasHostBaseUrl(value: HostSource): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    if (!parsed.hostname) {
      return undefined;
    }
    const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${host}${port}`;
  } catch {
    return undefined;
  }
}

export function resolveCanvasHostUrl(params: CanvasHostUrlParams) {
  const configured = normalizeCanvasHostBaseUrl(params.baseUrl);
  if (configured) {
    return configured;
  }

  const port = params.canvasPort;
  if (!port) {
    return undefined;
  }

  const rejectLoopback = params.rejectLoopback === true;

  const scheme =
    params.scheme ??
    (parseForwardedProto(params.forwardedProto)?.trim() === "https" ? "https" : "http");

  const override = normalizeHost(params.hostOverride, true);
  const parsedRequestHost = parseHostHeader(params.requestHost);
  // Always drop loopback Host headers when rejecting loopback — a proxied or
  // tunnelled upgrade with Host: 127.0.0.1 must not be advertised to remote nodes.
  const requestHost = normalizeHost(parsedRequestHost.host, rejectLoopback || !!override);
  const localAddress = normalizeHost(
    params.localAddress,
    rejectLoopback || Boolean(override || requestHost),
  );

  const host = override || requestHost || localAddress;
  if (!host) {
    return undefined;
  }
  if (rejectLoopback && isLoopbackHost(host)) {
    return undefined;
  }

  // When the websocket is proxied over HTTPS (for example Tailscale Serve / nginx),
  // the gateway's internal listener still runs on 18789. In that case, expose the
  // public port instead of advertising the internal one back to clients.
  // Canvas assets are mounted on the gateway HTTP server (`/__openbot__/canvas/`).
  let exposedPort = port;
  if (!override && requestHost && (port === 18789 || rejectLoopback)) {
    if (parsedRequestHost.port && parsedRequestHost.port > 0) {
      exposedPort = parsedRequestHost.port;
    } else if (scheme === "https") {
      exposedPort = 443;
    } else if (scheme === "http") {
      exposedPort = 80;
    }
  }

  const formatted = host.includes(":") ? `[${host}]` : host;
  // Omit default ports for cleaner URLs when we remapped to 80/443.
  if ((scheme === "https" && exposedPort === 443) || (scheme === "http" && exposedPort === 80)) {
    return `${scheme}://${formatted}`;
  }
  return `${scheme}://${formatted}:${exposedPort}`;
}
