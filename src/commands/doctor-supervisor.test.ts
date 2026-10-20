import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";

const note = vi.hoisted(() => vi.fn());
const callGateway = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({ note }));
vi.mock("../gateway/call.js", () => ({ callGateway }));

import { noteSupervisorReadiness } from "./doctor-supervisor.js";

type GatewayResponders = {
  status?: unknown;
  nodes?: unknown;
  workers?: unknown;
};

function mockGateway(responders: GatewayResponders) {
  callGateway.mockImplementation(async ({ method }: { method: string }) => {
    switch (method) {
      case "supervisor.status":
        if (responders.status instanceof Error) {
          throw responders.status;
        }
        return responders.status ?? { enabled: false };
      case "supervisor.node.list":
        if (responders.nodes instanceof Error) {
          throw responders.nodes;
        }
        return { nodes: responders.nodes ?? [] };
      case "supervisor.worker.list":
        if (responders.workers instanceof Error) {
          throw responders.workers;
        }
        return { workers: responders.workers ?? [] };
      default:
        throw new Error(`unexpected method ${method}`);
    }
  });
}

const cfg = {} as OpenBotConfig;

function lastNote(): string {
  return String(note.mock.calls.at(-1)?.[0] ?? "");
}

describe("noteSupervisorReadiness", () => {
  beforeEach(() => {
    note.mockClear();
    callGateway.mockReset();
  });

  it("skips entirely when the gateway is unreachable", async () => {
    await noteSupervisorReadiness({ cfg, healthOk: false });
    expect(callGateway).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
  });

  it("stays silent when the supervisor subsystem is disabled", async () => {
    mockGateway({ status: { enabled: false } });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    // Only supervisor.status should be probed; no node/worker calls.
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(note).not.toHaveBeenCalled();
  });

  it("stays silent when supervisor.status cannot be probed", async () => {
    mockGateway({ status: new Error("method not found") });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    expect(note).not.toHaveBeenCalled();
  });

  it("warns when enabled but neither a capable Node nor a worker backend is available", async () => {
    mockGateway({ status: { enabled: true }, nodes: [], workers: [] });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    expect(note).toHaveBeenCalledTimes(1);
    const message = lastNote();
    expect(message).toContain("no execution backend is ready");
    expect(message).toContain("supervisor.worker.dispatch");
    expect(message).toContain("worker` metadata");
  });

  it("guides Node connection when workers exist but no Node is online", async () => {
    mockGateway({
      status: { enabled: true },
      nodes: [],
      workers: [{ backendId: "codex-cli" }],
    });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    const message = lastNote();
    expect(message).toContain("no local Node is online");
    expect(message).toContain("Node mode");
  });

  it("flags online nodes that do not advertise the supervisor worker command", async () => {
    mockGateway({
      status: { enabled: true },
      nodes: [{ nodeId: "mac-1", supportsSupervisorWorker: false }],
      workers: [{ backendId: "codex-cli" }],
    });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    const message = lastNote();
    expect(message).toContain("none advertise supervisor.worker.dispatch");
  });

  it("warns when a capable Node exists but no worker backend is configured", async () => {
    mockGateway({
      status: { enabled: true },
      nodes: [{ nodeId: "mac-1", supportsSupervisorWorker: true }],
      workers: [],
    });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    const message = lastNote();
    expect(message).toContain("no CLI backend exposes `worker` metadata");
  });

  it("surfaces probe errors when a supervisor list call fails", async () => {
    mockGateway({
      status: { enabled: true },
      nodes: new Error("boom"),
      workers: [{ backendId: "codex-cli" }],
    });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    const message = lastNote();
    expect(message).toContain("readiness could not be fully probed");
    expect(message).toContain("supervisor.node.list failed: boom");
  });

  it("stays silent when a capable Node and a worker backend are both available", async () => {
    mockGateway({
      status: { enabled: true },
      nodes: [{ nodeId: "mac-1", supportsSupervisorWorker: true }],
      workers: [{ backendId: "codex-cli" }],
    });
    await noteSupervisorReadiness({ cfg, healthOk: true });
    expect(note).not.toHaveBeenCalled();
  });
});
