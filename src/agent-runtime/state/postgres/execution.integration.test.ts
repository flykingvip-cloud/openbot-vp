import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { PostgresExecutionRepository } from "./execution.js";

it.skipIf(!process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL)(
  "fences old workers, renews leases and commits one terminal event in real PostgreSQL",
  async () => {
    const require = createRequire(import.meta.url);
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query("CREATE SCHEMA runtime_test");
      await db.query("SET LOCAL search_path TO runtime_test");
      await db.query(fs.readFileSync("src/agent-runtime/state/postgres/execution.sql", "utf8"));
      await db.query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t','e','ready')",
      );
      const repo = new PostgresExecutionRepository(db);
      const first = await repo.claim("t", "e", "old", 10_000);
      expect(first).toBeTruthy();
      expect(await repo.claim("t", "e", "new", 10_000)).toBeNull();
      expect(
        await repo.renew({
          tenantId: "t",
          executionId: "e",
          owner: "old",
          fence: String(first.fence),
          leaseMs: 10_000,
        }),
      ).toBe(true);
      // Advance persisted expiry deterministically instead of relying on sleeps.
      await db.query(
        "UPDATE runtime_executions SET lease_expires_at=clock_timestamp()-interval '1 second'",
      );
      const next = await repo.claim("t", "e", "new", 10_000);
      expect(BigInt(String(next.fence))).toBeGreaterThan(BigInt(String(first.fence)));
      expect(
        await repo.renew({
          tenantId: "t",
          executionId: "e",
          owner: "old",
          fence: String(first.fence),
          leaseMs: 10_000,
        }),
      ).toBe(false);
      const old = {
        tenantId: "t",
        executionId: "e",
        owner: "old",
        fence: String(first.fence),
        version: String(first.version),
        state: "completed" as const,
        eventId: "old-event",
        evidence: ["receipt"],
      };
      expect(await repo.settle(old)).toBe(false);
      expect(
        await repo.settle({
          ...old,
          owner: "new",
          fence: String(next.fence),
          version: String(next.version),
          state: "cancelled",
          eventId: "cancel",
        }),
      ).toBe(true);
      expect(
        await repo.settle({
          ...old,
          owner: "new",
          fence: String(next.fence),
          version: String(next.version),
          eventId: "complete",
        }),
      ).toBe(false);
      expect(
        (await db.query("SELECT count(*)::int AS n FROM runtime_execution_outbox")).rows[0].n,
      ).toBe(1);
      await db.query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t','cancel-target','ready')",
      );
      const cancellationOwner = await repo.claim("t", "cancel-target", "worker", 10_000);
      expect(await repo.requestCancellation("other-tenant", "cancel-target", "wrong-cancel")).toBe(
        false,
      );
      expect(await repo.requestCancellation("t", "cancel-target", "trusted-cancel")).toBe(true);
      expect(await repo.requestCancellation("t", "cancel-target", "duplicate-cancel")).toBe(false);
      expect(
        await repo.renew({
          tenantId: "t",
          executionId: "cancel-target",
          owner: "worker",
          fence: String(cancellationOwner.fence),
          leaseMs: 10_000,
        }),
      ).toBe(false);
      expect(
        await repo.settle({
          ...old,
          executionId: "cancel-target",
          owner: "worker",
          fence: String(cancellationOwner.fence),
          version: String(cancellationOwner.version),
          eventId: "late-complete",
        }),
      ).toBe(false);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM runtime_execution_outbox WHERE execution_id='cancel-target'",
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
