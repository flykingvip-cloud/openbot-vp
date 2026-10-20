// Incubation Store
//
// Persists incubation data (promotion decisions, upload reports,
// effect tracking) as JSON files under ~/.openclaw/incubation/.
// Uses atomic write (write to tmp then rename) to prevent corruption.

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

const INCUBATION_DIR = path.join(CONFIG_DIR, "incubation");
const DECISIONS_FILE = path.join(INCUBATION_DIR, "decisions.json");
const EFFECT_TRACKING_FILE = path.join(INCUBATION_DIR, "effect-tracking.json");

// --- Atomic Write ---

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// --- Safe Read ---

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

// --- Types ---

export type IncubationScoreSnapshot = {
  reuseBreath: number; // 复用广度 0-100
  effectStability: number; // 效果稳定性 0-100
  businessCoverage: number; // 业务覆盖度 0-100
  employeeSatisfaction: number | null; // 员工满意度 0-100，null 表示数据不足
  compositeScore: number; // 综合分
};

export type PromotionDecisionRecord = {
  decisionId: string;
  capabilityId: string;
  decidedAt: number;
  decidedBy: string;
  result: "recommend_upload" | "continue_incubation" | "not_suitable";
  reason: string;
  scoreSnapshot: IncubationScoreSnapshot;
};

export type EffectTrackingRecord = {
  capabilityId: string;
  promotionTimestamp: number;
  dailyCallSnapshots: { date: string; count: number }[];
  dailyDepartmentSnapshots: { date: string; count: number }[];
  dailySuccessRateSnapshots: { date: string; rate: number }[];
};

// --- Promotion Decision CRUD ---

export function listDecisions(capabilityId?: string): PromotionDecisionRecord[] {
  const all = readJsonFile<PromotionDecisionRecord[]>(DECISIONS_FILE, []);
  return capabilityId ? all.filter((d) => d.capabilityId === capabilityId) : all;
}

export function saveDecision(decision: PromotionDecisionRecord): void {
  const decisions = listDecisions();
  decisions.push(decision);
  atomicWriteJson(DECISIONS_FILE, decisions);
}

// --- Effect Tracking CRUD ---

export function getEffectTracking(capabilityId: string): EffectTrackingRecord | null {
  const all = readJsonFile<EffectTrackingRecord[]>(EFFECT_TRACKING_FILE, []);
  return all.find((r) => r.capabilityId === capabilityId) ?? null;
}

export function saveEffectTracking(record: EffectTrackingRecord): void {
  const all = readJsonFile<EffectTrackingRecord[]>(EFFECT_TRACKING_FILE, []);
  const idx = all.findIndex((r) => r.capabilityId === record.capabilityId);
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.push(record);
  }
  atomicWriteJson(EFFECT_TRACKING_FILE, all);
}
