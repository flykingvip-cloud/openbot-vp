#!/usr/bin/env node
/**
 * Slice2 real-model + gateway WS acceptance (isolated :19101).
 * Does NOT touch production :18789. No merge/deploy.
 *
 * Usage:
 *   OPENBOT_STATE_DIR=/tmp/openbot-pr216-e2e-state-01e15de99 \
 *   node src/auto-reply/reply/slice2-e2e-real-model-accept.mjs
 *
 * Lives under src/auto-reply/reply/ (feature landing stream) rather than
 * scripts/dev/** (H1I2 exclusive release/distribution surface).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

function toText(data) {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

/** Minimal gateway WS client with Origin headers (feature-local; not scripts/dev). */
function createGatewayWsClient(params) {
  const ws = new WebSocket(params.url, {
    handshakeTimeout: params.handshakeTimeoutMs ?? 8000,
    headers: params.headers,
  });
  const pending = new Map();

  const request = (method, paramsObj, timeoutMs = 12_000) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const frame = { type: "req", id, method, params: paramsObj };
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify(frame));
    });

  const waitOpen = () =>
    new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("ws open timeout")),
        params.openTimeoutMs ?? 8000,
      );
      ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.once("error", (err) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

  ws.on("message", (data) => {
    let frame = null;
    try {
      frame = JSON.parse(toText(data));
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object" || !("type" in frame)) {
      return;
    }
    if (frame.type === "res") {
      const waiter = pending.get(frame.id);
      if (waiter) {
        pending.delete(frame.id);
        clearTimeout(waiter.timeout);
        waiter.resolve(frame);
      }
      return;
    }
    if (frame.type === "event") {
      params.onEvent?.(frame);
    }
  });

  const close = () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
    }
    pending.clear();
    ws.close();
  };

  return { ws, request, waitOpen, close };
}

const PORT = Number(process.env.OPENBOT_E2E_PORT || 19101);
const STATE =
  process.env.OPENBOT_STATE_DIR ||
  process.env.OPENCLAW_STATE_DIR ||
  "/tmp/openbot-pr216-e2e-state-01e15de99";
const OUT_DIR = process.env.OPENBOT_E2E_OUT || "/tmp/openbot-pr216-e2e-out";
const SESSION_KEY = process.env.OPENBOT_E2E_SESSION || `agent:main:slice2-e2e-${Date.now()}`;
const TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN ||
  process.env.OPENBOT_GATEWAY_TOKEN ||
  fs.readFileSync(path.join(STATE, ".gateway-token"), "utf8").trim();

fs.mkdirSync(OUT_DIR, { recursive: true });

const timeline = [];
const mark = (phase, detail = {}) => {
  const row = {
    atAsiaShanghai:
      new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
      "+08:00",
    tMs: Date.now(),
    phase,
    ...detail,
  };
  timeline.push(row);
  console.log(
    `[${row.atAsiaShanghai}] ${phase}`,
    detail.message ? `:: ${String(detail.message).slice(0, 120)}` : "",
    detail.ok != null ? `ok=${detail.ok}` : "",
  );
};

