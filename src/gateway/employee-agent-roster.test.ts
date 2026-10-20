import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { handleAgentCatalogControlPlaneHttpRequest } from "./control-plane/agent-catalog-http.js";
import {
  createHttpAgentCatalogPort,
  createInMemoryAgentCatalogPort,
  createRemoteAgentCatalogPort,
  setAgentCatalogPortForTests,
} from "./control-plane/agent-catalog-port.js";
import { upsertAgentRuntimeBind } from "./control-plane/agent-runtime-bind-registry.js";
import {
  listAgentsForEmployeeGateway,
  projectEmployeeAgentRoster,
  resolveAgentRuntimeStatus,
} from "./employee-agent-roster.js";

describe("employee-agent-roster (control-plane CatalogPort)", () => {
  const dirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    setAgentCatalogPortForTests(null);
    delete process.env.OPENBOT_RUNTIME_ID;
    delete process.env.OPENBOT_RUNTIME_BIND_REGISTRY_PATH;
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fail-closes when actor.tenantId is missing", async () => {
    const port = createInMemoryAgentCatalogPort("cp-shared");
    await port.upsertEntity({
      tenantId: "upbeyond",
      agentId: "panda",
      name: "熊猫学习",
    });
    const rows = await projectEmployeeAgentRoster({
      actor: {
        userId: "user-ceo",
        userEmail: "daniel.hhd@gmail.com",
        seatAgentIds: ["main", "panda"],
        seatSpaceIds: [],
      },
      cfg: { agents: { list: [] } } as OpenBotConfig,
      catalogPort: port,
    });
    expect(rows).toEqual([]);
  });

  it("two gateway hosts sharing one memory control-plane return the same roster IDs/names", async () => {
    const shared = createInMemoryAgentCatalogPort("cp-shared-prod");
    await shared.upsertEntity({ tenantId: "upbeyond", agentId: "main", name: "大白管家" });
    await shared.upsertEntity({
      tenantId: "upbeyond",
      agentId: "panda",
      name: "熊猫学习",
      ownerId: "user-ceo",
    });
    await shared.upsertEntity({
      tenantId: "upbeyond",
      agentId: "bot-2",
      name: "市场助手",
      ownerId: "user-ceo",
    });

    const actor = {
      userId: "user-ceo",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "upbeyond",
      seatAgentIds: ["main", "panda", "bot-2"],
      seatSpaceIds: [],
    };

    const gatewayA = await listAgentsForEmployeeGateway({
      actor,
      cfg: { agents: { list: [] }, session: { mainKey: "main" } } as OpenBotConfig,
      catalogPort: shared,
    });
    const gatewayB = await listAgentsForEmployeeGateway({
      actor,
      cfg: {
        agents: {
          list: [
            { id: "main", name: "大白管家" },
            { id: "unrelated", name: "X" },
          ],
        },
        session: { mainKey: "main" },
      } as OpenBotConfig,
      catalogPort: shared,
    });

    expect(gatewayA.controlPlaneId).toBe(gatewayB.controlPlaneId);
    expect(
      gatewayA.agents.map((r) => r.id).toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      gatewayB.agents.map((r) => r.id).toSorted((a, b) => String(a).localeCompare(String(b))),
    );
    expect(
      gatewayA.agents.map((r) => r.name).toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      gatewayB.agents.map((r) => r.name).toSorted((a, b) => String(a).localeCompare(String(b))),
    );
  });

  it("HTTP CatalogPort: two clients against one CP server see identical roster", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-cp-"));
    dirs.push(dir);
    const storeFile = path.join(dir, "agent-catalog.json");
    const serving = createRemoteAgentCatalogPort({
      storeFile,
      controlPlaneId: "remote:http-server",
    });
    setAgentCatalogPortForTests(serving);

    const server = http.createServer((req, res) => {
      void handleAgentCatalogControlPlaneHttpRequest(req, res, { localDirect: true });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("no listen address");
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const clientA = createHttpAgentCatalogPort({ baseUrl, controlPlaneId: "http:client-a" });
    const clientB = createHttpAgentCatalogPort({ baseUrl, controlPlaneId: "http:client-b" });

    await clientA.upsertEntity({
      tenantId: "upbeyond",
      agentId: "main",
      name: "大白管家",
    });
    await clientA.upsertEntity({
      tenantId: "upbeyond",
      agentId: "panda",
      name: "熊猫学习",
    });

    const idsA = (await clientA.listEntities("upbeyond"))
      .map((e) => e.agentId)
      .toSorted((a, b) => String(a).localeCompare(String(b)));
    const idsB = (await clientB.listEntities("upbeyond"))
      .map((e) => e.agentId)
      .toSorted((a, b) => String(a).localeCompare(String(b)));
    expect(idsA).toEqual(["main", "panda"]);
    expect(idsB).toEqual(idsA);

    const actor = {
      userId: "u",
      userEmail: "a@b.c",
      tenantId: "upbeyond",
      seatAgentIds: ["main", "panda"],
      seatSpaceIds: [],
    };
    const listA = await listAgentsForEmployeeGateway({
      actor,
      cfg: { agents: { list: [] } } as OpenBotConfig,
      catalogPort: clientA,
    });
    const listB = await listAgentsForEmployeeGateway({
      actor,
      cfg: { agents: { list: [{ id: "other" }] } } as OpenBotConfig,
      catalogPort: clientB,
    });
    expect(
      listA.agents
        .map((r) => ({ id: r.id, name: r.name }))
        .toSorted((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      listB.agents
        .map((r) => ({ id: r.id, name: r.name }))
        .toSorted((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("bind registry heartbeat marks unhealthy binds unavailable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bind-reg-"));
    dirs.push(dir);
    process.env.OPENBOT_RUNTIME_BIND_REGISTRY_PATH = path.join(dir, "binds.json");
    process.env.OPENBOT_RUNTIME_ID = "gw-a";

    upsertAgentRuntimeBind({
      tenantId: "upbeyond",
      agentId: "panda",
      runtimeId: "gw-a",
      health: "unhealthy",
      lastHeartbeatAt: new Date().toISOString(),
    });

    const port = createInMemoryAgentCatalogPort("cp");
    await port.upsertEntity({
      tenantId: "upbeyond",
      agentId: "panda",
      name: "熊猫学习",
      runtimeBinding: "gw-a",
    });

    const rows = await projectEmployeeAgentRoster({
      actor: {
        userId: "u",
        userEmail: "a@b.c",
        tenantId: "upbeyond",
        seatAgentIds: ["panda"],
        seatSpaceIds: [],
      },
      cfg: { agents: { list: [{ id: "panda" }] } } as OpenBotConfig,
      catalogPort: port,
    });
    expect(rows[0]?.runtimeStatus).toBe("unavailable");
  });

  it("resolveAgentRuntimeStatus uses runtimeBinding for cross-gateway unavailability", () => {
    expect(
      resolveAgentRuntimeStatus({
        agentId: "panda",
        tenantId: "t",
        entity: {
          agentId: "panda",
          tenantId: "t",
          runtimeBinding: "other-gw",
          updatedAt: new Date().toISOString(),
        },
        explicitRuntimeIds: new Set(["panda"]),
        runtimeId: "this-gw",
      }),
    ).toBe("unavailable");
  });
});
