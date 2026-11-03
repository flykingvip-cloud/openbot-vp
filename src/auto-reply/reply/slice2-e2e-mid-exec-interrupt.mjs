#!/usr/bin/env node
/**
 * Slice2 mid-execution interrupt evidence (pause + cancel while A tool still running).
 * Isolated :19101. No merge/deploy. No feature expansion.
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
const OUT_DIR = process.env.OPENBOT_E2E_OUT || "/tmp/openbot-pr216-e2e-out/final";
const TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN ||
  process.env.OPENBOT_GATEWAY_TOKEN ||
  fs.readFileSync(path.join(STATE, ".gateway-token"), "utf8").trim();
const SLEEP_SEC = Number(process.env.OPENBOT_E2E_SLEEP_SEC || 70);
const POST_WAIT_MS = Number(process.env.OPENBOT_E2E_POST_WAIT_MS || (SLEEP_SEC + 15) * 1000);

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
    detail.message ? `:: ${String(detail.message).slice(0, 160)}` : "",
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
    return (
      (typeof p.message.text === "string" && p.message.text) ||
      flattenContent(p.message.content) ||
      flattenContent(p.message) ||
      ""
    );
  }
  if (typeof p.text === "string") {
    return p.text;
  }
  if (p.content != null) {
    return flattenContent(p.content);
  }
  return "";
}

async function main() {
  const url = `ws://127.0.0.1:${PORT}`;
  const chatEvents = [];
  const agentEvents = [];
  const { request, waitOpen, close } = createGatewayWsClient({
    url,
    openTimeoutMs: 15000,
    headers: { Origin: `http://127.0.0.1:${PORT}` },
    onEvent: (evt) => {
      if (evt.event === "chat") {
        const p = evt.payload || {};
        chatEvents.push({
          at: Date.now(),
          atAsiaShanghai:
            new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
            "+08:00",
          runId: p.runId,
          sessionKey: p.sessionKey,
          state: p.state,
          text: clip(extractText(p), 400),
        });
        if (p.state === "final" || p.state === "aborted" || p.state === "error") {
          mark(`chat.${p.state}`, { runId: p.runId, message: clip(extractText(p), 160) });
        }
      }
      if (evt.event === "agent") {
        const p = evt.payload || {};
        const data = p.data && typeof p.data === "object" ? p.data : {};
        agentEvents.push({
          at: Date.now(),
          atAsiaShanghai:
            new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
            "+08:00",
          runId: p.runId || data.runId,
          stream: p.stream,
          phase: data.phase,
          name: data.name || data.toolName || data.tool || p.name,
          rawKeys: Object.keys(p),
          dataKeys: Object.keys(data),
        });
      }
    },
  });

  await waitOpen();
  mark("ws.open", { url });

  const connectRes = await request("connect", {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "openclaw-control-ui",
      displayName: "slice2-mid-exec",
      version: "2026.7.12-rc.2",
      platform: "Mac",
      mode: "webchat",
      instanceId: `slice2-mid-${randomUUID().slice(0, 8)}`,
    },
    locale: "zh-CN",
    userAgent: "slice2-e2e-mid-exec-interrupt",
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin"],
    caps: ["tool-events"],
    auth: { token: TOKEN },
  });
  if (!connectRes.ok) {
    throw new Error(`connect failed: ${JSON.stringify(connectRes.error)}`);
  }
  mark("connect.ok", { caps: ["tool-events"] });

  async function send(sessionKey, message, label) {
    const idempotencyKey = randomUUID();
    const startedAt = Date.now();
    mark("chat.send", { label, sessionKey, message: clip(message, 140), runId: idempotencyKey });
    const res = await request(
      "chat.send",
      { sessionKey, message, deliver: false, idempotencyKey },
      60_000,
    );
    mark("chat.send.ack", {
      label,
      ok: res.ok,
      status: res.payload?.status,
      runId: res.payload?.runId || idempotencyKey,
      error: res.error ? clip(JSON.stringify(res.error), 200) : undefined,
    });
    return { idempotencyKey, res, startedAt, runId: res.payload?.runId || idempotencyKey };
  }

  function runTerminal(runId) {
    return chatEvents.find(
      (e) =>
        e.runId === runId && (e.state === "final" || e.state === "aborted" || e.state === "error"),
    );
  }

  function waitToolStart(runId, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const hits = agentEvents.filter((e) => {
          if (e.runId && e.runId !== runId) {
            return false;
          }
          const phase = String(e.phase || "").toLowerCase();
          const name = String(e.name || "").toLowerCase();
          const stream = String(e.stream || "").toLowerCase();
          const isTool = stream === "tool" || name.includes("exec") || name.includes("bash");
          return (
            isTool && (phase === "start" || phase === "running" || phase === "update" || !phase)
          );
        });
        // Prefer explicit start; else any tool event while run not terminal after min occupancy.
        const startHit = hits.find((e) => String(e.phase || "").toLowerCase() === "start");
        if (startHit) {
          return resolve(startHit);
        }
        if (hits.length && Date.now() - start > 3000) {
          return resolve(hits[0]);
        }
        if (Date.now() - start > timeoutMs) {
          return reject(
            new Error(`timeout waiting tool-start for ${runId}; agentEvents=${agentEvents.length}`),
          );
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function waitForAck(pred, timeoutMs, label) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const hit = chatEvents.find(
          (e) => e.at >= start - 1000 && (e.state === "final" || e.state === "aborted") && pred(e),
        );
        if (hit) {
          return resolve(hit);
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timeout ${label}`));
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  async function runInterruptScenario(kind) {
    const sessionKey = `agent:main:slice2-mid-${kind}-${Date.now()}`;
    const doneToken = kind === "pause" ? "A_MID_PAUSE_DONE" : "A_MID_CANCEL_DONE";
    const title = kind === "pause" ? "任务A-活动暂停测" : "任务A-活动取消测";
    mark(`scenario.${kind}.start`, { sessionKey, sleepSec: SLEEP_SEC });

    const aPrompt =
      `【${title}】请务必调用 exec 工具执行命令：sleep ${SLEEP_SEC}` +
      `（不要跳过工具、不要口头假装已睡、不要提前输出完成标记）。` +
      `命令返回后再只输出一行：${doneToken}。`;
    const a = await send(sessionKey, aPrompt, `A_${kind}`);
    const aRun = a.runId;

    let toolStart;
    try {
      toolStart = await waitToolStart(aRun, 45_000);
    } catch (e) {
      // Fallback occupancy: thinking/delta without final for >=4s
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (runTerminal(aRun)) {
          break;
        }
        const busy = chatEvents.some(
          (e) => e.runId === aRun && (e.state === "thinking" || e.state === "delta"),
        );
        if (busy && Date.now() - a.startedAt > 5000) {
          toolStart = { fallback: true, at: Date.now() };
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!toolStart) {
        throw e;
      }
    }

    const beforeTerminal = runTerminal(aRun);
    const occupancyOk = !beforeTerminal && Boolean(toolStart);
    mark(`${kind}.occupancy_active`, {
      ok: occupancyOk,
      message: `toolStart=${clip(JSON.stringify(toolStart), 180)} aFinalBeforeInterrupt=${Boolean(beforeTerminal)} elapsedMs=${Date.now() - a.startedAt}`,
    });
    if (!occupancyOk) {
      return { kind, pass: false, reason: "A not actively executing at interrupt time" };
    }

    // Interrupt while still no terminal on A
    const interruptText = kind === "pause" ? "暂停" : "取消当前";
    const interruptAt = Date.now();
    const stillActiveBeforeSend = !runTerminal(aRun);
    mark(`${kind}.interrupt.send`, {
      ok: stillActiveBeforeSend,
      message: `A_still_no_terminal=${stillActiveBeforeSend} text=${interruptText}`,
    });
    const interrupt = await send(sessionKey, interruptText, `owner_${kind}`);

    let ack;
    try {
      ack = await waitForAck(
        (e) =>
          e.runId === interrupt.runId ||
          /暂停|取消|停止|中断|已停|移出任务板|不会因旧唤醒复活/.test(e.text || ""),
        60_000,
        `${kind}_ack`,
      );
    } catch (e) {
      ack = { error: String(e) };
    }
    const aStillActiveAtAckMoment = !chatEvents.some(
      (e) => e.runId === aRun && e.state === "final" && e.at < (ack.at || Date.now()),
    );
    mark(`owner_${kind}.result`, {
      ok: Boolean(ack && !ack.error),
      message: clip(ack?.text || ack?.error),
      aHadNoFinalBeforeAck: aStillActiveAtAckMoment,
    });

    // Watch window longer than remaining sleep — prove no late DONE / no revive
    mark(`${kind}.watch_start`, { message: `postWaitMs=${POST_WAIT_MS}` });
    await new Promise((r) => setTimeout(r, POST_WAIT_MS));

    const lateDone = chatEvents.filter(
      (e) => e.runId === aRun && e.state === "final" && new RegExp(doneToken).test(e.text || ""),
    );
    const aAborted = chatEvents.some((e) => e.runId === aRun && e.state === "aborted");
    const lateBusinessFinal = chatEvents.filter(
      (e) =>
        e.runId === aRun &&
        e.state === "final" &&
        e.at > interruptAt &&
        !/暂停|取消|停止|中断/.test(e.text || ""),
    );
    const noLateAnswer = lateDone.length === 0 && lateBusinessFinal.length === 0;
    mark(`${kind}.no_revive`, {
      ok: noLateAnswer,
      message: `lateDone=${lateDone.length} lateBusinessFinal=${lateBusinessFinal.length} aAborted=${aAborted}`,
    });

    // Title should mention mid-exec task when possible
    const ackNamesMidTask =
      /活动暂停测|活动取消测|MID_/.test(ack?.text || "") || /任务A/.test(ack?.text || "");
    mark(`${kind}.ack_targets_active_task`, {
      ok: Boolean(ack && !ack.error),
      message: clip(ack?.text || ""),
      ackNamesMidTask,
    });

    const pass = occupancyOk && stillActiveBeforeSend && Boolean(ack && !ack.error) && noLateAnswer;

    return {
      kind,
      pass,
      sessionKey,
      aRun,
      interruptRun: interrupt.runId,
      toolStart,
      ack,
      lateDone: lateDone.length,
      lateBusinessFinal: lateBusinessFinal.length,
      aAborted,
      occupancyOk,
      stillActiveBeforeSend,
    };
  }

  const pauseResult = await runInterruptScenario("pause");
  const cancelResult = await runInterruptScenario("cancel");

  let tip = null;
  try {
    tip = fs.readFileSync(path.join(process.cwd(), "dist/build-info.json"), "utf8");
    tip = JSON.parse(tip);
  } catch {
    tip = null;
  }

  const verdict = {
    mid_exec_pause: Boolean(pauseResult.pass),
    mid_exec_cancel: Boolean(cancelResult.pass),
  };
  const pass = Object.values(verdict).every(Boolean);
  mark("verdict", { ok: pass, message: JSON.stringify(verdict) });

  const report = {
    recordedAtAsiaShanghai:
      new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
      "+08:00",
    gatewayPort: PORT,
    stateDir: STATE,
    sleepSec: SLEEP_SEC,
    postWaitMs: POST_WAIT_MS,
    buildInfo: tip,
    timeline,
    chatEvents,
    agentEvents: agentEvents.slice(0, 200),
    results: { pause: pauseResult, cancel: cancelResult },
    verdict,
    pass,
    noteZh:
      "活动执行期间暂停/取消：occupancy 成立（tool-events 或忙碌回退）后打断；观察窗大于 sleep，验证无 DONE 迟到、无后续业务 final。",
  };
  const outPath = path.join(OUT_DIR, "slice2-e2e-mid-exec-interrupt.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  mark("report.written", { message: outPath, ok: pass });
  close();
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
