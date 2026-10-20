/**
 * AI Workforce Governance - Database Schema
 * SQL table definitions for the governance system.
 *
 * runtime-status: **aspirational** (logical / analytics model).
 * Not the default runtime authority for agent product state.
 * Agent growth snapshots remain JSON under agentDir
 * (`src/gateway/agent-growth/*`, e.g. growth-status.json).
 * See docs/design/openbot-persistence-engine-matrix-2026-07-13.md.
 * Wire via a real ensure*Schema(db) before treating these DDL as live.
 */

// ============================================================================
// AI Assets Table
// ============================================================================

export const AI_ASSETS_TABLE = `CREATE TABLE IF NOT EXISTS ai_assets (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(16) NOT NULL CHECK (type IN ('bot', 'group')),
  name VARCHAR(256) NOT NULL,
  position_id VARCHAR(64),
  digital_worker_id VARCHAR(64),
  owner_user_id VARCHAR(64),
  runtime_id VARCHAR(64),
  template_id VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const AI_ASSETS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ai_assets_type ON ai_assets(type)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_assets_status ON ai_assets(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_assets_owner ON ai_assets(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_assets_position ON ai_assets(position_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_assets_updated ON ai_assets(updated_at DESC)`,
];

// ============================================================================
// AI Runs Table
// ============================================================================

export const AI_RUNS_TABLE = `CREATE TABLE IF NOT EXISTS ai_runs (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_ms INTEGER,
  status VARCHAR(16) NOT NULL CHECK (status IN ('success', 'failed', 'timeout', 'running')),
  error_code VARCHAR(64),
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  cost DECIMAL(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES ai_assets(id) ON DELETE CASCADE
)`;

export const AI_RUNS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ai_runs_asset ON ai_runs(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_runs_start_time ON ai_runs(start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_runs_asset_time ON ai_runs(asset_id, start_time DESC)`,
];

// ============================================================================
// AI Metrics Daily Table
// ============================================================================

export const AI_METRICS_DAILY_TABLE = `CREATE TABLE IF NOT EXISTS ai_metrics_daily (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  date DATE NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost DECIMAL(12, 6) NOT NULL DEFAULT 0,
  avg_cost_per_task DECIMAL(12, 6) NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  success_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  cost_growth_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES ai_assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, date)
)`;

export const AI_METRICS_DAILY_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ai_metrics_asset ON ai_metrics_daily(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_metrics_date ON ai_metrics_daily(date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_metrics_asset_date ON ai_metrics_daily(asset_id, date DESC)`,
];

// ============================================================================
// AI Anomalies Table
// ============================================================================

export const AI_ANOMALIES_TABLE = `CREATE TABLE IF NOT EXISTS ai_anomalies (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('no_task', 'cost_spike', 'high_failure', 'runtime_error', 'low_success_rate', 'high_latency')),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  description TEXT NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  metadata TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES ai_assets(id) ON DELETE CASCADE
)`;

export const AI_ANOMALIES_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_asset ON ai_anomalies(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_status ON ai_anomalies(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_severity ON ai_anomalies(severity)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_type ON ai_anomalies(type)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_detected ON ai_anomalies(detected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_anomalies_pending ON ai_anomalies(status, severity) WHERE status = 'pending'`,
];

// ============================================================================
// Governance Actions Table
// ============================================================================

export const GOVERNANCE_ACTIONS_TABLE = `CREATE TABLE IF NOT EXISTS governance_actions (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('pause', 'resume', 'limit', 'redirect', 'notify_admin', 'mark_risk', 'recommend_optimization')),
  trigger VARCHAR(32), -- auto_governance, manual, anomaly
  reason TEXT,
  params TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed', 'cancelled')),
  executed_by VARCHAR(64), -- null for auto-governance
  executed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES ai_assets(id) ON DELETE CASCADE
)`;

export const GOVERNANCE_ACTIONS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_gov_actions_asset ON governance_actions(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gov_actions_status ON governance_actions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_gov_actions_trigger ON governance_actions(trigger)`,
  `CREATE INDEX IF NOT EXISTS idx_gov_actions_executed ON governance_actions(executed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_gov_actions_pending ON governance_actions(status, created_at) WHERE status = 'pending'`,
];

// ============================================================================
// AI Scores Table - For Ranking System
// ============================================================================

export const AI_SCORES_TABLE = `CREATE TABLE IF NOT EXISTS ai_scores (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL CHECK (type IN ('bot', 'group', 'position')),
  score DECIMAL(5, 2) NOT NULL DEFAULT 0,
  efficiency_score DECIMAL(5, 2) NOT NULL DEFAULT 0,
  cost_score DECIMAL(5, 2) NOT NULL DEFAULT 0,
  stability_score DECIMAL(5, 2) NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  success_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  cost_per_task DECIMAL(12, 6) NOT NULL DEFAULT 0,
  fail_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
  rank INTEGER,
  date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES ai_assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, date)
)`;

export const AI_SCORES_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ai_scores_asset ON ai_scores(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_scores_type ON ai_scores(type)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_scores_date ON ai_scores(date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_scores_rank ON ai_scores(type, date, rank)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_scores_score ON ai_scores(score DESC)`,
];

// ============================================================================
// Schema Version Tracking
// ============================================================================

export const GOVERNANCE_SCHEMA_VERSION_TABLE = `CREATE TABLE IF NOT EXISTS governance_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// ============================================================================
// All Schema Statements
// ============================================================================

export const ALL_TABLES = [
  AI_ASSETS_TABLE,
  AI_RUNS_TABLE,
  AI_METRICS_DAILY_TABLE,
  AI_ANOMALIES_TABLE,
  GOVERNANCE_ACTIONS_TABLE,
  AI_SCORES_TABLE,
  GOVERNANCE_SCHEMA_VERSION_TABLE,
];

export const ALL_INDEXES = [
  ...AI_ASSETS_INDEXES,
  ...AI_RUNS_INDEXES,
  ...AI_METRICS_DAILY_INDEXES,
  ...AI_ANOMALIES_INDEXES,
  ...GOVERNANCE_ACTIONS_INDEXES,
  ...AI_SCORES_INDEXES,
];

// ============================================================================
// Utility Functions
// ============================================================================

export function generateTableSchema(): string {
  return [...ALL_TABLES, ...ALL_INDEXES].join(";\n");
}

export const CURRENT_SCHEMA_VERSION = 1;
