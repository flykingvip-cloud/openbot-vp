#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
/**
 * File-backed submissions for the public enterprise-system intake form.
 * Bind loopback only. Auth is enforced at nginx except POST /submissions.
 */
import { createServer } from "node:http";
import { dirname } from "node:path";

const HOST = process.env.INTAKE_HOST || "127.0.0.1";
const PORT = Number(process.env.INTAKE_PORT || 18794);
const DATA = process.env.INTAKE_DATA || "/var/lib/openbot-intake/submissions.jsonl";

const STATUSES = ["new", "reviewing", "ready", "blocked", "archived"];
const CATEGORIES = ["marketing", "hr", "finance", "other"];
const ACCESS_MODES = ["http", "database", "sap", "salesforce", "unavailable"];
const MAX_BODY = 256 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 12;

/** @type {Map<string, { ts: number, n: number }>} */
const rate = new Map();
/** @type {any[]} */
let submissions = [];
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

function clipEndpoints(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(0, 40).map((row) => ({
    objectName: clip(row?.objectName, 120),
    path: clip(row?.path, 300),
    query: clip(row?.query, 300),
    primaryKey: clip(row?.primaryKey, 120),
    updatedAtField: clip(row?.updatedAtField, 120),
    sensitiveFields: clip(row?.sensitiveFields, 300),
  }));
}

function clipSystem(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const systemName = clip(raw.systemName, 160);
  if (!systemName) {
    return null;
  }
  return {
    category: pickEnum(raw.category, CATEGORIES, "other"),
    systemName,
    productVersion: clip(raw.productVersion, 160),
    deployment: pickEnum(raw.deployment, ["saas", "private"], "saas"),
    testBaseUrl: clip(raw.testBaseUrl, 300),
    prodBaseUrl: clip(raw.prodBaseUrl, 300),
    network: pickEnum(raw.network, ["public", "allowlist", "private-link"], "public"),
    networkContact: clip(raw.networkContact, 160),
    accessMode: pickEnum(raw.accessMode, ACCESS_MODES, "http"),
    authScheme: pickEnum(raw.authScheme, ["bearer", "basic", "header", "query", "none"], "bearer"),
    authName: clip(raw.authName, 80),
    tokenRotation: clip(raw.tokenRotation, 200),
    probePath: clip(raw.probePath, 200),
    limits: clip(raw.limits, 200),
    sampleJson: clip(raw.sampleJson, 4000),
    dbKind: pickEnum(raw.dbKind, ["postgres", "mysql"], "postgres"),
    dbHost: clip(raw.dbHost, 200),
    dbPort: clip(raw.dbPort, 16),
    dbName: clip(raw.dbName, 120),
    dbUser: clip(raw.dbUser, 120),
    dbObjects: clip(raw.dbObjects, 4000),
    sapGateway: clip(raw.sapGateway, 300),
    sapAuth: pickEnum(raw.sapAuth, ["basic", "bearer"], "basic"),
    sapOrderService: pickEnum(raw.sapOrderService, ["yes", "no", "unknown"], "unknown"),
    sfInstance: clip(raw.sfInstance, 300),
    sfTokenDelivery: clip(raw.sfTokenDelivery, 300),
    unavailableNote: clip(raw.unavailableNote, 2000),
    egress: pickEnum(raw.egress, ["yes", "restricted", "no"], "restricted"),
    credentialOwner: clip(raw.credentialOwner, 160),
    incidentOwner: clip(raw.incidentOwner, 160),
    changeNotice: clip(raw.changeNotice, 200),
    endpoints: clipEndpoints(raw.endpoints),
  };
}

