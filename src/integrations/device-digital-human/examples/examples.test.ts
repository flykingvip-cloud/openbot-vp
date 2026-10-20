import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadStubConfig } from "../config.js";
import { listenDeviceDh } from "../http.js";
import { DeviceDhService } from "../service.js";
import { runRehearse } from "./rehearse-flow.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

describe("device digital-human rehearse loop", () => {
  it("completes the stub loop against the sample client file", async () => {
    const config = loadStubConfig(path.join(here, "stub-clients.sample.json"));
    const service = new DeviceDhService({ config, approvalToken: "dev-approval-token" });
    const server = await listenDeviceDh({
      service,
      fixtureDir: path.join(here, "fixtures"),
      port: 0,
    });
    try {
      await runRehearse(server.url);
    } finally {
      await server.close();
    }
  });

  it("runs examples/rehearse.sh", async () => {
    const script = path.join(here, "rehearse.sh");
    const { stdout } = await execFileAsync("bash", [script], {
      env: {
        ...process.env,
        OPENBOT_DEVICE_DH_STUB: "1",
        OPENBOT_DEVICE_DH_STUB_PORT: "0",
      },
      timeout: 30_000,
    });
    expect(stdout).toContain("rehearse ok");
  }, 30_000);
});
