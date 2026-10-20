#!/usr/bin/env node
/**
 * BYOK live canary (RPC driver).
 *
 * Run inside the gateway container (cwd=/app so `ws` resolves), usually via
 * deploy/production/scripts/byok-canary.sh.
 *
 * Required env:
 *   BYOK_API_KEY          Real provider API key (never logged)
 *   OPENBOT_GATEWAY_TOKEN Gateway token
 *
 * Optional env:
 *   BYOK_TENANT_ID        default 001
 *   BYOK_ADMIN_EMAIL      enterprise-admin email for x-forwarded-user
 *   BYOK_PROVIDER_TYPE    openai | anthropic | openai-compatible | custom
 *   BYOK_BASE_URL         required for openai-compatible / custom
 *   BYOK_DISPLAY_NAME     connection display name
 *   BYOK_UPSTREAM_MODEL   pin upstream id; else first discovered
 *   BYOK_SEAT_ID          pin seat; else first seats.list entry
 *   BYOK_GATEWAY_URL      default ws://127.0.0.1:18789
 *   BYOK_SKIP_AGENT=1     skip agent turn (still runs create→probe→grant→budget)
 *   BYOK_SKIP_BUDGET=1    skip budget-block step
 *   BYOK_CLEANUP=1        force-delete connection at end
 *   BYOK_PHASE=full|persist-check
 *     full           = create→…→budget (default)
 *     persist-check  = list/test existing connectionId (post-restart)
 *   BYOK_CONNECTION_ID    required for persist-check
 *   BYOK_RESULT_PATH      write JSON result (default stdout only)
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const SECRET_RE = /sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|key-[A-Za-z0-9_-]{8,}/g;

function env(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

function redact(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.replace(SECRET_RE, "[REDACTED_KEY]");
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

function extractCredits(payload) {
  const cs = payload?.creditsStatus;
  if (!cs || typeof cs !== "object") {
    return null;
  }
  return {
    creditsRemaining: cs.creditsRemaining ?? null,
    monthlyCredits: cs.monthlyCredits ?? null,
    creditsConsumed: cs.creditsConsumed ?? null,
  };
}

function resolveStateDir() {
  return env("OPENBOT_STATE_DIR") || env("OPENCLAW_STATE_DIR") || "/root/.openbot";
}

function loadAuditStoreEvents(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(data?.events) ? data.events : [];
  } catch {
    return [];
  }
}

/**
 * Assert create/probe/register/grant/invoke/budget-block audit rows exist for this
 * canary run, and that audit JSON contains no key-shaped secrets.
 */
function assertAuditTrail(result, { tenantId, sinceIso, apiKey, skipAgent, skipBudget }) {
  const stateDir = resolveStateDir();
  const emPath = join(stateDir, "openbot-enterprise-model-audit.json");
  const grantPath = join(stateDir, "openbot-model-grant-audit.json");
  const sinceMs = Date.parse(sinceIso) || 0;
  const emEvents = loadAuditStoreEvents(emPath).filter((e) => {
    if (e?.tenantId !== tenantId) {
      return false;
    }
    const ts = Date.parse(e.ts || "") || 0;
    return ts >= sinceMs - 2_000; // 2s skew
  });
  const grantEvents = loadAuditStoreEvents(grantPath).filter((e) => {
    if (e?.tenantId !== tenantId) {
      return false;
    }
    const ts = Date.parse(e.ts || "") || 0;
    return ts >= sinceMs - 2_000;
  });

  const checks = [
    {
      kind: "create",
      ok: emEvents.some(
        (e) =>
          e.action === "connection.created" &&
          e.targetId === result.connectionId &&
          e.result === "success",
      ),
    },
    {
      kind: "probe",
      ok: emEvents.some(
        (e) => e.action === "connection.tested" && e.targetId === result.connectionId,
      ),
    },
    {
      kind: "register",
      ok: emEvents.some((e) => e.action === "catalog.registered" && e.targetId === result.assetId),
    },
    {
      kind: "grant",
      ok: grantEvents.some(
        (e) =>
          e.type === "model.granted" &&
          Array.isArray(e.modelIds) &&
          e.modelIds.includes(result.runtimeModelId),
      ),
    },
  ];
  if (!skipAgent) {
    checks.push({
      kind: "invoke",
      ok: emEvents.some(
        (e) =>
          e.action === "runtime.invoked" &&
          e.result === "success" &&
          (e.targetId === result.assetId || e.details?.runtimeModelId === result.runtimeModelId),
      ),
    });
  }
  if (!skipBudget) {
    checks.push({
      kind: "budget-block",
      ok: emEvents.some(
        (e) =>
          e.action === "runtime.budget_blocked" &&
          e.targetId === result.assetId &&
          e.result === "failure",
      ),
    });
  }

  const hints = checks.map((c) => ({
    kind: c.kind,
    present: Boolean(c.ok),
  }));
  const missing = checks.filter((c) => !c.ok).map((c) => c.kind);

  const auditBlob = JSON.stringify({ emEvents, grantEvents });
  const secretLeak =
    SECRET_RE.test(auditBlob) ||
    (apiKey && apiKey.length >= 8 && auditBlob.includes(apiKey)) ||
    /BYOK_API_KEY=/.test(auditBlob);

  return {
    hints,
    missing,
    secretLeak,
    emPath,
    grantPath,
    emCount: emEvents.length,
    grantCount: grantEvents.length,
    pass: missing.length === 0 && !secretLeak,
  };
}

