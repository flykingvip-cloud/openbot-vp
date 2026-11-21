import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { PostgresExecutionRepository } from "./execution.js";
import { rebuildOperationalMetrics } from "./operational-metrics.js";
import { PostgresRuntimeOutbox } from "./outbox.js";
import { PostgresProjectionReceipts } from "./projection-receipts.js";
import { PostgresStatisticsProjection } from "./statistics-projection.js";
import {
  issueToolExecutionGrant,
  validateToolExecutionGrant,
  commitGrantedToolResult,
  claimGrantedToolIntent,
} from "./tool-execution-grant.js";

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
      expect(
        (
          await db.query(
            "SELECT state FROM runtime_task_result_facts WHERE tenant_id='t' AND execution_id='cancel-target'",
          )
        ).rows[0].state,
      ).toBe("cancelled");

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
      await db.query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t','wait-target','ready')",
      );
      const waitOwner = await repo.claim("t", "wait-target", "worker", 10_000);
      expect(
        await repo.wait({
          tenantId: "t",
          executionId: "wait-target",
          owner: "worker",
          fence: String(waitOwner.fence),
          version: String(waitOwner.version),
          eventId: "wait-event",
          reason: "delivery_pending",
        }),
      ).toBe(true);
      const waitRow = (
        await db.query(
          "SELECT state,lease_owner,payload FROM runtime_executions WHERE execution_id='wait-target'",
        )
      ).rows[0];
      expect(waitRow.state).toBe("waiting");
      expect(waitRow.lease_owner).toBeNull();
      expect(waitRow.payload.waitReason).toBe("delivery_pending");
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM runtime_execution_outbox WHERE execution_id='wait-target'",
          )
        ).rows[0].n,
      ).toBe(1);
      const outbox = new PostgresRuntimeOutbox(db);
      expect(await outbox.claim("other-tenant")).toBeNull();
      const event = await outbox.claim("t");
      expect(event).toBeTruthy();
      expect(await outbox.acknowledge("t", String(event!.event_id), "wrong-token")).toBe(false);
      await db.query(
        "UPDATE runtime_execution_outbox SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1",
        [event!.event_id],
      );
      expect(
        await outbox.acknowledge("t", String(event!.event_id), String(event!.claim_token)),
      ).toBe(false);
      const replacement = await outbox.claim("t");
      expect(replacement!.event_id).toBe(event!.event_id);
      expect(replacement!.claim_token).not.toBe(event!.claim_token);
      expect(
        await outbox.acknowledge(
          "t",
          String(replacement!.event_id),
          String(replacement!.claim_token),
        ),
      ).toBe(true);
      expect(
        await outbox.acknowledge(
          "t",
          String(replacement!.event_id),
          String(replacement!.claim_token),
        ),
      ).toBe(false);
      const receipts = new PostgresProjectionReceipts(db);
      const fact = {
        tenantId: "t",
        consumer: "statistics" as const,
        eventId: "fact",
        executionId: "e",
        payload: { success: true },
      };
      expect(await receipts.append(fact)).toBe("inserted");
      expect(await receipts.append(fact)).toBe("duplicate");
      await expect(receipts.append({ ...fact, payload: { success: false } })).rejects.toThrow(
        "conflicts",
      );
      expect(
        (await db.query("SELECT count(*)::int AS n FROM runtime_projection_receipts")).rows[0].n,
      ).toBe(1);
      const statistics = new PostgresStatisticsProjection(db);
      const stat = {
        tenantId: "t",
        agentId: "agent",
        eventId: "stat-event",
        executionId: "e",
        success: true,
      };
      await statistics.apply(stat);
      await statistics.apply(stat);
      await expect(statistics.apply({ ...stat, success: false })).rejects.toThrow("conflicts");
      const totals = (
        await db.query(
          "SELECT tasks_total,tasks_succeeded FROM runtime_statistics_projection WHERE tenant_id='t' AND agent_id='agent'",
        )
      ).rows[0];
      expect(String(totals.tasks_total)).toBe("1");
      expect(String(totals.tasks_succeeded)).toBe("1");
      await db.query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state) VALUES ('t','accepted','ready')",
      );
      const acceptedOwner = await repo.claim("t", "accepted", "worker", 10_000);
      expect(
        await repo.settle({
          tenantId: "t",
          executionId: "accepted",
          owner: "worker",
          fence: String(acceptedOwner.fence),
          version: String(acceptedOwner.version),
          state: "completed",
          eventId: "accepted-event",
          evidence: ["delivery-receipt"],
          statisticsAgentId: "agent",
          growthCapture: true,
        }),
      ).toBe(true);
      const produced = (
        await db.query("SELECT payload FROM runtime_execution_outbox WHERE execution_id='accepted'")
      ).rows;
      expect(produced).toHaveLength(3);
      const terminalFact = (
        await db.query(
          "SELECT state,evidence,agent_id FROM runtime_task_result_facts WHERE tenant_id='t' AND execution_id='accepted'",
        )
      ).rows[0];
      expect(terminalFact.state).toBe("completed");
      expect(terminalFact.agent_id).toBe("agent");
      expect(terminalFact.evidence.evidence).toEqual(["delivery-receipt"]);

      expect(
        produced.some(
          (row: { payload: Record<string, unknown> }) => row.payload.type === "growth.capture",
        ),
      ).toBe(true);
      expect(
        produced.some(
          (row: { payload: Record<string, unknown> }) =>
            row.payload.type === "statistics.outcome" && row.payload.success === true,
        ),
      ).toBe(true);
      const filtered = new PostgresRuntimeOutbox(db, ["statistics.outcome"]);
      const statisticEvent = await filtered.claim("t");
      expect((statisticEvent!.payload as Record<string, unknown>).type).toBe("statistics.outcome");
      expect(await filtered.claim("t")).toBeNull();
      expect(
        (
          await db.query(
            "SELECT delivered_at,claim_token FROM runtime_execution_outbox WHERE event_id='accepted-event'",
          )
        ).rows[0],
      ).toMatchObject({ delivered_at: null, claim_token: null });
      const rebuilt = await rebuildOperationalMetrics(db, { tenantId: "t", agentId: "agent" });
      expect(rebuilt.tasksTotal).toBe(1);
      expect(rebuilt.tasksSucceeded).toBe(1);
      expect(rebuilt.toolsTotal).toBe(0);
      expect(rebuilt.takeoverObservations).toBe(0);
      expect(
        await rebuildOperationalMetrics(db, { tenantId: "other", agentId: "agent" }),
      ).toMatchObject({ tasksTotal: 0, tasksSucceeded: 0 });
      await db.query(
        "INSERT INTO runtime_executions(tenant_id,execution_id,state,payload) VALUES ('t','tool-execution','ready','{\"taskId\":\"tool-task\"}')",
      );
      const toolLease = await repo.claim("t", "tool-execution", "tool-owner", 10000);
      const binding = {
        identity: {
          tenantId: "t",
          executionId: "tool-execution",
          taskId: "tool-task",
          stepId: "step",
          operationId: "write",
        },
        toolName: "message",
        sessionKey: "tenant:session",
        requestDigest: "digest",
        owner: "tool-owner",
        fence: String(toolLease.fence),
      };
      const token = await issueToolExecutionGrant(db, binding);
      expect(await claimGrantedToolIntent(db, token, binding)).toBe("claimed");
      expect(await claimGrantedToolIntent(db, token, binding)).toBe("unknown");
      expect(
        await claimGrantedToolIntent(db, token, { ...binding, requestDigest: "changed" }),
      ).toBe("denied");

      expect(await validateToolExecutionGrant(db, token, binding)).toBe(true);
      expect(await commitGrantedToolResult(db, token, binding, { receipt: "sent" })).toBe(true);
      expect(await commitGrantedToolResult(db, token, binding, { receipt: "sent" })).toBe(true);
      expect(await commitGrantedToolResult(db, token, binding, { receipt: "changed" })).toBe(false);

      expect(
        await validateToolExecutionGrant(db, token, { ...binding, requestDigest: "changed" }),
      ).toBe(false);
      await repo.requestCancellation("t", "tool-execution", "cancel-tool");
      expect(await validateToolExecutionGrant(db, token, binding)).toBe(false);
      expect(await commitGrantedToolResult(db, token, binding, { receipt: "sent" })).toBe(false);
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
