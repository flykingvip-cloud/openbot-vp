/**
 * Stage 5 evidence: HA Dual Controller has an opt-in entry in the production
 * compose pack (`profiles: ["ha"]`). Ledger grade for 部署是否接线 is
 * CONDITIONAL — not PASS: default `compose up` starts zero HA processes,
 * image default is `:local`, Auto FO remains NOT APPROVED.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSE_FILE = path.join(ROOT, "deploy/production/docker-compose.prod.yml");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function dockerComposeAvailable(): boolean {
  const r = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  return r.status === 0;
}

describe("Stage 5 HA production wiring (deploy topology)", () => {
  test("E2: docker-compose.prod.yml defines opt-in openbot-ha-controller", () => {
    const compose = read("deploy/production/docker-compose.prod.yml");
    expect(compose).toMatch(/openbot-gateway:/);
    expect(compose).toMatch(/openbot-ha-controller:/);
    expect(compose).toMatch(/profiles:\s*\[\s*["']ha["']\s*\]/);
    expect(compose).toMatch(/heartbeat-loop/);
    expect(compose).toMatch(/HA_CONTROLLER_MODE:\s*\$\{HA_CONTROLLER_MODE:-manual\}/);
    expect(compose).toMatch(/context:\s*\.\.\/ha\/controller/);
    expect(compose).toMatch(/dockerfile:\s*Dockerfile/);
    // Default usage comment still documents gateway-only up without profile ha
    expect(compose).toMatch(/Usage \(gateway only — default\)/);
    expect(compose).toMatch(/--profile ha/);
  });

  test("E2: controller Dockerfile + heartbeat-loop CLI exist", () => {
    const dockerfile = read("deploy/ha/controller/Dockerfile");
    expect(dockerfile).toMatch(/FROM python:3\.12-slim/);
    expect(dockerfile).toMatch(/HA_CONTROLLER_MODE=manual/);
    expect(dockerfile).toMatch(/heartbeat-loop/);

    const main = read("deploy/ha/controller/__main__.py");
    expect(main).toMatch(/heartbeat-loop/);
    expect(main).toMatch(/Production Auto Failover is NOT APPROVED/);
    expect(main).toMatch(/while True:/);
  });

  test("E2: env example + install docs + production README document profile ha", () => {
    const envEx = read("deploy/production/env.production.example");
    expect(envEx).toMatch(/compose profile `ha`/);
    expect(envEx).toMatch(/HA_CONTROLLER_MODE=manual/);
    expect(envEx).toMatch(/NOT APPROVED/);

    const dockerMd = read("docs/install/docker.md");
    expect(dockerMd).toMatch(/Production HA Dual Controller/);
    expect(dockerMd).toMatch(/--profile ha/);
    expect(dockerMd).toMatch(/openbot-ha-controller/);

    const prodReadme = read("deploy/production/README.md");
    expect(prodReadme).toMatch(/openbot-ha-controller/);
    expect(prodReadme).toMatch(/NOT APPROVED/);

    const ctlReadme = read("deploy/ha/controller/README.md");
    expect(ctlReadme).toMatch(/Production wiring \(compose profile `ha`\)/);
    expect(ctlReadme).toMatch(/openbot-ha-controller/);
  });

  test("E2: docker compose --profile ha config resolves HA service (skip if no docker)", () => {
    if (!dockerComposeAvailable()) {
      // Box/CI without Docker: file-level checks above still apply; ledger stays CONDITIONAL.
      console.warn(
        "[stage5] docker compose unavailable — skipped --profile ha config smoke; ledger remains CONDITIONAL",
      );
      return;
    }

    const env = {
      ...process.env,
      OPENBOT_GATEWAY_TOKEN: "stage5-evidence-token",
      OPENBOT_CONFIG_DIR: "/tmp/openbot-stage5-config",
      OPENBOT_WORKSPACE_DIR: "/tmp/openbot-stage5-workspace",
      DATABASE_URL: "postgresql://openbot_controller:unused@127.0.0.1:5432/openbot",
      HA_CONTROLLER_ID: "controller-stage5-evidence",
      HA_FAILURE_DOMAIN: "lab",
      HA_CONTROLLER_MODE: "manual",
    };

    const withHa = spawnSync(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "--profile", "ha", "config"],
      { cwd: ROOT, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    expect(withHa.status, withHa.stderr).toBe(0);
    const rendered = withHa.stdout ?? "";
    expect(rendered).toMatch(/openbot-ha-controller/);
    expect(rendered).toMatch(/heartbeat-loop/);
    expect(rendered).toMatch(/HA_CONTROLLER_MODE/);

    // Default path (no --profile ha) must not materialize the HA service.
    const defaultCfg = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "config"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(defaultCfg.status, defaultCfg.stderr).toBe(0);
    expect(defaultCfg.stdout ?? "").not.toMatch(/openbot-ha-controller/);
  });

  test("E3: CLI still refuses mode=auto (Production Auto Failover OFF)", () => {
    const r = spawnSync(
      "python3",
      [
        "-m",
        "controller",
        "run-once",
        "--mode",
        "auto",
        "--controller-id",
        "probe",
        "--failure-domain",
        "lab",
        "--database-url",
        "postgresql://unused/unused",
        "--to-holder",
        "node-b",
        "--to-db-role",
        "openbot_app_b",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PYTHONPATH: path.join(ROOT, "deploy/ha") },
        encoding: "utf8",
      },
    );
    expect(r.status).not.toBe(0);
    const err = `${r.stderr ?? ""}${r.stdout ?? ""}`;
    expect(err).toMatch(/Production Auto Failover is NOT APPROVED/);
  });

  test("E3: heartbeat-loop refuses HA_CONTROLLER_MODE=auto before looping", () => {
    const r = spawnSync(
      "python3",
      [
        "-m",
        "controller",
        "heartbeat-loop",
        "--controller-id",
        "probe",
        "--failure-domain",
        "lab",
        "--database-url",
        "postgresql://unused/unused",
        "--interval-sec",
        "1",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PYTHONPATH: path.join(ROOT, "deploy/ha"),
          HA_CONTROLLER_MODE: "auto",
        },
        encoding: "utf8",
      },
    );
    expect(r.status).not.toBe(0);
    const err = `${r.stderr ?? ""}${r.stdout ?? ""}`;
    expect(err).toMatch(/Production Auto Failover is NOT APPROVED/);
  });
});
