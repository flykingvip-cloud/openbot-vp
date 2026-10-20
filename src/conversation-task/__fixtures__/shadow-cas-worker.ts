/**
 * Test fixture (not a unit test): a child process that races to append the SAME
 * shadow tuple (tenantId, conversationId, messageId, decisionVersion, keyId) into a
 * shared per-tenant `.shadow.db`. Used by shadow-crossproc.test.ts to prove the
 * composite-UNIQUE + atomic create-if-absent yields exactly one row under real
 * cross-process OS file-lock contention (P2.5 AC4/#9), not a same-process loop.
 *
 * argv: <tenantId> <storeRoot> <conversationId> <messageId> <attempts>
 * stdout (last line): {"attempted","appended","failed","inserted"}
 */
import { ShadowLogBook, type TenantHmacKey } from "../shadow.js";
import { emptyTaskSignals, type ShadowDecisionLog } from "../types.js";

const KEY: TenantHmacKey = { keyId: "k-xproc", secret: "secret-xproc", issuedAtMs: 0 };
const LOG: ShadowDecisionLog = {
  shadowOnly: true,
  decisionVersion: "ct-xproc",
  inputFingerprint: "placeholder",
  detected: true,
  confidence: "high",
  qualification: "chat",
  signals: emptyTaskSignals(),
  sideEffect: "none",
  authorization: "none",
  reasonCodes: [],
  atMs: 0,
};

function main(): void {
  const [tenantId, storeRoot, conversationId, messageId, attemptsStr] = process.argv.slice(2);
  const attempts = Number(attemptsStr);
  const book = new ShadowLogBook({
    tenantId,
    storeRoot,
    keyProvider: () => KEY,
    now: () => 1_000,
  });
  let attempted = 0;
  let appended = 0; // append returned without throwing
  let failed = 0; // append threw
  let inserted = 0; // THIS process won the insert (stored.inserted === true)
  for (let i = 0; i < attempts; i++) {
    attempted++;
    try {
      const stored = book.append({ conversationId, messageId, text: "shadow-xproc", log: LOG });
      appended++;
      if (stored.inserted) {
        inserted++;
      }
    } catch {
      failed++;
    }
  }
  book.close();
  process.stdout.write(`${JSON.stringify({ attempted, appended, failed, inserted })}\n`);
}

main();
