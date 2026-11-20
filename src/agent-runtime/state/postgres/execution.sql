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
