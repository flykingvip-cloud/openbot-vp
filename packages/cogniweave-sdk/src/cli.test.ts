import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapterBundle } from "./adapters/factory.js";
import {
  bootstrapAdapterBundle,
  buildCogniWeaveCliConfigSnapshot,
  buildCogniWeaveEngineConfig,
  buildCogniWeaveServePlan,
  formatBootstrapSummary,
  parseCogniWeaveCliArgs,
  runCogniWeaveCli,
} from "./cli.js";

describe("cogniweave cli", () => {
  it("parses serve defaults", () => {
    const options = parseCogniWeaveCliArgs([]);

    expect(options.command).toBe("serve");
    expect(options.host).toBe("127.0.0.1");
    expect(options.port).toBe(8787);
    expect(options.basePath).toBe("/");
    expect(options.bootstrapSchemas).toBe(false);
    expect(options.outputJson).toBe(false);
    expect(options.dryRun).toBe(false);
  });

  it("prints version without starting the server", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(["--version"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    expect(logs[0]).toBe("0.1.0");
  });

  it("prints version in json mode", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(["--version", "--json"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(logs[0]) as {
      ok: boolean;
      action: string;
      code: string;
      timestamp: string;
      data: { version: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe("version");
    expect(payload.code).toBe("VERSION_OK");
    expect(payload.data.version).toBe("0.1.0");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("prints a config snapshot without listening", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(
      ["serve", "--print-config", "--graph-backend", "neo4j"],
      {
        log: (value: string) => {
          logs.push(value);
        },
        error: (value: string) => {
          throw new Error(value);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(logs[0])).not.toThrow();
    const snapshot = JSON.parse(logs[0]) as { runtime: { graphBackend: string }; dryRun: boolean };
    expect(snapshot.runtime.graphBackend).toBe("neo4j");
    expect(snapshot.dryRun).toBe(false);
  });

  it("supports serve dry-run without binding a socket", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(["serve", "--dry-run", "--port", "8990"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    expect(logs.at(-1)).toContain("Dry run ok:");
    expect(logs.at(-1)).toContain(":8990");
  });

  it("supports serve dry-run in json mode", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(["serve", "--dry-run", "--json"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      ok: boolean;
      action: string;
      code: string;
      data: { status: string; url: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe("dry-run");
    expect(payload.code).toBe("DRY_RUN_OK");
    expect(payload.data.status).toBe("DRY_RUN_OK");
    expect(payload.data.url).toContain("http://127.0.0.1:8787");
  });

  it("emits bootstrap-schema in json mode with structured targets", async () => {
    const logs: string[] = [];

    const exitCode = await runCogniWeaveCli(["bootstrap-schema", "--json"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(logs[0]) as {
      ok: boolean;
      action: string;
      code: string;
      data: Array<{ kind: string; status: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe("bootstrap-schema");
    expect(payload.code).toBe("BOOTSTRAP_SCHEMA_PARTIAL");
    expect(payload.data).toHaveLength(3);
    expect(
      payload.data.every((item) => item.status === "SKIPPED" || item.status === "BOOTSTRAPPED"),
    ).toBe(true);
  });

  it("writes output to file when --output is set", async () => {
    const logs: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "cogniweave-cli-"));
    const outputFile = join(dir, "version.json");

    const exitCode = await runCogniWeaveCli(["--version", "--json", "--output", outputFile], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    });

    expect(exitCode).toBe(0);
    const fileContent = await readFile(outputFile, "utf8");
    expect(fileContent.trim()).toBe(logs[0]);
    const payload = JSON.parse(fileContent) as { action: string; code: string };
    expect(payload.action).toBe("version");
    expect(payload.code).toBe("VERSION_OK");
  });

  it("emits json error envelope for invalid arguments", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCogniWeaveCli(["--port", "abc", "--json"], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        errors.push(value);
      },
    });

    expect(exitCode).toBe(1);
    expect(logs).toHaveLength(0);
    const payload = JSON.parse(errors[0]) as {
      ok: boolean;
      action: string;
      code: string;
      timestamp: string;
      error: { message: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.action).toBe("error");
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.message).toContain("Invalid port");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("writes error output to file when --output is set", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "cogniweave-cli-"));
    const outputFile = join(dir, "error.json");

    const exitCode = await runCogniWeaveCli(["--port", "abc", "--json", "--output", outputFile], {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        errors.push(value);
      },
    });

    expect(exitCode).toBe(1);
    expect(logs).toHaveLength(0);
    const fileContent = await readFile(outputFile, "utf8");
    expect(fileContent.trim()).toBe(errors[0]);
    const payload = JSON.parse(fileContent) as { ok: boolean; code: string };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("parses explicit serve options", () => {
    const options = parseCogniWeaveCliArgs([
      "serve",
      "--host",
      "0.0.0.0",
      "--port",
      "8989",
      "--base-path",
      "/cogniweave",
      "--metadata-backend",
      "postgres",
      "--metadata-store-path",
      "/tmp/cogniweave.sqlite",
      "--graph-backend",
      "neo4j",
      "--vector-backend",
      "pgvector",
      "--bootstrap-schemas",
      "--default-workspace-id",
      "ws_1",
      "--default-project-id",
      "proj_1",
      "--default-agent-id",
      "agent_1",
    ]);

    const config = buildCogniWeaveEngineConfig(options);

    expect(options.command).toBe("serve");
    expect(options.host).toBe("0.0.0.0");
    expect(options.port).toBe(8989);
    expect(options.basePath).toBe("/cogniweave");
    expect(options.bootstrapSchemas).toBe(true);
    expect(config.metadataBackend).toBe("postgres");
    expect(config.metadataStorePath).toBe("/tmp/cogniweave.sqlite");
    expect(config.graphBackend).toBe("neo4j");
    expect(config.vectorBackend).toBe("pgvector");
    expect(config.defaultScope).toEqual({
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentId: "agent_1",
      visibility: "private",
    });
  });

  it("parses bootstrap-schema command", () => {
    const options = parseCogniWeaveCliArgs(["bootstrap-schema", "--graph-backend", "neo4j"]);

    expect(options.command).toBe("bootstrap-schema");
    expect(options.graphBackend).toBe("neo4j");
  });

  it("bootstraps only adapters that expose bootstrapSchema", async () => {
    const bundle = createAdapterBundle({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });

    const results = await bootstrapAdapterBundle(bundle);
    expect(results).toHaveLength(3);
    expect(formatBootstrapSummary(results)).toContain("skipped");
  });

  it("builds a config snapshot with runtime and adapter resolutions", async () => {
    const options = parseCogniWeaveCliArgs([
      "serve",
      "--metadata-backend",
      "postgres",
      "--dry-run",
    ]);
    const snapshot = await buildCogniWeaveCliConfigSnapshot(options);

    expect(snapshot.version).toBe("0.1.0");
    expect(snapshot.runtime.metadataBackend).toBe("postgres");
    expect(snapshot.adapterResolutions).toHaveLength(3);
    expect(snapshot.dryRun).toBe(true);
  });

  it("builds a serve plan without starting the server", async () => {
    const options = parseCogniWeaveCliArgs(["serve", "--base-path", "/cogniweave"]);
    const plan = await buildCogniWeaveServePlan(options);

    expect(plan.config.metadataBackend).toBe("memory");
    expect(plan.snapshot.basePath).toBe("/cogniweave");
    expect(plan.bundle.metadataStore).toBeDefined();
  });

  it("resolves local metadata backend with a persistent store path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogniweave-local-cli-"));
    const storePath = join(dir, "canonical.sqlite");
    const options = parseCogniWeaveCliArgs([
      "serve",
      "--metadata-backend",
      "local",
      "--metadata-store-path",
      storePath,
    ]);
    const plan = await buildCogniWeaveServePlan(options);

    expect(plan.config.metadataBackend).toBe("local");
    expect(plan.config.metadataStorePath).toBe(storePath);
    expect(plan.bundle.resolutions[0]?.implementation).toBe("local-sqlite");
    expect(plan.bundle.resolutions[0]?.descriptor.capabilities).toContain("restart-safe");
  });

  it("parses doctor/recover/compact/journal-stats commands", () => {
    expect(parseCogniWeaveCliArgs(["doctor"]).command).toBe("doctor");
    expect(parseCogniWeaveCliArgs(["recover"]).command).toBe("recover");
    expect(parseCogniWeaveCliArgs(["journal-stats"]).command).toBe("journal-stats");
    const compact = parseCogniWeaveCliArgs(["compact", "--dry-run", "--keep-completed", "3"]);
    expect(compact.command).toBe("compact");
    expect(compact.dryRun).toBe(true);
    expect(compact.keepCompleted).toBe(3);
  });

  it("runs doctor and journal-stats against local store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogniweave-cli-doctor-"));
    const storePath = join(dir, "canonical.sqlite");
    const logs: string[] = [];
    const io = {
      log: (value: string) => {
        logs.push(value);
      },
      error: (value: string) => {
        throw new Error(value);
      },
    };

    const doctorCode = await runCogniWeaveCli(
      ["doctor", "--json", "--metadata-backend", "local", "--metadata-store-path", storePath],
      io,
    );
    expect(doctorCode).toBe(0);
    const doctor = JSON.parse(logs.at(-1) ?? "{}") as {
      ok: boolean;
      action: string;
      code: string;
      data: { journalStats: { total: number } };
    };
    expect(doctor.ok).toBe(true);
    expect(doctor.action).toBe("doctor");
    expect(doctor.code).toBe("DOCTOR_OK");
    expect(doctor.data.journalStats.total).toBe(0);

    logs.length = 0;
    const statsCode = await runCogniWeaveCli(
      [
        "journal-stats",
        "--json",
        "--metadata-backend",
        "local",
        "--metadata-store-path",
        storePath,
      ],
      io,
    );
    expect(statsCode).toBe(0);
    const stats = JSON.parse(logs.at(-1) ?? "{}") as {
      action: string;
      data: { total: number; writeOperationCount: number };
    };
    expect(stats.action).toBe("journal-stats");
    expect(stats.data.total).toBe(0);
    expect(stats.data.writeOperationCount).toBe(0);
  });

  it("runs compact --dry-run without deleting", async () => {
    const logs: string[] = [];
    const exitCode = await runCogniWeaveCli(
      ["compact", "--dry-run", "--json", "--keep-completed", "1"],
      {
        log: (value: string) => {
          logs.push(value);
        },
        error: (value: string) => {
          throw new Error(value);
        },
      },
    );
    expect(exitCode).toBe(0);
    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      action: string;
      code: string;
      data: { status: string };
    };
    expect(payload.action).toBe("compact");
    expect(payload.code).toBe("COMPACT_OK");
    expect(payload.data.status).toBe("DRY_RUN");
  });
});
