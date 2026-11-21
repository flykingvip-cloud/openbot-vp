-- Tenant-scoped execution ownership and terminal arbitration.
CREATE TABLE IF NOT EXISTS runtime_executions (
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('ready','running','waiting','completed','cancelled','failed')),
  version bigint NOT NULL DEFAULT 0,
  fence bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, execution_id)
);
CREATE TABLE IF NOT EXISTS runtime_execution_outbox (
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  execution_id text NOT NULL,
  payload jsonb NOT NULL,
  delivered_at timestamptz,
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES runtime_executions
);
ALTER TABLE runtime_execution_outbox ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE runtime_execution_outbox ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
ALTER TABLE runtime_execution_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE runtime_execution_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE runtime_execution_outbox ADD COLUMN IF NOT EXISTS last_error text;
CREATE INDEX IF NOT EXISTS runtime_outbox_due ON runtime_execution_outbox (next_attempt_at)
  WHERE delivered_at IS NULL;
-- Projection receipts are immutable; effect and receipt must share one transaction.
CREATE TABLE IF NOT EXISTS runtime_projection_receipts (
  tenant_id text NOT NULL,
  consumer text NOT NULL,
  event_id text NOT NULL,
  execution_id text NOT NULL,
  payload jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, consumer, event_id)
);
CREATE TABLE IF NOT EXISTS runtime_statistics_projection (
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  tasks_total bigint NOT NULL DEFAULT 0,
  tasks_succeeded bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, agent_id)
);
CREATE TABLE IF NOT EXISTS runtime_growth_service_grants (
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  user_id text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('enterprise','employee')),
  agent_ids text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal_id)
);
CREATE TABLE IF NOT EXISTS runtime_task_result_facts (
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  terminal_event_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('completed','cancelled','failed')),
  evidence jsonb NOT NULL,
  agent_id text,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, execution_id),
  UNIQUE (tenant_id, terminal_event_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES runtime_executions
);
CREATE TABLE IF NOT EXISTS runtime_tool_execution_grants (
  token_hash text PRIMARY KEY,
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  task_id text NOT NULL,
  step_id text NOT NULL,
  operation_id text NOT NULL,
  tool_name text NOT NULL,
  session_key text NOT NULL,
  request_digest text NOT NULL,
  lease_owner text NOT NULL,
  fence bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, execution_id) REFERENCES runtime_executions
);
CREATE TABLE IF NOT EXISTS runtime_tool_results (
  tenant_id text NOT NULL,
  operation_key text NOT NULL,
  execution_id text NOT NULL,
  request_digest text NOT NULL,
  fence bigint NOT NULL,
  result jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, operation_key),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES runtime_executions
);
CREATE TABLE IF NOT EXISTS runtime_tool_intents (
  tenant_id text NOT NULL,
  operation_key text NOT NULL,
  execution_id text NOT NULL,
  request_digest text NOT NULL,
  fence bigint NOT NULL,
  grant_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, operation_key),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES runtime_executions
);
