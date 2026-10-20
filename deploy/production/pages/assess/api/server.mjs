#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
/**
 * File-backed leads API for the public 数智化自评器.
 * Bind loopback only. Auth is enforced at nginx except POST /leads.
 */
import { createServer } from "node:http";
import { dirname } from "node:path";

const HOST = process.env.ASSESS_HOST || "127.0.0.1";
const PORT = Number(process.env.ASSESS_PORT || 18793);
const DATA = process.env.ASSESS_DATA || "/var/lib/openbot-assess/leads.jsonl";

const STATUSES = ["new", "contacted", "diagnosed", "archived"];
const INDUSTRIES = ["食品", "美妆", "母婴", "家居", "服饰", "其他"];
const SCALES = ["年营收 < 5000万", "5000万–1亿", "1亿–5亿", "5亿–20亿", "> 20亿"];
const ROLES = ["企业主/CEO", "财务负责人", "供应链负责人", "HR 负责人", "其他"];
const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 20;

/** @typedef {{ ts: number, n: number }} RateBucket */

/** @type {Map<string, RateBucket>} */
const rate = new Map();
/** @type {any[]} */
let leads = [];
let persistChain = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function clip(value, max) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, max);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeScores(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const overall100 =
    typeof raw.overall100 === "number" && Number.isFinite(raw.overall100)
      ? Math.max(0, Math.min(100, Math.round(raw.overall100)))
      : null;
  return {
    overall:
      typeof raw.overall === "number" && Number.isFinite(raw.overall)
        ? Math.max(0, Math.min(5, Number(raw.overall.toFixed(2))))
        : null,
    overall100,
    level: clip(String(raw.level || ""), 32) || null,
    moduleScores:
      raw.moduleScores && typeof raw.moduleScores === "object" ? raw.moduleScores : null,
    expected: raw.expected && typeof raw.expected === "object" ? raw.expected : null,
    answers: raw.answers && typeof raw.answers === "object" ? raw.answers : null,
  };
}

function publicLead(input, source) {
  const company = clip(input.company, 120);
  if (!company) {
    return { error: "请填写企业名称" };
  }
  const ts = nowIso();
  return {
    lead: {
      id: `ld_${randomUUID()}`,
      source,
      status: "new",
      name: clip(input.name, 80),
      company,
      phone: clip(input.phone, 40),
      industry: pickEnum(input.industry, INDUSTRIES, "其他"),
      scale: pickEnum(input.scale, SCALES, SCALES[0]),
      role: pickEnum(input.role, ROLES, "其他"),
      notes: clip(input.notes, 2000),
      scores: sanitizeScores(input.scores),
      createdAt: ts,
      updatedAt: ts,
    },
  };
}

function allowPost(ip) {
  const key = ip || "unknown";
  const bucket = rate.get(key);
  const now = Date.now();
  if (!bucket || now - bucket.ts > RATE_WINDOW_MS) {
    rate.set(key, { ts: now, n: 1 });
    return true;
  }
  if (bucket.n >= RATE_MAX) {
    return false;
  }
  bucket.n += 1;
  return true;
}

async function loadLeads() {
  try {
    const raw = await readFile(DATA, "utf8");
    leads = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      leads = [];
      return;
    }
    throw err;
  }
}

function persist() {
  persistChain = persistChain.then(async () => {
    await mkdir(dirname(DATA), { recursive: true });
    const tmp = `${DATA}.${process.pid}.tmp`;
    const body = leads.map((row) => JSON.stringify(row)).join("\n") + (leads.length ? "\n" : "");
    await writeFile(tmp, body, "utf8");
    await rename(tmp, DATA);
  });
  return persistChain;
}

function send(res, status, body, extra = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const err = new Error("payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function clientIp(req) {
  const forwarded = String(req.headers["x-real-ip"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket.remoteAddress || "";
}

function findLead(id) {
  return leads.find((row) => row.id === id) || null;
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && path === "/healthz") {
    send(res, 200, { ok: true, count: leads.length });
    return;
  }
  if (req.method === "GET" && path === "/leads") {
    const q = clip(url.searchParams.get("q") || "", 80).toLowerCase();
    const status = url.searchParams.get("status") || "";
    const rows = leads
      .filter((row) => (STATUSES.includes(status) ? row.status === status : true))
      .filter((row) => {
        if (!q) {
          return true;
        }
        return `${row.company} ${row.name} ${row.phone} ${row.industry}`.toLowerCase().includes(q);
      })
      .toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    send(res, 200, { leads: rows, total: leads.length });
    return;
  }
  if (req.method === "POST" && (path === "/leads" || path === "/manual")) {
    if (path === "/leads" && !allowPost(clientIp(req))) {
      send(res, 429, { error: "提交过于频繁，请稍后再试" });
      return;
    }
    const body = await readBody(req);
    const source = path === "/manual" ? "manual" : "self-assess";
    const built = publicLead(body, source);
    if (built.error) {
      send(res, 400, { error: built.error });
      return;
    }
    if (path === "/manual" && STATUSES.includes(body.status)) {
      built.lead.status = body.status;
    }
    leads.push(built.lead);
    await persist();
    send(res, 201, { ok: true, lead: built.lead });
    return;
  }
  const patch = path.match(/^\/leads\/([^/]+)$/);
  if (req.method === "GET" && patch) {
    const lead = findLead(decodeURIComponent(patch[1]));
    if (!lead) {
      send(res, 404, { error: "未找到该企业" });
      return;
    }
    send(res, 200, { lead });
    return;
  }
  if (req.method === "PATCH" && patch) {
    const lead = findLead(decodeURIComponent(patch[1]));
    if (!lead) {
      send(res, 404, { error: "未找到该企业" });
      return;
    }
    const body = await readBody(req);
    if (body.status !== undefined) {
      lead.status = pickEnum(body.status, STATUSES, lead.status);
    }
    if (body.notes !== undefined) {
      lead.notes = clip(body.notes, 2000);
    }
    if (body.name !== undefined) {
      lead.name = clip(body.name, 80);
    }
    if (body.phone !== undefined) {
      lead.phone = clip(body.phone, 40);
    }
    if (body.industry !== undefined) {
      lead.industry = pickEnum(body.industry, INDUSTRIES, lead.industry);
    }
    if (body.scale !== undefined) {
      lead.scale = pickEnum(body.scale, SCALES, lead.scale);
    }
    if (body.role !== undefined) {
      lead.role = pickEnum(body.role, ROLES, lead.role);
    }
    if (body.company !== undefined) {
      const company = clip(body.company, 120);
      if (!company) {
        send(res, 400, { error: "请填写企业名称" });
        return;
      }
      lead.company = company;
    }
    lead.updatedAt = nowIso();
    await persist();
    send(res, 200, { ok: true, lead });
    return;
  }
  send(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    send(res, status, {
      error: status === 413 ? "内容过大" : status === 400 ? "请求格式无效" : "服务暂时不可用",
    });
  });
});

await mkdir(dirname(DATA), { recursive: true });
await loadLeads();
server.listen(PORT, HOST, () => {
  process.stdout.write(
    `assess-api listening on ${HOST}:${PORT} data=${DATA} count=${leads.length}\n`,
  );
});
