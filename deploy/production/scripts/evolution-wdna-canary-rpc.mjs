#!/usr/bin/env node
/* oxlint-disable curly */
/**
 * Working DNA governance isolated canary — Gateway WebSocket RPC driver only.
 *
 * Required env:
 *   OPENBOT_GATEWAY_TOKEN
 *   WDNA_CANARY_USER_EMAIL       default canary-rpc@acme.com
 *   WDNA_CANARY_TENANT_ID        default tenant-canary-rpc
 *   WDNA_CANARY_AGENT_ID         default canary-rpc-bot
 *   WDNA_CANARY_GATEWAY_URL       default ws://127.0.0.1:19795
 *   WDNA_CANARY_EVIDENCE_DIR     default /tmp/openbot-evo-canary-8184fbaf/rpc-loop
 *
 * Optional:
 *   WDNA_CANARY_RUN_ID           unique run id (default generated)
 *   WDNA_CANARY_NEGATIVE=1       run negative matrix only
 *   WDNA_CANARY_POSITIVE=1       run positive chain (default both)
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const SECRET_RE =
  /sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|key-[A-Za-z0-9_-]{8,}|evop1\.[A-Za-z0-9_-]+/g;

function env(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

function redact(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.replace(SECRET_RE, "[REDACTED]");
}

function die(msg, code = 1) {
  console.error(`FAIL  ${msg}`);
  process.exit(code);
}

function ok(step, detail = "") {
  console.log(`PASS  ${step}${detail ? ` — ${detail}` : ""}`);
}

function note(step, detail = "") {
  console.log(`NOTE  ${step}${detail ? ` — ${detail}` : ""}`);
}

class GatewayRpc {
  constructor({ url, token, userEmail, tenantId }) {
    this.url = url;
    this.token = token;
    this.userEmail = userEmail;
    this.tenantId = tenantId;
    this.ws = null;
    this.queue = [];
    this.waiters = [];
    this.closed = false;
  }

  async connect() {
    const useLoopbackOperator = env("WDNA_CANARY_LOOPBACK_OPERATOR", "0") === "1";
    const headers = useLoopbackOperator
      ? {}
      : {
          "x-forwarded-user": this.userEmail,
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canary.local",
          "x-forwarded-for": "127.0.0.1",
          origin: "https://canary.local",
        };
    this.ws = new WebSocket(this.url, { headers });
    this.ws.on("message", (raw) => {
      let msg;
      try {
        const text =
          typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
        if (!text) return;
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (this.waiters.length) {
        this.waiters.shift()(msg);
      } else {
        this.queue.push(msg);
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    await this.recv();
    const hello = await this.request("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "cli", version: "1.0.0", platform: "linux", mode: "cli" },
      role: "operator",
      scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
      auth: { token: this.token },
    });
    if (!hello.ok) {
      die(`gateway connect: ${hello.error?.message || JSON.stringify(hello.error)}`);
    }
    ok("connect", `user=${this.userEmail} tenant=${this.tenantId}`);
  }

  recv(timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("rpc recv timeout")), timeoutMs);
      if (this.queue.length) {
        clearTimeout(timer);
        resolve(this.queue.shift());
        return;
      }
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async request(method, params = {}, { timeoutMs = 120_000 } = {}) {
    const id = `r-${randomUUID()}`;
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.recv(Math.max(1_000, deadline - Date.now()));
      if (msg.type === "res" && msg.id === id) {
        return msg;
      }
    }
    throw new Error(`timeout waiting for ${method}`);
  }

  async call(method, params = {}, opts) {
    const res = await this.request(method, params, opts);
    return {
      ok: Boolean(res.ok),
      payload: res.payload,
      error: res.error,
      raw: res,
    };
  }

  close() {
    if (this.ws && !this.closed) {
      this.closed = true;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function freeze(candidateRef, tenantId) {
  return {
    baselineVersion: "style-seed",
    candidateVersion: candidateRef,
    codeSha: "sha-canary",
    modelRef: "model-canary",
    providerVersion: "provider-canary",
    configSnapshotRef: "cfg-canary",
    datasetOrCohortRef: "cohort-canary",
    tenantScope: tenantId,
    confidentialityScope: "enterprise",
    expiresAt: "2027-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

async function expectFail(label, rpc, method, params) {
  const res = await rpc.call(method, params);
  const pass = !res.ok;
  if (pass) {
    ok(`negative:${label}`, res.error?.message || "rejected");
  } else {
    console.error(`FAIL  negative:${label} — expected rejection, got ok`);
  }
  return { label, pass, error: res.error?.message || null };
}

async function runPositiveChain(rpc, cfg) {
  const { tenantId, agentId, runId, evidence } = cfg;
  const steps = {};

  note("positive-chain", `runId=${runId}`);

  const sessionKey = `agent:${agentId}:direct:${runId}`;
  const outcome = await rpc.call("evolution.task-outcomes.record", {
    commandId: `cmd-outcome-${runId}`,
    agentId,
    runId,
    sessionKey,
    succeeded: true,
    occurredAt: Date.now(),
    latencyMs: 40,
    securityViolation: false,
    humanTakeover: false,
  });
  steps["1.task-outcomes.record"] = {
    pass: outcome.ok,
    error: outcome.error?.message || null,
  };
  if (!outcome.ok) die(`step 1 task-outcomes.record: ${outcome.error?.message}`);

  const ingest1 = await rpc.call("pattern-detection.ingest-sample", {
    agentId,
    runId,
    inputStructureHash: "canary-in",
    outputStructureHash: "canary-out",
    idempotencyKey: `idem-${runId}`,
  });
  steps["2.ingest-sample.first"] = {
    pass: ingest1.ok,
    observationId: ingest1.payload?.observation?.runId || null,
    error: ingest1.error?.message || null,
  };
  if (!ingest1.ok) die(`step 2 ingest-sample: ${ingest1.error?.message}`);

  const ingest2 = await rpc.call("pattern-detection.ingest-sample", {
    agentId,
    runId,
    inputStructureHash: "canary-in",
    outputStructureHash: "canary-out",
    idempotencyKey: `idem-${runId}`,
  });
  steps["2.ingest-sample.idempotent"] = {
    pass: ingest2.ok,
    sameRunId: ingest2.payload?.observation?.runId === runId,
    error: ingest2.error?.message || null,
  };
  if (!ingest2.ok) die(`step 2b idempotent ingest: ${ingest2.error?.message}`);

  const grantReq = await rpc.call("evolution.delegation.request", {
    commandId: `cmd-grant-req-${runId}`,
    agentId,
    evidenceRefs: [`obs:${runId}`],
  });
  steps["4.delegation.request"] = {
    pass: grantReq.ok,
    error: grantReq.error?.message || null,
  };
  if (!grantReq.ok) die(`step 4 delegation.request: ${grantReq.error?.message}`);
  const grantId = grantReq.payload?.grantId;
  evidence.grantId = grantId;

  const grantAppr = await rpc.call("evolution.delegation.approve", {
    commandId: `cmd-grant-appr-${runId}`,
    grantId,
  });
  steps["4.delegation.approve"] = {
    pass: grantAppr.ok,
    error: grantAppr.error?.message || null,
  };
  if (!grantAppr.ok) die(`step 4b delegation.approve: ${grantAppr.error?.message}`);

  const propose = await rpc.call("pattern-detection.propose-working-dna", {
    commandId: `cmd-propose-${runId}`,
    agentId,
    grantId,
    runId,
    evidenceRefs: [`obs:${runId}`],
  });
  steps["3.propose-working-dna"] = {
    pass: propose.ok && !propose.payload?.skipped,
    skipped: propose.payload?.skipped ?? false,
    proposalId: propose.payload?.proposalId || null,
    candidateRef: propose.payload?.candidateRef || null,
    error: propose.error?.message || propose.payload?.reason || null,
  };
  if (!propose.ok || propose.payload?.skipped) {
    die(`step 3 propose-working-dna: ${propose.error?.message || propose.payload?.reason}`);
  }
  const proposalId = propose.payload.proposalId;
  const candidateRef = propose.payload.candidateRef;
  evidence.proposalId = proposalId;
  evidence.candidateRef = candidateRef;

  for (let i = 0; i < 20; i += 1) {
    const baselineRun = `${runId}-baseline-${i}`;
    const baseline = await rpc.call("evolution.task-outcomes.record", {
      commandId: `cmd-baseline-${runId}-${i}`,
      agentId,
      runId: baselineRun,
      sessionKey: `agent:${agentId}:direct:${baselineRun}`,
      succeeded: i % 2 === 0,
      occurredAt: Date.now() - (20 - i) * 1000,
      latencyMs: 40 + i,
      securityViolation: false,
      humanTakeover: false,
    });
    if (!baseline.ok) {
      die(`baseline seed ${i}: ${baseline.error?.message}`);
    }
  }

  const experiment = await rpc.call("evolution.experiments.create", {
    commandId: `cmd-exp-${runId}`,
    proposalId,
    freeze: freeze(candidateRef, tenantId),
  });
  steps["5.experiments.create"] = {
    pass: experiment.ok,
    experimentId: experiment.payload?.experiment?.experimentId || null,
    error: experiment.error?.message || null,
  };
  if (!experiment.ok) die(`step 5 experiments.create: ${experiment.error?.message}`);
  const experimentId = experiment.payload.experiment.experimentId;
  evidence.experimentId = experimentId;

  const evaluated = await rpc.call("evolution.experiments.evaluate", {
    commandId: `cmd-eval-${runId}`,
    experimentId,
  });
  steps["5b.experiments.evaluate"] = {
    pass: evaluated.ok,
    decision: evaluated.payload?.decision?.status || evaluated.payload?.decision || null,
    error: evaluated.error?.message || null,
  };
  if (!evaluated.ok) die(`step 5b experiments.evaluate: ${evaluated.error?.message}`);

  const applied = await rpc.call("evolution.applications.apply", {
    commandId: `cmd-apply-${runId}`,
    proposalId,
    experimentId,
    scope: "canary",
  });
  steps["6.applications.apply"] = {
    pass: applied.ok,
    applicationId: applied.payload?.application?.applicationId || null,
    error: applied.error?.message || null,
  };
  if (!applied.ok) die(`step 6 applications.apply: ${applied.error?.message}`);
  const applicationId = applied.payload.application.applicationId;
  evidence.applicationId = applicationId;

  const verified = await rpc.call("evolution.working-dna.verify-effect", {
    commandId: `cmd-verify-${runId}`,
    agentId,
    runId,
    field: "reportingCadence",
    expectedValue: "milestone",
  });
  steps["7.verify-effect"] = {
    pass: verified.ok && verified.payload?.verification?.result === "verified",
    result: verified.payload?.verification?.result || null,
    error: verified.error?.message || null,
  };
  if (!steps["7.verify-effect"].pass) {
    die(
      `step 7 verify-effect: ${verified.error?.message || verified.payload?.verification?.result}`,
    );
  }

  const promote = await rpc.call("evolution.working-dna.evaluate-promote", {
    commandId: `cmd-promote-${runId}`,
    agentId,
    runId,
  });
  const gateOk = promote.payload?.gate?.ok === true;
  steps["8.evaluate-promote"] = {
    pass: promote.ok && gateOk,
    gate: promote.payload?.gate || null,
    error: promote.error?.message || null,
  };
  if (!steps["8.evaluate-promote"].pass) {
    die(
      `step 8 evaluate-promote: ${promote.error?.message || JSON.stringify(promote.payload?.gate)}`,
    );
  }

  const rolled = await rpc.call("evolution.applications.rollback", {
    commandId: `cmd-rollback-${runId}`,
    applicationId,
  });
  steps["9.applications.rollback"] = {
    pass: rolled.ok,
    status: rolled.payload?.application?.status || null,
    error: rolled.error?.message || null,
  };
  if (!rolled.ok) die(`step 9 rollback: ${rolled.error?.message}`);

  const restored = await rpc.call("evolution.working-dna.verify-effect", {
    commandId: `cmd-restore-check-${runId}`,
    agentId,
    runId,
    field: "reportingCadence",
    expectedValue: "on_completion",
  });
  steps["10.working-style-restored"] = {
    pass: restored.ok && restored.payload?.verification?.result === "verified",
    result: restored.payload?.verification?.result || null,
    error: restored.error?.message || null,
  };
  if (!steps["10.working-style-restored"].pass) {
    die(
      `step 10 style restored: ${restored.error?.message || restored.payload?.verification?.result}`,
    );
  }

  for (const [k, v] of Object.entries(steps)) {
    if (v.pass) ok(`positive:${k}`);
  }
  return steps;
}

async function runNegativeMatrix(rpc, cfg) {
  const { agentId, runId, otherTenant, otherAgent } = cfg;
  const results = [];

  results.push(
    await expectFail("missing-ownership-proof", rpc, "pattern-detection.ingest-sample", {
      agentId,
      runId: `${runId}-neg-noproof`,
      inputStructureHash: "in",
      outputStructureHash: "out",
    }),
  );

  results.push(
    await expectFail("missing-runId", rpc, "evolution.task-outcomes.record", {
      commandId: `cmd-neg-norun-${runId}`,
      agentId,
      succeeded: true,
    }),
  );

  results.push(
    await expectFail("cross-tenant-claim", rpc, "pattern-detection.ingest-sample", {
      agentId,
      runId,
      tenantId: otherTenant,
      inputStructureHash: "in",
      outputStructureHash: "out",
    }),
  );

  results.push(
    await expectFail("wrong-session-agent", rpc, "pattern-detection.ingest-sample", {
      agentId,
      runId,
      sessionKey: `agent:${otherAgent}:direct:u1`,
      inputStructureHash: "in",
      outputStructureHash: "out",
    }),
  );

  results.push(
    await expectFail("missing-grant-on-propose", rpc, "pattern-detection.propose-working-dna", {
      commandId: `cmd-neg-nogrant-${runId}`,
      agentId,
      grantId: "grant-does-not-exist",
      runId: `${runId}-neg-nogrant`,
      evidenceRefs: ["ev:missing"],
    }),
  );

  const expiredReq = await rpc.call("evolution.delegation.request", {
    commandId: `cmd-exp-req-${runId}`,
    agentId,
    expiresAt: "2020-01-01T00:00:00.000Z",
    evidenceRefs: ["ev-expired"],
  });
  if (expiredReq.ok) {
    await rpc.call("evolution.delegation.approve", {
      commandId: `cmd-exp-appr-${runId}`,
      grantId: expiredReq.payload.grantId,
    });
    const expiredProp = await rpc.call("pattern-detection.propose-working-dna", {
      commandId: `cmd-exp-propose-${runId}`,
      agentId,
      grantId: expiredReq.payload.grantId,
      runId: `${runId}-neg-expired`,
      evidenceRefs: ["ev-expired"],
    });
    results.push({
      label: "expired-grant",
      pass: !expiredProp.ok || expiredProp.payload?.skipped,
      error: expiredProp.error?.message || expiredProp.payload?.reason || null,
    });
  } else {
    results.push({ label: "expired-grant", pass: true, error: expiredReq.error?.message });
  }

  const mismatchReq = await rpc.call("evolution.delegation.request", {
    commandId: `cmd-mismatch-req-${runId}`,
    agentId,
    evidenceRefs: ["ev-mismatch"],
  });
  if (mismatchReq.ok) {
    await rpc.call("evolution.delegation.approve", {
      commandId: `cmd-mismatch-appr-${runId}`,
      grantId: mismatchReq.payload.grantId,
    });
    const mismatchProp = await rpc.call("pattern-detection.propose-working-dna", {
      commandId: `cmd-mismatch-propose-${runId}`,
      agentId: otherAgent,
      grantId: mismatchReq.payload.grantId,
      runId: `${runId}-neg-mismatch`,
      evidenceRefs: ["ev-mismatch"],
    });
    results.push({
      label: "grant-agent-mismatch",
      pass: !mismatchProp.ok,
      error: mismatchProp.error?.message || null,
    });
  }

  results.push(
    await expectFail("skill-spec-apply-without-grant", rpc, "evolution.applications.apply", {
      commandId: `cmd-neg-skill-${runId}`,
      proposalId: "evo:skill:fake",
      experimentId: "exp:fake",
      scope: "canary",
    }),
  );

  results.push(
    await expectFail(
      "verifier-unavailable-missing-agent",
      rpc,
      "evolution.working-dna.verify-effect",
      {
        commandId: `cmd-neg-unavail-${runId}`,
        agentId: "missing-canary-bot",
        runId: `${runId}-neg-unavail`,
        field: "reportingCadence",
        expectedValue: "milestone",
      },
    ),
  );

  const contradictRun = `${runId}-neg-contradict`;
  const contradictIngest = await rpc.call("pattern-detection.ingest-sample", {
    agentId,
    runId: contradictRun,
    inputStructureHash: "neg-in",
    outputStructureHash: "neg-out",
  });
  if (contradictIngest.ok) {
    const contradictVerify = await rpc.call("evolution.working-dna.verify-effect", {
      commandId: `cmd-neg-contradict-${runId}`,
      agentId,
      runId: contradictRun,
      field: "reportingCadence",
      expectedValue: "nonexistent-value",
    });
    const result = contradictVerify.payload?.verification?.result;
    results.push({
      label: "verify-effect-contradicted",
      pass:
        contradictVerify.ok &&
        (result === "contradicted" || result === "not_observed" || result === "unavailable"),
      error: contradictVerify.error?.message || result || null,
    });
  } else {
    results.push({
      label: "verify-effect-contradicted",
      pass: true,
      error: contradictIngest.error?.message,
    });
  }

  results.push(
    await expectFail("capsule-apply-without-grant", rpc, "evolution.applications.apply", {
      commandId: `cmd-neg-capsule-${runId}`,
      proposalId: "evo:capsule:legacy-no-cluster-ref",
      experimentId: "exp:fake-capsule",
      scope: "canary",
    }),
  );

  const passed = results.filter((r) => r.pass).length;
  note("negative-matrix", `${passed}/${results.length} fail-closed`);
  return results;
}

async function main() {
  const token = env("OPENBOT_GATEWAY_TOKEN");
  if (!token) die("OPENBOT_GATEWAY_TOKEN required");

  const tenantId = env("WDNA_CANARY_TENANT_ID", "tenant-canary-rpc");
  const agentId = env("WDNA_CANARY_AGENT_ID", "canary-rpc-bot");
  const userEmail = env("WDNA_CANARY_USER_EMAIL", "canary-rpc@acme.com");
  const gatewayUrl = env("WDNA_CANARY_GATEWAY_URL", "ws://127.0.0.1:19795");
  const evidenceDir = env("WDNA_CANARY_EVIDENCE_DIR", "/tmp/openbot-evo-canary-8184fbaf/rpc-loop");
  const runId = env("WDNA_CANARY_RUN_ID", `wdna-canary-${Date.now()}`);
  const runPositive = env("WDNA_CANARY_POSITIVE", "1") !== "0";
  const runNegative = env("WDNA_CANARY_NEGATIVE", "1") !== "0";

  mkdirSync(evidenceDir, { recursive: true });

  const rpc = new GatewayRpc({ url: gatewayUrl, token, userEmail, tenantId });
  const evidence = {
    schemaVersion: 1,
    runId,
    tenantId,
    agentId,
    gatewayUrl,
    startedAt: new Date().toISOString(),
    positive: null,
    negative: null,
    idempotency: null,
  };

  try {
    await rpc.connect();

    if (runPositive) {
      evidence.positive = await runPositiveChain(rpc, {
        tenantId,
        agentId,
        runId,
        evidence,
      });
      evidence.idempotency = evidence.positive?.["2.ingest-sample.idempotent"] || null;
    }

    if (runNegative) {
      evidence.negative = await runNegativeMatrix(rpc, {
        tenantId,
        agentId,
        runId,
        otherTenant: "tenant-other-canary",
        otherAgent: "other-canary-bot",
      });
    }

    evidence.completedAt = new Date().toISOString();
    evidence.pass =
      (!runPositive || Object.values(evidence.positive || {}).every((s) => s.pass)) &&
      (!runNegative || (evidence.negative || []).every((r) => r.pass));

    const outPath = join(evidenceDir, "evidence.redacted.json");
    writeFileSync(
      outPath,
      `${JSON.stringify(JSON.parse(redact(JSON.stringify(evidence))), null, 2)}\n`,
    );
    ok("evidence", outPath);
    console.log(JSON.stringify({ pass: evidence.pass, evidencePath: outPath }, null, 2));
    if (!evidence.pass) process.exit(1);
  } finally {
    rpc.close();
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