function publicSubmission(input) {
  const enterpriseName = clip(input.enterpriseName, 160);
  if (!enterpriseName) {
    return { error: "请填写企业名称" };
  }
  const enterpriseContact = clip(input.enterpriseContact, 80);
  const enterprisePhone = clip(input.enterprisePhone, 40);
  const enterpriseEmail = clip(input.enterpriseEmail, 120);
  if (!enterpriseContact || !enterprisePhone || !enterpriseEmail) {
    return { error: "请填写信息化联系人、电话和邮箱" };
  }
  const systems = (Array.isArray(input.systems) ? input.systems : [])
    .slice(0, 12)
    .map(clipSystem)
    .filter(Boolean);
  if (systems.length === 0) {
    return { error: "请至少填写一个系统名称" };
  }
  const ts = nowIso();
  return {
    submission: {
      id: `in_${randomUUID()}`,
      status: "new",
      enterpriseName,
      enterpriseCode: clip(input.enterpriseCode, 40),
      enterpriseContact,
      enterpriseTitle: clip(input.enterpriseTitle, 80),
      enterprisePhone,
      enterpriseEmail,
      submitterRole: pickEnum(input.submitterRole, ["enterprise", "vendor"], "enterprise"),
      vendorName: clip(input.vendorName, 160),
      vendorContact: clip(input.vendorContact, 80),
      vendorPhone: clip(input.vendorPhone, 40),
      vendorEmail: clip(input.vendorEmail, 120),
      signName: clip(input.signName, 80),
      signDate: clip(input.signDate, 20),
      systems,
      notes: "",
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

async function loadSubmissions() {
  try {
    const raw = await readFile(DATA, "utf8");
    submissions = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      submissions = [];
      return;
    }
    throw err;
  }
}

function persist() {
  persistChain = persistChain.then(async () => {
    await mkdir(dirname(DATA), { recursive: true });
    const tmp = `${DATA}.${process.pid}.tmp`;
    const body =
      submissions.map((row) => JSON.stringify(row)).join("\n") + (submissions.length ? "\n" : "");
    await writeFile(tmp, body, "utf8");
    await rename(tmp, DATA);
  });
  return persistChain;
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
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

function findSubmission(id) {
  return submissions.find((row) => row.id === id) || null;
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && path === "/healthz") {
    send(res, 200, { ok: true, count: submissions.length });
    return;
  }
  if (req.method === "GET" && path === "/submissions") {
    const q = clip(url.searchParams.get("q") || "", 80).toLowerCase();
    const status = url.searchParams.get("status") || "";
    const rows = submissions
      .filter((row) => (STATUSES.includes(status) ? row.status === status : true))
      .filter((row) => {
        if (!q) {
          return true;
        }
        const systems = (row.systems || []).map((system) => system.systemName).join(" ");
        return `${row.enterpriseName} ${row.enterpriseContact} ${row.enterprisePhone} ${systems}`
          .toLowerCase()
          .includes(q);
      })
      .toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    send(res, 200, { submissions: rows, total: submissions.length });
    return;
  }
  if (req.method === "POST" && path === "/submissions") {
    if (!allowPost(clientIp(req))) {
      send(res, 429, { error: "提交过于频繁，请稍后再试" });
      return;
    }
    const body = await readBody(req);
    const built = publicSubmission(body);
    if (built.error) {
      send(res, 400, { error: built.error });
      return;
    }
    submissions.push(built.submission);
    await persist();
    send(res, 201, { ok: true, id: built.submission.id });
    return;
  }
  const patch = path.match(/^\/submissions\/([^/]+)$/);
  if (req.method === "GET" && patch) {
    const submission = findSubmission(decodeURIComponent(patch[1]));
    if (!submission) {
      send(res, 404, { error: "未找到该提报" });
      return;
    }
    send(res, 200, { submission });
    return;
  }
  if (req.method === "PATCH" && patch) {
    const submission = findSubmission(decodeURIComponent(patch[1]));
    if (!submission) {
      send(res, 404, { error: "未找到该提报" });
      return;
    }
    const body = await readBody(req);
    if (body.status !== undefined) {
      submission.status = pickEnum(body.status, STATUSES, submission.status);
    }
    if (body.notes !== undefined) {
      submission.notes = clip(body.notes, 4000);
    }
    submission.updatedAt = nowIso();
    await persist();
    send(res, 200, { ok: true, submission });
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
await loadSubmissions();
server.listen(PORT, HOST, () => {
  process.stdout.write(
    `intake-api listening on ${HOST}:${PORT} data=${DATA} count=${submissions.length}\n`,
  );
});
