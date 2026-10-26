import fs from "node:fs";
import { DurableTaskOutcomeStore } from "./store.js";
import { TaskOutcomeResultService } from "./result-service.js";
import type { TrustedScope } from "./types.js";

const root = process.argv[2]!;
const expected = Number(process.argv[3]);
const fencing = process.argv[4]!;
const barrier = process.argv[5]!;
const id = process.argv[6]!;

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:race",
  subjectRef: "user:race",
  authzScopeRef: "race",
};

while (!fs.existsSync(barrier)) {
  // busy wait
}
const store = new DurableTaskOutcomeStore(root);
const service = new TaskOutcomeResultService({ store });
const res = service.submit(
  "t-race",
  {
    type: "set_acceptance",
    acceptance: { status: "failed" },
    allowRetry: false,
    expectedVersion: expected,
    fencingToken: fencing,
  },
  { commandId: `race-${id}`, requiredScope: scope },
);
fs.writeFileSync(
  `${root}/result-${id}.json`,
  JSON.stringify({ ok: res.ok, code: !res.ok ? res.code : undefined }),
);
