/**
 * platform.diagnosis.approval.decide
 *
 * Scope is operator.approvals. operator.admin does not substitute.
 * Session kind must be platform-admin or platform-super-admin.
 * The enterprise sibling is registered separately and is not called here.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DiagnosisApprovalInvalidRequest,
  decideDiagnosisApproval,
  type DiagnosisApprovalLedger,
  type DiagnosisApprovalPorts,
  type DiagnosisApprovalResult,
  type DiagnosisApprovalRow,
} from "../../diagnosis/approval-decide.js";
import { transitionRequestedAuthorizationGrant } from "../../diagnosis/delegation.js";
import {
  createFileProjectionAuthoritySource,
  resolveDiagnosisProjectionsDir,
} from "../../diagnosis/report-query-projection-snapshot.js";
import { exportCompositeDiagnosisReportJson } from "../../diagnosis/report-validate.js";
import { CONFIG_DIR } from "../../utils.js";
import { getSharedDiagnosisDelegationMachine } from "../evolution-control/delegation-service.js";
import { ErrorCodes, errorShape, type ErrorShape } from "../protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

export const PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD = "platform.diagnosis.approval.decide";

const LEDGER_DIR = "diagnosis-approvals";

export function authorizePlatformDiagnosisApprovalCaller(
  client: GatewayClient | null,
): ErrorShape | null {
  if (!client?.connect) {
    return errorShape(ErrorCodes.UNAUTHORIZED, "unauthorized");
  }
  const domain = client.sessionDomain;
  const kind = client.sessionKind;
  if (domain === "employee" || kind === "member") {
    return errorShape(ErrorCodes.UNAUTHORIZED, "unauthorized");
  }
  if (domain === "enterprise" || kind === "enterprise-admin") {
    return errorShape(
      ErrorCodes.INVALID_REQUEST,
      `domain_mismatch: ${PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD} requires domain platform`,
    );
  }
  if (domain !== "platform" || (kind !== "platform-admin" && kind !== "platform-super-admin")) {
    return errorShape(ErrorCodes.UNAUTHORIZED, "unauthorized");
  }
  const scopes = client.connect.scopes ?? [];
  if (!scopes.includes("operator.approvals")) {
    return errorShape(ErrorCodes.UNAUTHORIZED, "missing scope: operator.approvals");
  }
  return null;
}

export function createPlatformDiagnosisApprovalHandlers(
  deps: { ports?: DiagnosisApprovalPorts } = {},
): GatewayRequestHandlers {
  let live: DiagnosisApprovalPorts | undefined;
  const portsFor = () => {
    if (deps.ports) {
      return deps.ports;
    }
    live ??= createLiveDiagnosisApprovalPorts();
    return live;
  };
  return {
    [PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD]: async ({ params, client, respond }) => {
      const authError = authorizePlatformDiagnosisApprovalCaller(client);
      if (authError) {
        respond(false, undefined, authError);
        return;
      }
      try {
        const result = await decideDiagnosisApproval(
          {
            domain: "platform",
            actor: {
              principalId: client?.platformUserId || client?.user || "platform",
              sessionKind: client?.sessionKind ?? "platform-admin",
              domain: "platform",
            },
            params,
          },
          portsFor(),
        );
        respond(true, result);
      } catch (err) {
        const invalid = err instanceof DiagnosisApprovalInvalidRequest;
        respond(
          false,
          undefined,
          errorShape(
            invalid ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE,
            invalid ? err.message : "diagnosis approval unavailable",
          ),
        );
      }
    },
  };
}

export function createLiveDiagnosisApprovalPorts(
  configDir: string = CONFIG_DIR,
): DiagnosisApprovalPorts {
  // Enterprise #638 stores one JSON file per tenant in diagnosis-approvals/.
  // Keep the platform ledger in its own directory so those files do not collide.
  const platformRoot = path.join(configDir, LEDGER_DIR, "platform");
  const ledger = createFileDiagnosisApprovalLedger(path.join(platformRoot, "ledger.json"));
  const projections = resolveDiagnosisProjectionsDir(configDir);
  const sessionsDir = path.join(platformRoot, "sessions");
  return {
    now: () => new Date().toISOString(),
    newId: () =>
      `appr_${createHash("sha256")
        .update(`${Date.now()}:${randomBytes(16).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`,
    ledger,
    grants: {
      async get(grantId) {
        const grant = getSharedDiagnosisDelegationMachine().getGrant(grantId);
        if (!grant || grant.kind !== "authorization") {
          return undefined;
        }
        return {
          grantId: grant.grantId,
          status: grant.status,
          approverRole: grant.approver.role,
          targetTenant: grant.targetTenant,
        };
      },
      async applyStatus(grantId, status) {
        const machine = getSharedDiagnosisDelegationMachine();
        const grant = machine.getGrant(grantId);
        if (!grant) {
          throw new Error("grant_missing");
        }
        const command = status === "APPROVED" ? "approve" : "deny";
        const next = transitionRequestedAuthorizationGrant(grant.status, command);
        if (next !== status) {
          throw new Error("grant_not_applied");
        }
        const trustedTenantId = grant.approver.role === "platform" ? null : grant.targetTenant;
        machine.restoreGrant({ ...grant, status: next }, { tenantId: trustedTenantId });
        const stored = machine.getGrant(grantId);
        if (stored?.status !== status) {
          throw new Error("grant_not_applied");
        }
      },
    },
    conversations: {
      async find(input) {
        return projectionHasConversation(projections, input);
      },
      async openSession(input) {
        return writeDiagnosisSession(sessionsDir, input);
      },
    },
    reports: {
      async load(reportId) {
        const raw = await createFileProjectionAuthoritySource(projections).get(reportId);
        return raw ?? null;
      },
      serialize(report, _redactionProfile) {
        const tenantId = readReportTenant(report);
        return exportCompositeDiagnosisReportJson(report, { tenantId });
      },
    },
  };
}

function readReportTenant(report: unknown): string | null {
  if (!report || typeof report !== "object") {
    return null;
  }
  const tenantId = (report as { tenantId?: unknown }).tenantId;
  return typeof tenantId === "string" ? tenantId : null;
}

function projectionHasConversation(
  rootDir: string,
  input: { signalId?: string; caseId?: string },
): boolean {
  if (!fs.existsSync(rootDir)) {
    return false;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(rootDir, entry.name);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const raw = readJson(path.join(dir, name));
      if (raw && conversationMatches(raw, input)) {
        return true;
      }
    }
  }
  return false;
}

function conversationMatches(raw: unknown, input: { signalId?: string; caseId?: string }): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const record = raw as Record<string, unknown>;
  if (input.caseId && arrayHasId(record.cases, "caseId", input.caseId)) {
    return true;
  }
  if (input.signalId && arrayHasId(record.signals, "signalId", input.signalId)) {
    return true;
  }
  if (input.signalId && arrayHasId(record.cases, "signalId", input.signalId)) {
    return true;
  }
  return false;
}

function arrayHasId(value: unknown, key: string, expected: string): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return (item as Record<string, unknown>)[key] === expected;
  });
}

function writeDiagnosisSession(
  sessionsDir: string,
  input: { signalId?: string; caseId?: string },
): string {
  const material = input.signalId ?? input.caseId;
  if (!material) {
    throw new Error("session_key_unavailable");
  }
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 24);
  const sessionKey = `agent:daibai:diagnosis:${digest}`;
  fs.mkdirSync(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, `${digest}.json`);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      schemaVersion: 1,
      sessionKey,
      signalId: input.signalId ?? null,
      caseId: input.caseId ?? null,
    })}\n`,
  );
  if (!fs.existsSync(filePath)) {
    throw new Error("session_key_unavailable");
  }
  return sessionKey;
}

type LedgerFile = {
  schemaVersion: 1;
  rows: Array<DiagnosisApprovalRow & { idempotencyKey: string; canonicalBody: string }>;
  refusals: Array<{ key: string; body: string; result: DiagnosisApprovalResult }>;
};

function createFileDiagnosisApprovalLedger(filePath: string): DiagnosisApprovalLedger {
  const inflight = new Map<string, Parameters<DiagnosisApprovalLedger["insert"]>[0]>();
  const load = (): LedgerFile => {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: 1, rows: [], refusals: [] };
    }
    const parsed = readJson(filePath);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("diagnosis approval ledger unreadable");
    }
    const record = parsed as Partial<LedgerFile>;
    return {
      schemaVersion: 1,
      rows: Array.isArray(record.rows) ? record.rows : [],
      refusals: Array.isArray(record.refusals) ? record.refusals : [],
    };
  };
  const save = (file: LedgerFile) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(file)}\n`);
    fs.renameSync(tmp, filePath);
  };
  return {
    lookup(key) {
      const file = load();
      const recorded = file.rows.find((row) => row.idempotencyKey === key);
      if (recorded) {
        return {
          body: recorded.canonicalBody,
          result: {
            approvalId: recorded.approvalId,
            subjectKind: recorded.subjectKind,
            decision: recorded.decision,
            status: "recorded",
            grantId: recorded.grantId,
            effect: recorded.effect,
          },
        };
      }
      const refused = file.refusals.find((row) => row.key === key);
      return refused ? { body: refused.body, result: refused.result } : undefined;
    },
    insert(row) {
      inflight.set(row.approvalId, row);
    },
    remove(approvalId) {
      inflight.delete(approvalId);
      const file = load();
      const rows = file.rows.filter((row) => row.approvalId !== approvalId);
      if (rows.length !== file.rows.length) {
        save({ ...file, rows });
      }
    },
    finish(row, result, idempotencyKey, body) {
      inflight.delete(row.approvalId);
      const file = load();
      const stored: LedgerFile["rows"][number] = {
        ...row,
        status: "recorded",
        grantId: result.grantId,
        effect: result.effect,
        idempotencyKey,
        canonicalBody: body,
      };
      save({
        schemaVersion: 1,
        rows: [...file.rows.filter((item) => item.approvalId !== result.approvalId), stored],
        refusals: file.refusals.filter((item) => item.key !== idempotencyKey),
      });
    },
    remember(key, body, result) {
      const file = load();
      save({
        ...file,
        refusals: [...file.refusals.filter((item) => item.key !== key), { key, body, result }],
      });
    },
    hasAny(approvalId) {
      return inflight.has(approvalId) || load().rows.some((row) => row.approvalId === approvalId);
    },
    finishedCount() {
      return load().rows.length;
    },
  };
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}