function clip(s, n = 240) {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function flattenContent(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        if (typeof part.text === "string") {
          return part.text;
        }
        if (typeof part.content === "string") {
          return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  return "";
}

function extractText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const p = payload;
  if (typeof p.message === "string") {
    return p.message;
  }
  if (p.message && typeof p.message === "object") {
    const fromMsg =
      (typeof p.message.text === "string" && p.message.text) ||
      flattenContent(p.message.content) ||
      flattenContent(p.message);
    if (fromMsg) {
      return fromMsg;
    }
  }
  if (typeof p.text === "string") {
    return p.text;
  }
  if (p.content != null) {
    const c = flattenContent(p.content);
    if (c) {
      return c;
    }
  }
  if (Array.isArray(p.messages)) {
    const last = [...p.messages]
      .toReversed()
      .find((m) => m && (m.role === "assistant" || m.text || m.content));
    if (!last) {
      return "";
    }
    return (typeof last.text === "string" && last.text) || flattenContent(last.content) || "";
  }
  return "";
}

function messageText(m) {
  if (!m || typeof m !== "object") {
    return "";
  }
  return (typeof m.text === "string" && m.text) || flattenContent(m.content) || "";
}

async function main() {
  const url = `ws://127.0.0.1:${PORT}`;
  const chatEvents = [];
  const { request, waitOpen, close } = createGatewayWsClient({
    url,
    openTimeoutMs: 15000,
    // Control UI origin gate: Node ws sends no Origin by default.
    headers: { Origin: `http://127.0.0.1:${PORT}` },
    onEvent: (evt) => {
      if (evt.event === "connect.challenge") {
        return;
      }
      if (evt.event === "chat") {
        const p = evt.payload || {};
        chatEvents.push({
          at: Date.now(),
          runId: p.runId,
          sessionKey: p.sessionKey,
          state: p.state,
          text: clip(extractText(p), 400),
          rawKeys: Object.keys(p),
        });
        if (p.state === "final" || p.state === "aborted" || p.state === "error") {
          mark(`chat.${p.state}`, {
            runId: p.runId,
            message: clip(extractText(p), 160),
          });
        }
      }
    },
  });

  await waitOpen();
  mark("ws.open", { url, sessionKey: SESSION_KEY });

  const connectRes = await request("connect", {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "openclaw-control-ui",
      displayName: "slice2-e2e-accept",
      version: "2026.7.12-rc.2",
      platform: "Mac",
      mode: "webchat",
      instanceId: `slice2-e2e-${randomUUID().slice(0, 8)}`,
    },
    locale: "zh-CN",
    userAgent: "slice2-e2e-real-model-accept",
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin"],
    caps: [],
    auth: { token: TOKEN },
  });
  if (!connectRes.ok) {
    mark("connect.fail", { error: connectRes.error });
    throw new Error(`connect failed: ${JSON.stringify(connectRes.error)}`);
  }
  mark("connect.ok");

  const health = await request("health");
  mark("health", { ok: health.ok });

  async function send(message, label) {
    const idempotencyKey = randomUUID();
    const startedAt = Date.now();
    mark("chat.send", { label, message: clip(message, 160), runId: idempotencyKey });
    const res = await request(
      "chat.send",
      {
        sessionKey: SESSION_KEY,
        message,
        deliver: false,
        idempotencyKey,
      },
      60_000,
    );
    mark("chat.send.ack", {
      label,
      ok: res.ok,
      status: res.payload?.status,
      runId: res.payload?.runId || idempotencyKey,
      error: res.error ? clip(JSON.stringify(res.error), 200) : undefined,
      latencyMs: Date.now() - startedAt,
    });
    return { idempotencyKey, res, startedAt };
  }

  function waitForRunFinal(runId, timeoutMs, pred) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const hits = chatEvents.filter(
          (e) =>
            e.runId === runId &&
            (e.state === "final" || e.state === "aborted" || e.state === "error"),
        );
        const hit = pred ? hits.find((e) => pred(e)) : hits[0];
        if (hit) {
          return resolve(hit);
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timeout waiting final for ${runId}`));
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  function waitForAnyFinalAfter(t0, timeoutMs, pred) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const hits = chatEvents.filter(
          (e) =>
            e.at >= t0 &&
            (e.state === "final" || e.state === "aborted" || e.state === "error") &&
            (!pred || pred(e)),
        );
        if (hits.length) {
          return resolve(hits[0]);
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error("timeout waiting any final"));
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  async function historySnapshot(label) {
    const res = await request("chat.history", { sessionKey: SESSION_KEY, limit: 80 }, 30_000);
    const messages = Array.isArray(res.payload?.messages) ? res.payload.messages : [];
    const summary = messages.map((m) => ({
      role: m.role,
      id: m.id || m.messageId,
      text: clip(messageText(m), 120),
    }));
    mark("chat.history", {
      label,
      ok: res.ok,
      count: summary.length,
      message: summary
        .slice(-6)
        .map((m) => `${m.role}:${m.text}`)
        .join(" | "),
    });
    return { res, messages: summary, raw: messages };
  }

  const results = {
    tip: null,
    scenarios: {},
  };

  // -------- Scenario B-first: long A + quick B --------
  mark("scenario.b_first.start");
  const A_PROMPT_LONG =
    "【任务A-长】这是一个会占用一段时间的后台任务。请务必调用 exec 工具执行命令：sleep 35（不要跳过工具、不要口头假装已睡）。命令返回后再只输出一行：A_LONG_DONE。执行期间不要提前结束。";
  const a1 = await send(A_PROMPT_LONG, "A_long");
  const a1Run = a1.res.payload?.runId || a1.idempotencyKey;
  // Wait until A shows streaming/delta (busy) and has NOT finalized — need real exec occupancy.
  {
    const deadline = Date.now() + 25_000;
    let ready = false;
    while (Date.now() < deadline) {
      const finals = chatEvents.filter(
        (e) =>
          e.runId === a1Run &&
          (e.state === "final" || e.state === "aborted" || e.state === "error"),
      );
      const deltas = chatEvents.filter((e) => e.runId === a1Run && e.state && e.state !== "final");
      if (finals.length) {
        mark("A_long.early_final", {
          ok: false,
          message: clip(finals[0].text || finals[0].state),
        });
        break;
      }
      if (deltas.length >= 1 && Date.now() - a1.startedAt > 4000) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (
      !ready &&
      !chatEvents.some((e) => e.runId === a1Run && (e.state === "final" || e.state === "aborted"))
    ) {
      // still no final — treat as busy enough
      ready = true;
    }
    mark("A_long.occupancy", {
      ok: ready && !chatEvents.some((e) => e.runId === a1Run && e.state === "final"),
      message: `ready=${ready}`,
    });
  }

  const B_PROMPT = "【插问B】现在是什么星期几？只回答星期几，与当前任务无关，不要改任务。";
  const b1 = await send(B_PROMPT, "B_aside");
  const b1FinalPromise = waitForRunFinal(b1.res.payload?.runId || b1.idempotencyKey, 120_000).catch(
    (e) => ({ error: String(e) }),
  );

  // Constraint amend while A busy
  await new Promise((r) => setTimeout(r, 1500));
  const C_PROMPT =
    "【补充约束】请把约束登记到任务板：最终输出必须包含标记字 E2E_CONSTRAINT_OK。先确认已收到，再生效。";
  const c1 = await send(C_PROMPT, "constraint_amend");

  // Wait for B final (should beat A)
  const b1Final = await b1FinalPromise;
  const bDoneBeforeA = !chatEvents.some(
    (e) =>
      e.runId === (a1.res.payload?.runId || a1.idempotencyKey) &&
      (e.state === "final" || e.state === "aborted"),
  );
  mark("order.check.b_first", {
    ok: Boolean(b1Final && !b1Final.error && bDoneBeforeA),
    message: `B final state=${b1Final?.state} text=${clip(b1Final?.text)} A_still_running=${bDoneBeforeA}`,
  });

  // Simulated refresh: chat.history should show B bubbles
  const hist1 = await historySnapshot("after_B_before_A_end");
  const hasBInHistory = hist1.messages.some(
    (m) =>
      (m.role === "user" && /插问B|星期/.test(m.text)) ||
      (m.role === "assistant" && /星期|周/.test(m.text)),
  );
  mark("refresh.visible.B", { ok: hasBInHistory, message: `hasB=${hasBInHistory}` });

  // Follow-up about B while A may still run / or after — ask recalling B
  const followB = await send(
    "【追问B】刚才插问里你回答的星期几是什么？只回顾插问B的答案。与任务无关，不要改任务。",
    "followup_B",
  );

  // Wait A final or timeout, then pause/cancel path on a fresh long A if needed
  let a1Final;
  try {
    a1Final = await waitForRunFinal(a1.res.payload?.runId || a1.idempotencyKey, 90_000);
  } catch (e) {
    a1Final = { error: String(e) };
  }
  mark("A_long.final", {
    ok: Boolean(a1Final && !a1Final.error),
    message: clip(a1Final?.text || a1Final?.error),
  });

  // After A ends, normal reply should be able to read B history (untrusted inject)
  const afterAAsk = await send(
    "【A结束后追问】请根据旁路历史，复述刚才插问B的星期几答案；不要编造任务A细节。与任务无关，不要改任务。",
    "post_A_recall_B",
  );
  let afterAFinal;
  try {
    afterAFinal = await waitForRunFinal(
      afterAAsk.res.payload?.runId || afterAAsk.idempotencyKey,
      90_000,
    );
  } catch (e) {
    afterAFinal = { error: String(e) };
  }
  mark("post_A_recall_B.final", {
    ok: Boolean(afterAFinal && !afterAFinal.error),
    message: clip(afterAFinal?.text || afterAFinal?.error),
  });

  // Pause/cancel: start another long A then 暂停, ensure no revive
  mark("scenario.pause.start");
  const aPause = await send(
    "【任务A-暂停测】请务必调用 exec 工具执行命令 sleep 60（不要用其他方式模拟），完成后输出 A_PAUSE_DONE。",
    "A_pause_target",
  );
  {
    const aPauseRun = aPause.res.payload?.runId || aPause.idempotencyKey;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (chatEvents.some((e) => e.runId === aPauseRun && e.state === "final")) {
        break;
      }
      if (Date.now() - aPause.startedAt > 5000) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const pauseSend = await send("暂停", "owner_pause");
  let pauseFinal;
  try {
    pauseFinal = await waitForAnyFinalAfter(pauseSend.startedAt, 60_000, (e) =>
      /暂停|停止|取消|已停/.test(e.text || ""),
    );
  } catch {
    // fallback: any final on pause run id
    try {
      pauseFinal = await waitForRunFinal(
        pauseSend.res.payload?.runId || pauseSend.idempotencyKey,
        30_000,
      );
    } catch (e) {
      pauseFinal = { error: String(e) };
    }
  }
  mark("owner_pause.result", {
    ok: Boolean(pauseFinal && !pauseFinal.error),
    message: clip(pauseFinal?.text || pauseFinal?.error),
  });

  // Wait a bit; ensure A_pause_target does not later finalize with A_PAUSE_DONE (no revive)
  await new Promise((r) => setTimeout(r, 8000));
  const aPauseRun = aPause.res.payload?.runId || aPause.idempotencyKey;
  const lateRevive = chatEvents.filter(
    (e) => e.runId === aPauseRun && e.state === "final" && /A_PAUSE_DONE/.test(e.text || ""),
  );
  const aPauseAbortedOrStopped = chatEvents.some(
    (e) =>
      e.runId === aPauseRun &&
      (e.state === "aborted" ||
        (e.state === "final" && /暂停|停止|取消|中断|abort/i.test(e.text || ""))),
  );
  mark("no_revive_A", {
    ok: lateRevive.length === 0,
    message: `lateRevive=${lateRevive.length} abortedOrStopped=${aPauseAbortedOrStopped}`,
  });

  results.scenarios.b_first = {
    bFinalBeforeA: bDoneBeforeA,
    bFinal: b1Final,
    refreshHasB: hasBInHistory,
    constraintAckRun: c1.res.payload?.runId || c1.idempotencyKey,
    aFinal: a1Final,
    postARecall: afterAFinal,
    pause: pauseFinal,
    noRevive: lateRevive.length === 0,
    followBRun: followB.res.payload?.runId || followB.idempotencyKey,
  };

  // -------- Scenario A-first: short A + slow B --------
  mark("scenario.a_first.start");
  const SESSION2 = `${SESSION_KEY}-a-first`;
  // switch session by sending with different key — recreate helper locally
  async function send2(message, label) {
    const idempotencyKey = randomUUID();
    const startedAt = Date.now();
    mark("chat.send", {
      label,
      sessionKey: SESSION2,
      message: clip(message, 120),
      runId: idempotencyKey,
    });
    const res = await request(
      "chat.send",
      { sessionKey: SESSION2, message, deliver: false, idempotencyKey },
      60_000,
    );
    mark("chat.send.ack", {
      label,
      ok: res.ok,
      status: res.payload?.status,
      runId: res.payload?.runId || idempotencyKey,
      error: res.error ? clip(JSON.stringify(res.error), 200) : undefined,
    });
    return { idempotencyKey, res, startedAt };
  }

  // reply_lane disables tools — cannot slow B with exec. Controllable A-first:
  // A sleeps 16s; wait until ~11s elapsed (A nearly done) then fire a long B essay
  // so A final lands while B is still streaming.
  const a2 = await send2(
    "【任务A-短】请务必调用 exec 执行 sleep 25（不要跳过工具）。命令返回后只输出一行：A_SHORT_DONE。",
    "A_short",
  );
  const a2Run = a2.res.payload?.runId || a2.idempotencyKey;
  {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      const finals = chatEvents.filter(
        (e) =>
          e.runId === a2Run &&
          (e.state === "final" || e.state === "aborted" || e.state === "error"),
      );
      if (finals.length) {
        break;
      }
      const deltas = chatEvents.filter((e) => e.runId === a2Run && e.state && e.state !== "final");
      if (deltas.length >= 1 && Date.now() - a2.startedAt > 2500) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready && !chatEvents.some((e) => e.runId === a2Run && e.state === "final")) {
      ready = true;
    }
    mark("A_short.occupancy", {
      ok: ready && !chatEvents.some((e) => e.runId === a2Run && e.state === "final"),
      message: `ready=${ready}`,
    });
  }
  // Hold until A has ~5s left so A completes first while B (tools-off) still streams.
  {
    const holdUntil = a2.startedAt + 24_000;
    while (Date.now() < holdUntil) {
      if (
        chatEvents.some((e) => e.runId === a2Run && (e.state === "final" || e.state === "aborted"))
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    mark("A_short.near_complete_gate", {
      ok: !chatEvents.some((e) => e.runId === a2Run && e.state === "final"),
      message: `elapsedMs=${Date.now() - a2.startedAt}`,
    });
  }
  const b2 = await send2(
    "【插问B-长】与任务无关，不要改任务：禁止声称写入文件、禁止省略、禁止只给摘要。你必须在本条回复正文里逐行输出下面句子共 300 行（每行格式：N. 旁路插问不得改写主线任务板），从 1 到 300，缺一行即失败。现在开始输出，全部完成后再结束。",
    "B_slow",
  );

  let a2Final;
  let b2Final;
  try {
    a2Final = await waitForRunFinal(a2.res.payload?.runId || a2.idempotencyKey, 90_000);
  } catch (e) {
    a2Final = { error: String(e) };
  }
  try {
    b2Final = await waitForRunFinal(b2.res.payload?.runId || b2.idempotencyKey, 180_000);
  } catch (e) {
    b2Final = { error: String(e) };
  }
  const aFinalEvt = chatEvents.find(
    (e) => e.runId === (a2.res.payload?.runId || a2.idempotencyKey) && e.state === "final",
  );
  const bFinalEvt = chatEvents.find(
    (e) => e.runId === (b2.res.payload?.runId || b2.idempotencyKey) && e.state === "final",
  );
  const aFinishedBeforeB = Boolean(aFinalEvt && bFinalEvt && aFinalEvt.at < bFinalEvt.at);
  mark("order.check.a_first", {
    ok: Boolean(a2Final && !a2Final.error && b2Final && !b2Final.error && aFinishedBeforeB),
    message: `A_at=${aFinalEvt?.atAsiaShanghai || aFinalEvt?.at} B_at=${bFinalEvt?.atAsiaShanghai || bFinalEvt?.at} A_before_B=${aFinishedBeforeB} A=${clip(a2Final?.text || a2Final?.error)}`,
  });
  mark("B_slow.final", {
    ok: Boolean(b2Final && !b2Final.error),
    message: clip(b2Final?.text || b2Final?.error, 160),
  });

  // Cancel on session2 residual if any
  const cancelSend = await send2("取消当前", "owner_cancel");
  let cancelFinal;
  try {
    cancelFinal = await waitForRunFinal(
      cancelSend.res.payload?.runId || cancelSend.idempotencyKey,
      60_000,
    );
  } catch (e) {
    cancelFinal = { error: String(e) };
  }
  mark("owner_cancel.result", {
    ok: Boolean(cancelFinal && !cancelFinal.error),
    message: clip(cancelFinal?.text || cancelFinal?.error),
  });

  const hist2 = await request("chat.history", { sessionKey: SESSION2, limit: 80 }, 30_000);
  const hist2msgs = Array.isArray(hist2.payload?.messages) ? hist2.payload.messages : [];
  mark("chat.history", {
    label: "a_first_session",
    ok: hist2.ok,
    count: hist2msgs.length,
    message: hist2msgs
      .slice(-6)
      .map((m) => `${m.role}:${clip(messageText(m), 80)}`)
      .join(" | "),
  });

  results.scenarios.a_first = {
    aFinal: a2Final,
    aFinishedBeforeB,
    bFinal: b2Final,
    cancel: cancelFinal,
  };

  // Verdicts
  const verdict = {
    b_first_order: Boolean(results.scenarios.b_first.bFinalBeforeA),
    refresh_B_visible: Boolean(results.scenarios.b_first.refreshHasB),
    no_revive_after_pause: Boolean(results.scenarios.b_first.noRevive),
    a_first_order: Boolean(results.scenarios.a_first.aFinishedBeforeB),
    pause_ack: Boolean(results.scenarios.b_first.pause && !results.scenarios.b_first.pause.error),
    cancel_ack: Boolean(
      results.scenarios.a_first.cancel && !results.scenarios.a_first.cancel.error,
    ),
  };
  const pass = Object.values(verdict).every(Boolean);
  mark("verdict", { ok: pass, message: JSON.stringify(verdict) });

  const report = {
    recordedAtAsiaShanghai:
      new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
      "+08:00",
    gatewayPort: PORT,
    stateDir: STATE,
    sessionKeys: { b_first: SESSION_KEY, a_first: SESSION2 },
    uiBuildCommitHint: "see http://127.0.0.1:19101 data-openbot-build-commit",
    timeline,
    chatEvents: chatEvents.map((e) => ({
      ...e,
      atAsiaShanghai:
        new Date(e.at).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
        "+08:00",
    })),
    results,
    verdict,
    pass,
    noteZh: [
      "历史正文预算 ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS=4000（非整个提示块硬上限）",
      "隔离端口 19101；未改生产 18789；未合并未部署",
    ],
  };

  const outPath = path.join(OUT_DIR, "slice2-e2e-real-model-acceptance.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  mark("wrote", { message: outPath, ok: pass });
  close();
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  const outPath = path.join(OUT_DIR, "slice2-e2e-real-model-acceptance.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        pass: false,
        error: String(err?.stack || err),
        timeline,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
