import { describe, expect, it } from "vitest";
import {
  buildApiKeyCliRows,
  buildLocalIdeCliRows,
  buildNodeEnvironmentRows,
  groupSetupReadinessBands,
  resolveSupervisorHeaderReadiness,
  summarizeSetupReadiness,
} from "./supervisor-setup-readiness.ts";
import type { SupervisorWorkerHealthRow } from "./supervisor-types.ts";

describe("supervisor-setup-readiness", () => {
  it("summarizeSetupReadiness counts ready rows", () => {
    const rows = [
      {
        id: "a",
        category: "控制面" as const,
        check: "x",
        ready: true,
        status: "就绪",
        detail: "",
      },
      {
        id: "b",
        category: "本机 IDE" as const,
        check: "y",
        ready: false,
        status: "待处理",
        detail: "",
      },
    ];
    expect(summarizeSetupReadiness(rows)).toEqual({ ready: 1, total: 2, allReady: false });
  });

  it("buildNodeEnvironmentRows includes node checks when seatId present", () => {
    const rows = buildNodeEnvironmentRows({
      supervisorAvailable: true,
      seatId: "seat-1",
      binding: { tenantId: "t1", seatId: "seat-1", nodeId: "mac-1", updatedAt: "" },
      nodes: [
        {
          nodeId: "mac-1",
          online: true,
          supportsSupervisorWorker: true,
          supervisorWorkerCommands: [],
          connectedAtMs: 0,
        },
      ],
      ideHealth: [],
    });
    expect(rows.map((row) => row.id)).toEqual(["supervisor-enabled", "node-bound", "node-online"]);
    expect(rows.find((row) => row.id === "node-bound")?.ready).toBe(true);
  });

  it("buildApiKeyCliRows marks authenticated worker as ready", () => {
    const worker: SupervisorWorkerHealthRow = {
      backendId: "codex-cli",
      recommendedPolicy: "api_key",
      recommendedPlacement: "gateway",
      identity: { policy: "api_key", status: "validated" },
      placement: { available: true, executor: "gateway" },
      auth: {
        installed: true,
        authenticated: true,
        status: "validated",
        source: "probe",
      },
    };
    const rows = buildApiKeyCliRows([worker], new Set());
    const codex = rows.find((row) => row.id === "api-key-codex-cli");
    expect(codex?.ready).toBe(true);
    expect(codex?.status).toBe("就绪");
  });

  it("buildLocalIdeCliRows marks authenticated grok-cli as ready", () => {
    const worker: SupervisorWorkerHealthRow = {
      backendId: "grok-cli",
      recommendedPolicy: "local_ide_login",
      recommendedPlacement: "node_agent",
      identity: { policy: "local_ide_login", status: "configured" },
      placement: { available: false, executor: null, reason: "Node offline" },
      auth: {
        installed: true,
        authenticated: true,
        status: "validated",
        source: "probe",
        reason: "Gateway 宿主机探测：CLI 已登录",
      },
    };
    const rows = buildLocalIdeCliRows([worker]);
    const grok = rows.find((row) => row.id === "local-ide-grok-cli");
    expect(grok?.ready).toBe(true);
    expect(grok?.status).toBe("就绪");
  });

  it("buildApiKeyCliRows excludes local-IDE OAuth workers such as grok-cli", () => {
    const rows = buildApiKeyCliRows([], new Set());
    expect(rows.some((row) => row.id === "api-key-grok-cli")).toBe(false);
    expect(rows.some((row) => row.id === "api-key-codex-cli")).toBe(true);
  });

  it("groupSetupReadinessBands clusters control/node/ide/enterprise", () => {
    const rows = [
      ...buildNodeEnvironmentRows({
        supervisorAvailable: true,
        seatId: "seat-1",
        binding: null,
        nodes: [],
        ideHealth: [],
      }),
      ...buildLocalIdeCliRows([]),
      ...buildApiKeyCliRows([], new Set()),
    ];
    const bands = groupSetupReadinessBands(rows);
    expect(bands.map((band) => band.id)).toEqual([
      "control-plane",
      "node",
      "local-ide",
      "enterprise-shared",
    ]);
  });

  it("resolveSupervisorHeaderReadiness returns draft-only when Node offline", () => {
    const rows = buildNodeEnvironmentRows({
      supervisorAvailable: true,
      seatId: "seat-1",
      binding: { tenantId: "t1", seatId: "seat-1", nodeId: "mac-1", updatedAt: "" },
      nodes: [],
      ideHealth: [],
    });
    const header = resolveSupervisorHeaderReadiness(rows);
    expect(header.mode).toBe("draft-only");
    expect(header.primaryGapId).toBe("node-online");
    expect(header.cta.kind).toBe("fix-gap");
  });

  it("resolveSupervisorHeaderReadiness returns disabled when supervisor off", () => {
    const rows = buildNodeEnvironmentRows({
      supervisorAvailable: false,
      seatId: "",
      binding: null,
      nodes: [],
      ideHealth: [],
    });
    expect(resolveSupervisorHeaderReadiness(rows).mode).toBe("disabled");
  });
});

