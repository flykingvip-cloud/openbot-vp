import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CROSS_OPERATOR_STATE_DENIED,
  getOperatorStateScope,
  resolveActiveOperatorId,
  resolveOperatorStateRoot,
} from "../config/operator-state-scope.js";
import { resolveDefaultSessionStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";

const noWebchat = () => false;

describe("handleGatewayRequest operator state scope", () => {
  const prevStateDir = process.env.OPENBOT_STATE_DIR;
  const prevOperator = process.env.OPENBOT_OPERATOR_ID;
  let stateDir = "";

  afterEach(() => {
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
    if (prevOperator === undefined) {
      delete process.env.OPENBOT_OPERATOR_ID;
    } else {
      process.env.OPENBOT_OPERATOR_ID = prevOperator;
    }
    delete process.env.OPENCLAW_OPERATOR_ID;
    if (stateDir) {
      fs.rmSync(stateDir, { recursive: true, force: true });
      stateDir = "";
    }
  });

  it("scopes store reads from authenticated platformUserId without OPENBOT_OPERATOR_ID", async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-gw-op-scope-"));
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENBOT_OPERATOR_ID;
    delete process.env.OPENCLAW_OPERATOR_ID;

    const foreign = path.join(
      stateDir,
      "operators",
      "operator-b",
      "agents",
      "main",
      "sessions",
      "sessions.json",
    );
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, JSON.stringify({ marker: "operator-b-session-marker" }), "utf8");

    let seenOperatorId: string | undefined;
    let seenRoot = "";
    let foreignDenied = false;
    let ownMarker = "";

    const handler: GatewayRequestHandler = (opts) => {
      seenOperatorId = resolveActiveOperatorId();
      seenRoot = resolveOperatorStateRoot();
      try {
        loadSessionStore(foreign, { skipCache: true });
      } catch (err) {
        foreignDenied = String(err).includes(CROSS_OPERATOR_STATE_DENIED);
      }
      const own = resolveDefaultSessionStorePath("main");
      fs.mkdirSync(path.dirname(own), { recursive: true });
      fs.writeFileSync(own, JSON.stringify({ marker: "operator-a-own" }), "utf8");
      ownMarker = JSON.stringify(loadSessionStore(own, { skipCache: true }));
      expect(getOperatorStateScope()?.source).toBe("request");
      opts.respond(true, { ok: true }, undefined);
    };

    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: "1", method: "health" },
      respond,
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.read"],
          client: { id: "cli", version: "1.0.0", platform: "test", mode: "cli" },
          minProtocol: 1,
          maxProtocol: 1,
        },
        connId: "conn-a",
        platformUserId: "operator-a",
      } as Parameters<typeof handleGatewayRequest>[0]["client"],
      isWebchatConnect: noWebchat,
      context: {
        logGateway: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"],
      extraHandlers: { health: handler },
    });

    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(seenOperatorId).toBe("operator-a");
    expect(seenRoot).toContain(`${path.sep}operators${path.sep}operator-a`);
    expect(foreignDenied).toBe(true);
    expect(ownMarker).toContain("operator-a-own");
    expect(ownMarker).not.toContain("operator-b-session-marker");
    // Outside the request, scope is cleared.
    expect(resolveActiveOperatorId()).toBeUndefined();
  });
});