class GatewayRpc {
  constructor({ url, token, userEmail }) {
    this.url = url;
    this.token = token;
    this.userEmail = userEmail;
    this.ws = null;
    this.queue = [];
    this.waiters = [];
    this.closed = false;
  }

  async connect() {
    this.ws = new WebSocket(this.url, {
      headers: {
        "x-forwarded-user": this.userEmail,
        "x-forwarded-proto": "https",
        "x-forwarded-for": "127.0.0.1",
        origin: "https://localhost",
      },
    });
    this.ws.on("message", (raw) => {
      let msg;
      try {
        let text;
        if (typeof raw === "string") {
          text = raw;
        } else if (Buffer.isBuffer(raw)) {
          text = raw.toString("utf8");
        } else {
          return;
        }
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
    await this.recv(); // connect.challenge
    const hello = await this.request("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "cli", version: "1.0.0", platform: "linux", mode: "cli" },
      role: "operator",
      scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
      auth: { token: this.token },
    });
    if (!hello.ok) {
      die(`gateway connect: ${hello.error?.message || "unknown"}`);
    }
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

  async request(method, params = {}, { timeoutMs = 60_000 } = {}) {
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

async function snapshotCredits(rpc, tenantId) {
  const dash = await rpc.call("billing.dashboard", { tenantId, enterpriseId: tenantId });
  if (dash.ok) {
    return { source: "billing.dashboard", ok: true, credits: extractCredits(dash.payload) };
  }
  return {
    source: "billing.dashboard",
    ok: false,
    error: dash.error?.message || "dashboard failed",
    credits: null,
  };
}

/** Agent RPC ACKs immediately; wait for terminal lifecycle via agent.wait. */
async function runAgentAndWait(rpc, agentParams, { timeoutMs = 180_000 } = {}) {
  const accepted = await rpc.call("agent", agentParams, { timeoutMs: 30_000 });
  if (!accepted.ok) {
    return {
      ok: false,
      status: "rpc_error",
      error: accepted.error?.message || accepted.error?.details?.code || "agent rpc failed",
      runId: null,
      accepted,
    };
  }
  const runId = accepted.payload?.runId || accepted.raw?.runId || null;
  if (!runId) {
    return {
      ok: false,
      status: "missing_runId",
      error: "agent accepted without runId",
      runId: null,
      accepted,
    };
  }
  const waited = await rpc.call(
    "agent.wait",
    { runId, timeoutMs },
    { timeoutMs: timeoutMs + 5_000 },
  );
  const status = waited.payload?.status || (waited.ok ? "unknown" : "wait_failed");
  const error = waited.payload?.error || waited.error?.message || "";
  const ok = waited.ok && status === "ok";
  return { ok, status, error, runId, accepted, waited };
}

async function runPersistCheck(rpc, cfg) {
  const { tenantId, connectionId } = cfg;
  const listed = await rpc.call("enterprise-model-provider.list", {
    tenantId,
    enterpriseId: tenantId,
  });
  if (!listed.ok) {
    die(`persist list: ${listed.error?.message}`);
  }
  const conn = (listed.payload?.connections || []).find((c) => c.connectionId === connectionId);
  if (!conn) {
    die(`persist: connection ${connectionId} missing after restart`);
  }
  if (!conn.hasCredential) {
    die("persist: hasCredential=false after restart");
  }
  ok("persist.connection", `status=${conn.status} hasCredential=true`);

  const tested = await rpc.call("enterprise-model-provider.test", {
    tenantId,
    enterpriseId: tenantId,
    connectionId,
  });
  if (!tested.ok || tested.payload?.ok === false) {
    die(`persist.test: ${tested.error?.message || tested.payload?.code || "probe failed"}`);
  }
  ok("persist.test", `code=${tested.payload?.code || "OK"}`);

  const assets = await rpc.call("enterprise-model-catalog.list", {
    tenantId,
    enterpriseId: tenantId,
    connectionId,
  });
  if (!assets.ok) {
    die(`persist.catalog: ${assets.error?.message}`);
  }
  ok("persist.catalog", `assets=${(assets.payload?.assets || []).length}`);

  const grants = await rpc.call("enterprise-model-grant.list", {
    tenantId,
    enterpriseId: tenantId,
  });
  if (!grants.ok) {
    die(`persist.grants: ${grants.error?.message}`);
  }
  ok("persist.grants", "list ok");

  return {
    phase: "persist-check",
    pass: true,
    connectionId,
    connectionStatus: conn.status,
    assetCount: (assets.payload?.assets || []).length,
  };
}

async function runFull(rpc, cfg) {
  const {
    tenantId,
    apiKey,
    providerType,
    baseUrl,
    displayName,
    upstreamModelPin,
    seatIdPin,
    skipAgent,
    skipBudget,
    cleanup,
  } = cfg;

  const sinceIso = new Date().toISOString();
  const result = {
    phase: "full",
    pass: false,
    tenantId,
    steps: [],
    connectionId: null,
    assetId: null,
    runtimeModelId: null,
    seatId: null,
    creditsBefore: null,
    creditsAfter: null,
    creditsDeltaOk: null,
    agentOk: null,
    budgetBlocked: null,
    auditHints: [],
    auditPass: null,
  };

  const mark = (name, pass, detail) => {
    result.steps.push({ name, pass, detail });
    if (pass) {
      ok(name, detail);
    } else {
      console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // 1) create
  const createParams = {
    tenantId,
    enterpriseId: tenantId,
    providerType,
    displayName,
    apiKey,
  };
  if (baseUrl) {
    createParams.baseUrl = baseUrl;
  }
  const created = await rpc.call("enterprise-model-provider.create", createParams);
  if (!created.ok) {
    mark("create", false, created.error?.message);
    return result;
  }
  const connectionId = created.payload?.connection?.connectionId;
  if (!connectionId) {
    mark("create", false, "missing connectionId");
    return result;
  }
  result.connectionId = connectionId;
  if (JSON.stringify(created.payload).includes(apiKey)) {
    die("create leaked apiKey in response");
  }
  mark("create", true, `connectionId=${connectionId} status=${created.payload.connection.status}`);

  // 2) test / probe
  const tested = await rpc.call(
    "enterprise-model-provider.test",
    { tenantId, enterpriseId: tenantId, connectionId },
    { timeoutMs: 90_000 },
  );
  if (!tested.ok || tested.payload?.ok === false) {
    mark("probe", false, tested.error?.message || tested.payload?.code || "failed");
    return result;
  }
  const discoveredFromTest = tested.payload?.discoveredModels || [];
  mark("probe", true, `discovered=${discoveredFromTest.length} code=${tested.payload?.code}`);

  // 3) discover
  const discovered = await rpc.call(
    "enterprise-model-catalog.discover",
    { tenantId, enterpriseId: tenantId, connectionId },
    { timeoutMs: 90_000 },
  );
  if (!discovered.ok) {
    mark("discover", false, discovered.error?.message);
    return result;
  }
  const models = discovered.payload?.discoveredModels || discoveredFromTest;
  mark("discover", true, `models=${models.length}`);

  // 4) register
  let upstreamModelId = upstreamModelPin;
  if (!upstreamModelId) {
    upstreamModelId = models[0]?.upstreamModelId || models[0]?.id;
  }
  if (!upstreamModelId) {
    mark("register", false, "no upstream model (set BYOK_UPSTREAM_MODEL)");
    return result;
  }
  const registered = await rpc.call("enterprise-model-catalog.register", {
    tenantId,
    enterpriseId: tenantId,
    connectionId,
    upstreamModelId,
    displayName: `canary-${upstreamModelId}`,
    enabled: true,
    cost: { inputPer1kCents: 1, outputPer1kCents: 2, currency: "USD" },
  });
  if (!registered.ok) {
    mark("register", false, registered.error?.message);
    return result;
  }
  result.assetId = registered.payload?.asset?.assetId;
  result.runtimeModelId = registered.payload?.asset?.runtimeModelId;
  mark("register", true, `assetId=${result.assetId} runtimeModelId=${result.runtimeModelId}`);

  // 5) seat + grantBatch
  const seats = await rpc.call("seats.list", { tenantId, enterpriseId: tenantId });
  if (!seats.ok) {
    mark("seats.list", false, seats.error?.message);
    return result;
  }
  const seatRows = seats.payload?.seats || [];
  const seat =
    (seatIdPin && seatRows.find((s) => s.id === seatIdPin || s.seatId === seatIdPin)) ||
    seatRows[0];
  if (!seat) {
    mark("grantBatch", false, "no seats; assign a seat or set BYOK_SEAT_ID");
    return result;
  }
  const seatId = seat.id || seat.seatId;
  result.seatId = seatId;
  mark("seats.list", true, `seatId=${seatId} (of ${seatRows.length})`);

  const granted = await rpc.call("enterprise-model-grant.grantBatch", {
    tenantId,
    enterpriseId: tenantId,
    mergeMode: "union",
    grants: [
      {
        subjectType: "seat",
        subjectId: seatId,
        seatId,
        grantedModelIds: [result.runtimeModelId],
      },
    ],
  });
  if (!granted.ok) {
    mark("grantBatch", false, granted.error?.message);
    return result;
  }
  mark("grantBatch", true, `runtimeModelId=${result.runtimeModelId}`);

  // 6) credits before
  const creditsBefore = await snapshotCredits(rpc, tenantId);
  result.creditsBefore = creditsBefore;
  if (creditsBefore.ok && creditsBefore.credits) {
    mark("credits.before", true, `remaining=${creditsBefore.credits.creditsRemaining}`);
  } else {
    note(
      "credits.before",
      `dashboard unavailable (${creditsBefore.error || "null"}); shell wrapper will use disk bucket snapshot`,
    );
  }

  // 7) agent turn with BYOK model (pin session; empty fallbacks so platform models cannot rescue)
  let pinnedSessionKey = "";
  if (!skipAgent) {
    pinnedSessionKey = `agent:main:byok-canary-${Date.now()}`;
    const patched = await rpc.call("sessions.patch", {
      key: pinnedSessionKey,
      model: result.runtimeModelId,
    });
    if (!patched.ok) {
      mark("sessions.patch", false, patched.error?.message || "sessions.patch failed");
      return result;
    }
    const got = await rpc.call("sessions.get", { key: pinnedSessionKey });
    const gotModel =
      got.payload?.model || got.payload?.entry?.model || got.payload?.session?.model || "";
    if (got.ok && gotModel && String(gotModel).trim() !== String(result.runtimeModelId).trim()) {
      mark(
        "sessions.patch",
        false,
        `model not pinned (got=${redact(String(gotModel))} want=${result.runtimeModelId})`,
      );
      return result;
    }
    mark("sessions.patch", true, `model=${result.runtimeModelId}`);

    const agentRes = await runAgentAndWait(rpc, {
      message: "BYOK canary: reply with exactly OK and nothing else.",
      sessionKey: pinnedSessionKey,
      deliver: false,
      timeout: 90,
      idempotencyKey: randomUUID(),
      // Empty override replaces agents.defaults.model.fallbacks — no platform rescue.
      modelFallbacks: [],
    });
    result.agentOk = agentRes.ok;
    if (agentRes.ok) {
      mark("agent.call", true, `agent ok runId=${agentRes.runId}`);
    } else {
      mark(
        "agent.call",
        false,
        redact(`${agentRes.status}: ${agentRes.error || "agent failed"}`).slice(0, 160),
      );
      // Continue — budget / persist still valuable even if agent path blocked by seat wiring.
    }
  } else {
    note("agent.call", "skipped (BYOK_SKIP_AGENT=1)");
  }

  // 8) credits after
  const creditsAfter = await snapshotCredits(rpc, tenantId);
  result.creditsAfter = creditsAfter;
  if (
    creditsBefore.ok &&
    creditsAfter.ok &&
    creditsBefore.credits &&
    creditsAfter.credits &&
    creditsBefore.credits.creditsRemaining != null &&
    creditsAfter.credits.creditsRemaining != null
  ) {
    const delta =
      Number(creditsAfter.credits.creditsRemaining) -
      Number(creditsBefore.credits.creditsRemaining);
    result.creditsDeltaOk = delta === 0;
    mark(
      "credits.after",
      result.creditsDeltaOk,
      `remaining=${creditsAfter.credits.creditsRemaining} delta=${delta} (expect 0)`,
    );
  } else {
    note("credits.after", "dashboard path incomplete; rely on disk bucket A/B in shell wrapper");
  }

  // 9) budget block (cap=0 → spend>=0 blocks)
  if (!skipBudget) {
    const capped = await rpc.call("enterprise-model-catalog.update", {
      tenantId,
      enterpriseId: tenantId,
      assetId: result.assetId,
      budget: { monthlySpendCapCents: 0 },
    });
    const appliedCap = capped.payload?.asset?.budget?.monthlySpendCapCents;
    if (!capped.ok) {
      mark("budget.set-cap0", false, capped.error?.message);
    } else if (appliedCap !== 0) {
      mark(
        "budget.set-cap0",
        false,
        `update ok but cap not applied (got ${redact(String(appliedCap))})`,
      );
    } else {
      mark("budget.set-cap0", true, "monthlySpendCapCents=0");

      // Prefer the already-pinned BYOK session from the agent step. A fresh
      // session that fails to pin can silently run platform defaults and fake a PASS.
      let budgetSession = pinnedSessionKey;
      if (!budgetSession) {
        budgetSession = `agent:main:byok-budget-${Date.now()}`;
        const budgetPatch = await rpc.call("sessions.patch", {
          key: budgetSession,
          model: result.runtimeModelId,
        });
        if (!budgetPatch.ok) {
          mark("budget.block", false, `sessions.patch failed: ${budgetPatch.error?.message}`);
          await rpc.call("enterprise-model-catalog.update", {
            tenantId,
            enterpriseId: tenantId,
            assetId: result.assetId,
            budget: null,
          });
          return result;
        }
      }

      const listed = await rpc.call("enterprise-model-catalog.list", {
        tenantId,
        enterpriseId: tenantId,
        connectionId: result.connectionId,
      });
      const listedAsset = (listed.payload?.assets || []).find(
        (a) => a.assetId === result.assetId || a.id === result.assetId,
      );
      const listedCap = listedAsset?.budget?.monthlySpendCapCents;
      if (listedCap !== 0) {
        mark(
          "budget.block",
          false,
          `cap not visible on catalog.list before agent (got ${redact(String(listedCap))})`,
        );
      } else {
        // Re-pin before budget probe so a prior BYOK remap cannot leave openai/* runtime.
        const repin = await rpc.call("sessions.patch", {
          key: budgetSession,
          model: result.runtimeModelId,
        });
        if (!repin.ok) {
          mark("budget.block", false, `re-pin sessions.patch failed: ${repin.error?.message}`);
        } else {
          const blocked = await runAgentAndWait(
            rpc,
            {
              message: "BYOK budget canary — should be blocked.",
              sessionKey: budgetSession,
              deliver: false,
              timeout: 60,
              idempotencyKey: randomUUID(),
              modelFallbacks: [],
            },
            { timeoutMs: 120_000 },
          );
          const msg = String(blocked.error || "");
          const detailBlob = JSON.stringify({
            status: blocked.status,
            error: blocked.error,
            wait: blocked.waited?.payload,
          });
          const blockedOk =
            !blocked.ok &&
            (msg.toLowerCase().includes("budget") ||
              msg.toLowerCase().includes("forbidden") ||
              msg.includes("ENTERPRISE_MODEL_FORBIDDEN") ||
              detailBlob.toLowerCase().includes("budget") ||
              detailBlob.includes("ENTERPRISE_MODEL_FORBIDDEN"));
          result.budgetBlocked = blockedOk;
          mark(
            "budget.block",
            blockedOk,
            blockedOk
              ? `blocked as expected (${blocked.status}: ${redact(msg).slice(0, 80)})`
              : `expected budget block, got status=${blocked.status} err=${redact(msg || "none")} detail=${redact(detailBlob).slice(0, 160)}`,
          );
        }
      }

      // restore uncapped budget so persist-check / reuse stays usable
      await rpc.call("enterprise-model-catalog.update", {
        tenantId,
        enterpriseId: tenantId,
        assetId: result.assetId,
        budget: null,
      });
    }
  } else {
    note("budget.block", "skipped (BYOK_SKIP_BUDGET=1)");
  }

  // 10) optional cleanup
  if (cleanup) {
    const deleted = await rpc.call("enterprise-model-provider.delete", {
      tenantId,
      enterpriseId: tenantId,
      connectionId,
      force: true,
    });
    mark("cleanup.delete", deleted.ok, deleted.ok ? "force deleted" : deleted.error?.message);
  }

  // 11) audit trail (create/probe/register/grant/invoke/budget-block) — no secrets
  if (result.connectionId && result.assetId && result.runtimeModelId) {
    const audit = assertAuditTrail(result, {
      tenantId,
      sinceIso,
      apiKey,
      skipAgent,
      skipBudget,
    });
    result.auditHints = audit.hints;
    result.auditPass = audit.pass;
    if (audit.secretLeak) {
      mark("audit.trail", false, "audit store leaked key-shaped material");
    } else if (audit.missing.length > 0) {
      mark(
        "audit.trail",
        false,
        `missing events: ${audit.missing.join(",")} (em=${audit.emCount} grant=${audit.grantCount})`,
      );
    } else {
      mark(
        "audit.trail",
        true,
        `kinds=${audit.hints.map((h) => h.kind).join(",")} em=${audit.emCount} grant=${audit.grantCount}`,
      );
    }
  } else {
    mark("audit.trail", false, "skipped — missing connection/asset/runtime ids");
    result.auditPass = false;
  }

  result.pass = result.steps.filter((s) => !s.pass).length === 0;
  // Soft-fail agent alone shouldn't fail whole canary if create→grant→budget→audit passed
  const hardFails = result.steps.filter(
    (s) =>
      !s.pass &&
      !["agent.call", "credits.before", "credits.after", "sessions.patch"].includes(s.name),
  );
  result.pass =
    hardFails.length === 0 &&
    Boolean(result.connectionId && result.runtimeModelId) &&
    result.auditPass !== false;
  return result;
}

async function main() {
  const phase = env("BYOK_PHASE", "full");
  const token = env("OPENBOT_GATEWAY_TOKEN");
  const apiKey = env("BYOK_API_KEY");
  const tenantId = env("BYOK_TENANT_ID", "001");
  const userEmail = env("BYOK_ADMIN_EMAIL", "daniel.hhd@gmail.com");
  const url = env("BYOK_GATEWAY_URL", "ws://127.0.0.1:18789");
  const providerType = env("BYOK_PROVIDER_TYPE", "openai");
  const baseUrl = env("BYOK_BASE_URL");
  const displayName = env(
    "BYOK_DISPLAY_NAME",
    `byok-canary-${new Date().toISOString().slice(0, 10)}`,
  );
  const resultPath = env("BYOK_RESULT_PATH");

  if (!token) {
    die("OPENBOT_GATEWAY_TOKEN required");
  }
  if (phase === "full" && !apiKey) {
    die("BYOK_API_KEY required for full phase");
  }
  if (
    (providerType === "openai-compatible" || providerType === "custom") &&
    !baseUrl &&
    phase === "full"
  ) {
    die("BYOK_BASE_URL required for openai-compatible/custom");
  }
  if (phase === "persist-check" && !env("BYOK_CONNECTION_ID")) {
    die("BYOK_CONNECTION_ID required for persist-check");
  }

  console.log("=== BYOK canary RPC ===");
  console.log(`phase=${phase} tenant=${tenantId} user=${userEmail} provider=${providerType}`);
  console.log(`url=${url}`);

  const rpc = new GatewayRpc({ url, token, userEmail });
  let result;
  try {
    await rpc.connect();
    ok("connect", `trusted-proxy user=${userEmail}`);
    if (phase === "persist-check") {
      result = await runPersistCheck(rpc, {
        tenantId,
        connectionId: env("BYOK_CONNECTION_ID"),
      });
    } else {
      result = await runFull(rpc, {
        tenantId,
        apiKey,
        providerType,
        baseUrl,
        displayName,
        upstreamModelPin: env("BYOK_UPSTREAM_MODEL"),
        seatIdPin: env("BYOK_SEAT_ID"),
        skipAgent: env("BYOK_SKIP_AGENT") === "1",
        skipBudget: env("BYOK_SKIP_BUDGET") === "1",
        cleanup: env("BYOK_CLEANUP") === "1",
      });
    }
  } finally {
    rpc.close();
  }

  const out = redact(JSON.stringify(result, null, 2));
  console.log("--- result ---");
  console.log(out);
  if (resultPath) {
    writeFileSync(resultPath, out + "\n");
    note("result.written", resultPath);
  }

  if (!result?.pass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FAIL  fatal: ${redact(err?.stack || String(err))}`);
  process.exit(1);
});