it("resolveSupervisorHeaderReadiness is ready only for selected gateway worker chain", () => {
  const rows = [
    ...buildNodeEnvironmentRows({
      supervisorAvailable: true,
      seatId: "seat-1",
      binding: null,
      nodes: [],
      ideHealth: [],
    }),
    ...buildLocalIdeCliRows([
      {
        backendId: "devin-cli",
        recommendedPolicy: "local_ide_login",
        recommendedPlacement: "node_agent",
        identity: { policy: "local_ide_login", status: "configured" },
        placement: { available: false, executor: null },
        auth: {
          installed: true,
          authenticated: true,
          status: "validated",
          source: "probe",
        },
      },
    ]),
    ...buildApiKeyCliRows(
      [
        {
          backendId: "codex-cli",
          recommendedPolicy: "enterprise_shared",
          recommendedPlacement: "gateway",
          identity: { policy: "enterprise_shared", status: "validated" },
          placement: { available: true, executor: "gateway" },
          auth: {
            installed: true,
            authenticated: true,
            status: "validated",
            source: "probe",
          },
        },
      ],
      new Set(),
    ),
  ];
  // Devin green + Codex green must NOT make Cursor (selected) look runnable.
  const cursorHeader = resolveSupervisorHeaderReadiness(rows, { selectedWorkerId: "cursor-cli" });
  expect(cursorHeader.mode).toBe("draft-only");
  expect(cursorHeader.primaryGapId).toMatch(/node-|local-ide-cursor-cli/);

  const codexHeader = resolveSupervisorHeaderReadiness(rows, { selectedWorkerId: "codex-cli" });
  expect(codexHeader.mode).toBe("ready");
  expect(codexHeader.label).toBe("可监督");
});

it("resolveSupervisorHeaderReadiness requires Node for selected local_ide worker", () => {
  const rows = [
    ...buildNodeEnvironmentRows({
      supervisorAvailable: true,
      seatId: "seat-1",
      binding: { tenantId: "t1", seatId: "seat-1", nodeId: "mac-1", updatedAt: "" },
      nodes: [
        {
          nodeId: "mac-1",
          online: true,
          supportsSupervisorWorker: true,
          supervisorWorkerCommands: [],
          connectedAtMs: 0,
        },
      ],
      ideHealth: [],
    }),
    ...buildLocalIdeCliRows([
      {
        backendId: "cursor-cli",
        recommendedPolicy: "local_ide_login",
        recommendedPlacement: "node_agent",
        identity: { policy: "local_ide_login", status: "configured" },
        placement: { available: true, executor: "node_agent" },
        auth: {
          installed: true,
          authenticated: true,
          status: "validated",
          source: "probe",
        },
      },
    ]),
    ...buildApiKeyCliRows([], new Set()),
  ];
  const header = resolveSupervisorHeaderReadiness(rows, { selectedWorkerId: "cursor-cli" });
  expect(header.mode).toBe("ready");
});
