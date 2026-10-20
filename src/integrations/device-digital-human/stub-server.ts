/**
 * Loopback stub for Agent A integration.
 * This process is not imported by the production gateway.
 *
 *   OPENBOT_DEVICE_DH_STUB=1 \
 *   OPENBOT_DEVICE_DH_STUB_CONFIG=./stub-clients.json \
 *   OPENBOT_DEVICE_DH_STUB_PORT=8787 \
 *   node --import tsx src/integrations/device-digital-human/stub-server.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGatewayAgentModelClient, resolveGatewayAgentConfig } from "./agent-client.js";
import { loadStubConfig } from "./config.js";
import { listenDeviceDh } from "./http.js";
import {
  createPlaceholderModelClient,
  DeviceDhModelError,
  resolveDeviceDhModelMode,
  type DeviceDhModelClient,
} from "./model.js";
import { DeviceDhService } from "./service.js";

if (process.env.OPENBOT_DEVICE_DH_STUB !== "1") {
  process.stderr.write("Refusing to start. Set OPENBOT_DEVICE_DH_STUB=1\n");
  process.exit(1);
}

const configPath = process.env.OPENBOT_DEVICE_DH_STUB_CONFIG;
if (!configPath) {
  process.stderr.write("OPENBOT_DEVICE_DH_STUB_CONFIG is required\n");
  process.exit(1);
}

const port = Number(process.env.OPENBOT_DEVICE_DH_STUB_PORT ?? "8787");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write("OPENBOT_DEVICE_DH_STUB_PORT must be an integer from 0 to 65535\n");
  process.exit(1);
}

const host = process.env.OPENBOT_DEVICE_DH_STUB_HOST ?? "127.0.0.1";
const allowOrigins = (process.env.OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter((item) => item.length > 0);

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "examples", "fixtures");

function loadModels(): DeviceDhModelClient {
  const mode = resolveDeviceDhModelMode();
  if (mode === "agent") {
    return createGatewayAgentModelClient({
      ...resolveGatewayAgentConfig(),
      // Best-effort Gateway WebSocket chat.abort. HTTP abort is the guarantee.
      attemptGatewayAbort: true,
    });
  }
  return createPlaceholderModelClient();
}

let models: DeviceDhModelClient;
try {
  models = loadModels();
} catch (error) {
  const message =
    error instanceof DeviceDhModelError
      ? error.message
      : "Invalid device digital-human model config";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.stderr.write(`device-dh model mode=${models.mode} target=${models.target}\n`);

const service = new DeviceDhService({
  config: loadStubConfig(configPath),
  approvalToken: process.env.OPENBOT_DEVICE_DH_APPROVAL_TOKEN ?? "dev-approval-token",
  mediaAllowOrigins: allowOrigins,
  models,
  onAudit: (record) => {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  },
});

const listening = await listenDeviceDh({ service, fixtureDir, port, host });
process.stdout.write(`listening on ${listening.url}\n`);
