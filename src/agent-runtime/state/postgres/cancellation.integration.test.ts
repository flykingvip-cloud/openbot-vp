import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { PostgresExecutionRepository } from "./execution.js";
import { acquireExecutionLease } from "./lease-lifecycle.js";

it.skipIf(!process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL)(
  "remote cancellation aborts lease, DB failure aborts execution, and terminal races have one winner",
  async () => {
    const { Client } = createRequire(import.meta.url)("pg");
    const clients = Array.from(
      { length: 3 },
      () => new Client({ connectionString: process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL }),
    );
    const schema = `cancel_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    const leases: Awaited<ReturnType<typeof acquireExecutionLease>>[] = [];
    try {
      await Promise.all(clients.map((db) => db.connect()));
      await clients[0].query(`CREATE SCHEMA ${schema}`);
      created = true;
      await Promise.all(clients.map((db) => db.query(`SET search_path TO ${schema}`)));
      await clients[0].query(
        fs.readFileSync("src/agent-runtime/state/postgres/execution.sql", "utf8"),
      );
      const worker = new PostgresExecutionRepository(clients[0]),
        remote = new PostgresExecutionRepository(clients[1]);
      await clients[2].query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t','remote','ready'),('t','failure','ready')",
      );
      const lease = await acquireExecutionLease({
        repository: worker,
        tenantId: "t",
        executionId: "remote",
        owner: "worker",
        leaseMs: 900,
      });
      leases.push(lease);
      expect(await remote.requestCancellation("t", "remote", "cancel-remote")).toBe(true);
      await Promise.race([
        new Promise<void>((resolve) =>
          lease.signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("remote abort timeout")), 3000),
        ),
      ]);
      expect(lease.signal.aborted).toBe(true);
      const failure = await acquireExecutionLease({
        repository: worker,
        tenantId: "t",
        executionId: "failure",
        owner: "worker",
        leaseMs: 900,
      });
      leases.push(failure);
      await clients[0].end();
      await Promise.race([
        new Promise<void>((resolve) =>
          failure.signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("database failure abort timeout")), 3000),
        ),
      ]);
      expect(failure.signal.aborted).toBe(true);
      for (let round = 0; round < 12; round++) {
        const id = `race-${round}`;
        await clients[2].query(
          "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t',$1,'ready')",
          [id],
        );
        const owner = await remote.claim("t", id, "owner", 10000);
        const completion = new PostgresExecutionRepository(clients[2]);
        const [cancelled, completed] = await Promise.all([
          remote.requestCancellation("t", id, `cancel-${id}`),
          completion.settle({
            tenantId: "t",
            executionId: id,
            owner: "owner",
            fence: String(owner.fence),
            version: String(owner.version),
            state: "completed",
            eventId: `complete-${id}`,
            evidence: ["delivery"],
          }),
        ]);
        expect(Number(cancelled) + Number(completed)).toBe(1);
        expect(
          (
            await clients[2].query(
              "SELECT count(*)::int AS n FROM runtime_task_result_facts WHERE execution_id=$1",
              [id],
            )
          ).rows[0].n,
        ).toBe(1);
        expect(
          (
            await clients[2].query(
              "SELECT count(*)::int AS n FROM runtime_execution_outbox WHERE execution_id=$1",
              [id],
            )
          ).rows[0].n,
        ).toBe(1);
      }
    } finally {
      await Promise.all(leases.map((lease) => lease.dispose()));
      if (created) {
        await clients[2].query(`DROP SCHEMA ${schema} CASCADE`);
      }
      await Promise.allSettled(clients.map((db) => db.end()));
    }
  },
  20000,
);
