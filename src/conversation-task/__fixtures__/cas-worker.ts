/**
 * Test fixture (not a unit test): a child process that races to create the SAME
 * ConversationTask tuple in a shared per-tenant SQLite DB. Used by store.test.ts
 * to prove cross-process uniqueness (composite UNIQUE + BEGIN IMMEDIATE) with real
 * OS file-lock contention, not a same-process serial loop.
 *
 * argv: <tenantId> <storeRoot> <conversationId> <goal> <activationEpoch> <attempts>
 * stdout (last line): {"created": <number>}  // how many inserts THIS process won
 */

import { openTaskStore } from "../store.js";

function main(): void {
  const [tenantId, storeRoot, conversationId, goal, epochStr, attemptsStr] = process.argv.slice(2);
  const activationEpoch = Number(epochStr);
  const attempts = Number(attemptsStr);

  const store = openTaskStore({ tenantId, storeRoot });
  let attempted = 0;
  let succeeded = 0; // call returned without throwing (converged to the task)
  let failed = 0; // call threw (e.g. unrecovered SQLITE_BUSY)
  let created = 0; // this call inserted the row (changes === 1)
  for (let i = 0; i < attempts; i++) {
    attempted++;
    try {
      const result = store.createTaskIfAbsent({
        conversationId,
        goal,
        activationEpoch,
        requesterId: "worker",
      });
      succeeded++;
      if (result.created) {
        created++;
      }
    } catch {
      // Do NOT swallow silently for the pass/fail count: a throw is a real failure
      // to converge. busy_timeout (5s) should make this 0 for short transactions.
      failed++;
    }
  }
  store.close();
  process.stdout.write(`${JSON.stringify({ attempted, succeeded, failed, created })}\n`);
}

main();
