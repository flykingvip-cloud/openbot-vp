import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  return {
    keepContainers: argv.includes("--keep-containers"),
    output: (() => {
      const idx = argv.indexOf("--output");
      return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : null;
    })(),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    input: options.input,
  });
  if (result.status !== 0) {
    const message =
      `Command failed: ${command} ${args.join(" ")}\n` +
      `status=${result.status}\n` +
      `stdout=${result.stdout ?? ""}\n` +
      `stderr=${result.stderr ?? ""}`;
    throw new Error(message);
  }
  return (result.stdout ?? "").trim();
}

async function waitUntil(checker, options) {
  const retries = options.retries ?? 40;
  const intervalMs = options.intervalMs ?? 2000;
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      await checker();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }
  throw lastError ?? new Error("waitUntil timed out");
}

function parseSingleCount(output) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  const match = lastLine.match(/(-?\d+)$/);
  if (!match) {
    throw new Error(`Cannot parse count from output: ${output}`);
  }
  return Number(match[1]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const composeFile = fileURLToPath(new URL("./docker-compose.integration.yml", import.meta.url));
  const project = `cogniweave_it_${Date.now()}`;
  const report = {
    startedAt: new Date().toISOString(),
    project,
    checks: [],
    status: "UNKNOWN",
  };

  const compose = (...composeArgs) =>
    run("docker", ["compose", "-p", project, "-f", composeFile, ...composeArgs]);

  let postgresContainer = "";
  let neo4jContainer = "";

  try {
    compose("up", "-d");
    postgresContainer = compose("ps", "-q", "postgres");
    neo4jContainer = compose("ps", "-q", "neo4j");

    await waitUntil(
      () => {
        run("docker", [
          "exec",
          postgresContainer,
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "cogniweave",
        ]);
        return Promise.resolve();
      },
      { retries: 40, intervalMs: 2000 },
    );

    await waitUntil(
      () => {
        run("docker", [
          "exec",
          neo4jContainer,
          "cypher-shell",
          "-u",
          "neo4j",
          "-p",
          "neo4jpass",
          "RETURN 1;",
        ]);
        return Promise.resolve();
      },
      { retries: 40, intervalMs: 3000 },
    );

    const psql = (sql) =>
      run("docker", [
        "exec",
        "-i",
        postgresContainer,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "cogniweave",
        "-At",
        "-c",
        sql,
      ]);

    psql(`
      create schema if not exists cogniweave_it;
      create extension if not exists vector;
      create table if not exists cogniweave_it.cogniweave_entities (
        id text primary key,
        entity_key text,
        workspace_id text not null,
        project_id text not null,
        agent_id text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists cogniweave_it.cogniweave_seed_documents (
        id text primary key,
        workspace_id text not null,
        project_id text not null,
        agent_id text not null,
        source_type text not null,
        content text not null,
        embedding vector(3),
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);

    const entityId = `ent_abort_${Date.now()}`;
    psql(`
      begin;
      insert into cogniweave_it.cogniweave_entities
        (id, entity_key, workspace_id, project_id, agent_id, payload)
      values
        ('${entityId}', 'entity_abort', 'ws_1', 'proj_1', 'agent_main', '{"id":"${entityId}"}'::jsonb);
      rollback;
    `);
    const entityCount = parseSingleCount(
      psql(`select count(*) from cogniweave_it.cogniweave_entities where id = '${entityId}';`),
    );
    report.checks.push({
      name: "postgres_metadata_rollback",
      passed: entityCount === 0,
      details: { entityId, count: entityCount },
    });

    const seedId = `seed_abort_${Date.now()}`;
    psql(`
      begin;
      insert into cogniweave_it.cogniweave_seed_documents
        (id, workspace_id, project_id, agent_id, source_type, content, embedding, payload)
      values
        ('${seedId}', 'ws_1', 'proj_1', 'agent_main', 'atom', 'test content', null, '{}'::jsonb);
      rollback;
    `);
    const seedCount = parseSingleCount(
      psql(`select count(*) from cogniweave_it.cogniweave_seed_documents where id = '${seedId}';`),
    );
    report.checks.push({
      name: "pgvector_seed_rollback",
      passed: seedCount === 0,
      details: { seedId, count: seedCount },
    });

    const neoId = `neo_abort_${Date.now()}`;
    run("docker", [
      "exec",
      neo4jContainer,
      "cypher-shell",
      "-u",
      "neo4j",
      "-p",
      "neo4jpass",
      "--format",
      "plain",
      "CREATE CONSTRAINT cogniweave_rollback_unique IF NOT EXISTS FOR (n:CogniRollbackTest) REQUIRE n.id IS UNIQUE;",
    ]);
    let neoWriteFailedAsExpected = false;
    try {
      run("docker", [
        "exec",
        neo4jContainer,
        "cypher-shell",
        "-u",
        "neo4j",
        "-p",
        "neo4jpass",
        "--format",
        "plain",
        `CREATE (:CogniRollbackTest {id: "${neoId}"}) CREATE (:CogniRollbackTest {id: "${neoId}"}) RETURN 1;`,
      ]);
    } catch (_error) {
      neoWriteFailedAsExpected = true;
    }
    const neoCountOutput = run("docker", [
      "exec",
      neo4jContainer,
      "cypher-shell",
      "-u",
      "neo4j",
      "-p",
      "neo4jpass",
      "--format",
      "plain",
      `MATCH (n:CogniRollbackTest {id: "${neoId}"}) RETURN count(n) AS c;`,
    ]);
    const neoCount = parseSingleCount(neoCountOutput);
    report.checks.push({
      name: "neo4j_graph_rollback",
      passed: neoWriteFailedAsExpected && neoCount === 0,
      details: { neoId, count: neoCount, failedAsExpected: neoWriteFailedAsExpected },
    });

    const failedChecks = report.checks.filter((check) => !check.passed);
    report.status = failedChecks.length === 0 ? "PASS" : "FAIL";
  } catch (error) {
    report.status = "ERROR";
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    const output = JSON.stringify(report, null, 2);
    if (args.output) {
      const outputPath = resolve(process.cwd(), args.output);
      // `.runtime/` is gitignored scratch, so on a clean checkout it does not exist yet and
      // writeFileSync fails with ENOENT. This runs in a `finally`, so the crash replaced the
      // real rollback verdict with a filesystem error.
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${output}\n`, "utf8");
    }
    process.stdout.write(`${output}\n`);
    if (!args.keepContainers) {
      try {
        compose("down", "-v");
      } catch (_error) {
        // Ignore cleanup errors to avoid masking primary failure.
      }
    }
  }

  if (report.status !== "PASS") {
    process.exitCode = 1;
  }
}

await main();
