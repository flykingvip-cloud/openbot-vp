import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  requireTenantId,
  resolveServingAgentCatalogPort,
  type AgentCatalogEntity,
} from "./agent-catalog-port.js";

export const CONTROL_PLANE_AGENT_CATALOG_BASE_PATH = "/__openbot/control-plane/v1/tenants";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body)}\n`);
}

function readBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization?.trim() ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function authorizeControlPlaneRequest(params: {
  req: IncomingMessage;
  localDirect?: boolean;
}): boolean {
  const expected = process.env.OPENBOT_CONTROL_PLANE_TOKEN?.trim();
  if (!expected) {
    // No token configured: allow only loopback/direct (dev) or any (self-host lab).
    return params.localDirect !== false;
  }
  return readBearerToken(params.req) === expected;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function matchCatalogRoute(
  pathname: string,
  basePath = "",
): {
  tenantId: string;
  agentId?: string;
} | null {
  const prefix = `${basePath}${CONTROL_PLANE_AGENT_CATALOG_BASE_PATH}`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length).replace(/^\/+/, "");
  // {tenantId}/agent-catalog[/{agentId}]
  const match = rest.match(/^([^/]+)\/agent-catalog(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }
  const tenantId = requireTenantId(decodeURIComponent(match[1] ?? ""));
  if (!tenantId) {
    return null;
  }
  const agentId = match[2] ? normalizeAgentId(decodeURIComponent(match[2])) : undefined;
  return { tenantId, agentId };
}

/**
 * Control-plane agent catalog HTTP API (served by a Gateway acting as CP).
 *
 * GET  .../tenants/{tenantId}/agent-catalog
 * GET  .../tenants/{tenantId}/agent-catalog/{agentId}
 * PUT  .../tenants/{tenantId}/agent-catalog/{agentId}
 */
export async function handleAgentCatalogControlPlaneHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: { basePath?: string; localDirect?: boolean },
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = matchCatalogRoute(url.pathname, opts?.basePath ?? "");
  if (!route) {
    return false;
  }

  if (!authorizeControlPlaneRequest({ req, localDirect: opts?.localDirect })) {
    sendJson(res, 401, { ok: false, error: "CONTROL_PLANE_UNAUTHORIZED" });
    return true;
  }

  const port = resolveServingAgentCatalogPort();

  if (req.method === "GET" && !route.agentId) {
    const entities = await port.listEntities(route.tenantId);
    sendJson(res, 200, {
      ok: true,
      controlPlaneId: port.controlPlaneId,
      entities,
    });
    return true;
  }

  if (req.method === "GET" && route.agentId) {
    const entity = await port.getEntity(route.tenantId, route.agentId);
    if (!entity) {
      sendJson(res, 404, { ok: false, error: "CATALOG_ENTITY_NOT_FOUND" });
      return true;
    }
    sendJson(res, 200, { ok: true, controlPlaneId: port.controlPlaneId, entity });
    return true;
  }

  if (req.method === "PUT" && route.agentId) {
    const body = (await readJsonBody(req)) as Partial<AgentCatalogEntity>;
    const entity = await port.upsertEntity({
      tenantId: route.tenantId,
      agentId: route.agentId,
      name: typeof body.name === "string" ? body.name : undefined,
      identity: body.identity,
      ownerId: typeof body.ownerId === "string" ? body.ownerId : undefined,
      ownerName: typeof body.ownerName === "string" ? body.ownerName : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
      shareStatus: typeof body.shareStatus === "string" ? body.shareStatus : undefined,
      runtimeBinding: typeof body.runtimeBinding === "string" ? body.runtimeBinding : undefined,
      disabled: typeof body.disabled === "boolean" ? body.disabled : undefined,
    });
    sendJson(res, 200, { ok: true, controlPlaneId: port.controlPlaneId, entity });
    return true;
  }

  sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  return true;
}
