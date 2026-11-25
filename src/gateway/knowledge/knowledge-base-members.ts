import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { isRecord } from "../records.js";

export type KnowledgeBaseMemberRole = "viewer" | "editor" | "admin";

export type KnowledgeBaseMemberStatus = "pending" | "active";

export type KnowledgeBaseMemberRecord = {
  memberId: string;
  /** Verified internal subject, absent for legacy email-only invitations. */
  userId?: string;
  knowledgeBaseId: string;
  email: string;
  role: KnowledgeBaseMemberRole;
  status: KnowledgeBaseMemberStatus;
  invitedByUserId: string;
  createdAtMs: number;
};

export class KnowledgeBaseMembersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeBaseMembersError";
  }
}

type KnowledgeBaseMembersStore = { members: KnowledgeBaseMemberRecord[] };

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "base-members.json");

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeRole(value: unknown): KnowledgeBaseMemberRole {
  return value === "admin" || value === "editor" ? value : "viewer";
}

function normalizeStatus(value: unknown): KnowledgeBaseMemberStatus {
  return value === "active" ? "active" : "pending";
}

function sanitizeMember(value: unknown): KnowledgeBaseMemberRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const memberId = stringValue(value.memberId);
  const knowledgeBaseId = stringValue(value.knowledgeBaseId);
  const email = stringValue(value.email).toLowerCase();
  const invitedByUserId = stringValue(value.invitedByUserId);
  if (!memberId || !knowledgeBaseId || !email || !invitedByUserId) {
    return null;
  }
  return {
    memberId,
    ...(stringValue(value.userId) ? { userId: stringValue(value.userId) } : {}),
    knowledgeBaseId,
    email,
    role: normalizeRole(value.role),
    status: normalizeStatus(value.status),
    invitedByUserId,
    createdAtMs:
      typeof value.createdAtMs === "number" && Number.isFinite(value.createdAtMs)
        ? value.createdAtMs
        : Date.now(),
  };
}

function readStore(storePath: string): KnowledgeBaseMembersStore {
  try {
    if (!fs.existsSync(storePath)) {
      return { members: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record = isRecord(parsed) ? parsed : {};
    const members = Array.isArray(record.members)
      ? record.members
          .map(sanitizeMember)
          .filter((entry): entry is KnowledgeBaseMemberRecord => entry !== null)
      : [];
    return { members };
  } catch {
    return { members: [] };
  }
}

function writeStore(store: KnowledgeBaseMembersStore, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function listKnowledgeBaseMembers(
  knowledgeBaseId: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBaseMemberRecord[] {
  const store = readStore(storePath);
  return store.members
    .filter((member) => member.knowledgeBaseId === knowledgeBaseId)
    .toSorted((left, right) => right.createdAtMs - left.createdAtMs);
}

export function inviteKnowledgeBaseMember(
  params: {
    knowledgeBaseId: string;
    email: string;
    role?: KnowledgeBaseMemberRole;
    status?: KnowledgeBaseMemberStatus;
    invitedByUserId: string;
  },
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBaseMemberRecord {
  const email = params.email.trim().toLowerCase();
  if (!email) {
    throw new KnowledgeBaseMembersError("email required");
  }
  if (!isValidEmail(email)) {
    throw new KnowledgeBaseMembersError("invalid email");
  }
  const store = readStore(storePath);
  const existing = store.members.find(
    (member) =>
      member.knowledgeBaseId === params.knowledgeBaseId &&
      member.email === email &&
      member.status === "pending",
  );
  if (existing) {
    return existing;
  }
  const record: KnowledgeBaseMemberRecord = {
    memberId: randomUUID(),
    knowledgeBaseId: params.knowledgeBaseId,
    email,
    role: params.role ?? "viewer",
    status: params.status ?? "pending",
    invitedByUserId: params.invitedByUserId,
    createdAtMs: Date.now(),
  };
  store.members.push(record);
  writeStore(store, storePath);
  return record;
}

export function updateKnowledgeBaseMemberStatus(
  params: {
    knowledgeBaseId: string;
    email: string;
    status: KnowledgeBaseMemberStatus;
  },
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBaseMemberRecord {
  const email = params.email.trim().toLowerCase();
  const store = readStore(storePath);
  const member = store.members.find(
    (entry) => entry.knowledgeBaseId === params.knowledgeBaseId && entry.email === email,
  );
  if (!member) {
    throw new KnowledgeBaseMembersError("member not found");
  }
  member.status = params.status;
  writeStore(store, storePath);
  return member;
}
