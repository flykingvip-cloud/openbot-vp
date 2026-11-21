import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { PostgresRuntimeOutbox } from "./outbox.js";

it.skipIf(!process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL)(
  "independent consumers claim different events and fence a disconnected consumer",
  async () => {
    const { Client } = createRequire(import.meta.url)("pg");
    const clients = Array.from(
      { length: 3 },
      () => new Client({ connectionString: process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL }),
    );
    const schema = `runtime_outbox_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    try {
      await Promise.all(clients.map((db) => db.connect()));
      await clients[0].query(`CREATE SCHEMA ${schema}`);
      created = true;
      await Promise.all(clients.map((db) => db.query(`SET search_path TO ${schema}`)));
      await clients[0].query(
        fs.readFileSync("src/agent-runtime/state/postgres/execution.sql", "utf8"),
      );
      await clients[0].query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('tenant','execution','waiting')",
      );
      await clients[0].query(
        "INSERT INTO runtime_execution_outbox(tenant_id,event_id,execution_id,payload) VALUES ('tenant','a','execution','{}'),('tenant','b','execution','{}')",
      );
      const stores = clients.map((db) => new PostgresRuntimeOutbox(db));
      const [first, second] = await Promise.all([
        stores[0].claim("tenant"),
        stores[1].claim("tenant"),
      ]);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first!.event_id).not.toBe(second!.event_id);
      expect(await stores[2].claim("tenant")).toBeNull();
      // Simulate loss of consumer connection; claim survives, then expires by DB clock.
      await clients[0].end();
      await clients[2].query(
        "UPDATE runtime_execution_outbox SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1",
        [first!.event_id],
      );
      const recovered = await stores[2].claim("tenant");
      expect(recovered!.event_id).toBe(first!.event_id);
      expect(recovered!.claim_token).not.toBe(first!.claim_token);
      expect(await stores[1].acknowledge("tenant", first!.event_id, first!.claim_token)).toBe(
        false,
      );
      expect(
        await stores[2].acknowledge("tenant", recovered!.event_id, recovered!.claim_token),
      ).toBe(true);
      expect(await stores[1].acknowledge("tenant", second!.event_id, second!.claim_token)).toBe(
        true,
      );
      expect(
        (
          await clients[2].query(
            "SELECT count(*)::int AS n FROM runtime_execution_outbox WHERE delivered_at IS NOT NULL",
          )
        ).rows[0].n,
      ).toBe(2);
    } finally {
      if (created) {
        await clients[2].query(`DROP SCHEMA ${schema} CASCADE`);
      }
      await Promise.allSettled(clients.map((db) => db.end()));
    }
  },
);
