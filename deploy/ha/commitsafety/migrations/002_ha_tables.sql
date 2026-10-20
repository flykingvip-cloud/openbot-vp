-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 002 HA tables
-- Spec: §10.1, §10.3, §12.3, §12.4, Appendix A.2
--
-- Expand-only, idempotent. The V2.1.1 control tables (writer_lease,
-- writer_lease_audit, writer_epoch_guard) do not exist in this repository yet,
-- so they are created here with CREATE TABLE IF NOT EXISTS; if an environment
-- already has them, the ADD COLUMN IF NOT EXISTS statements bring them up to
-- the V2.1.2 shape without rewriting existing data.
-- =============================================================================

-- G: single-row epoch guard (§10.1). Lock target of CS-Lock (§10.3).
CREATE TABLE IF NOT EXISTS public.writer_epoch_guard (
  lock_name     text   PRIMARY KEY,
  current_epoch bigint NOT NULL CHECK (current_epoch >= 1)
);
ALTER TABLE public.writer_epoch_guard ADD COLUMN IF NOT EXISTS holder_db_role    name;
ALTER TABLE public.writer_epoch_guard ADD COLUMN IF NOT EXISTS last_execution_id uuid;
ALTER TABLE public.writer_epoch_guard ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- Writer lease (§10.9). Renew only via openbot_ha_renew(); bump only via
-- openbot_ha_bump_epoch().
CREATE TABLE IF NOT EXISTS public.writer_lease (
  lock_name   text        PRIMARY KEY,
  holder_id   text        NOT NULL,
  epoch       bigint      NOT NULL,
  lease_until timestamptz NOT NULL
);
ALTER TABLE public.writer_lease ADD COLUMN IF NOT EXISTS fence_token uuid;
ALTER TABLE public.writer_lease ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Audit trail: epoch bumps, terminated sessions, renew failures (§11.5, §12.8).
-- bigserial => sequence public.writer_lease_audit_id_seq (granted below).
CREATE TABLE IF NOT EXISTS public.writer_lease_audit (
  id           bigserial   PRIMARY KEY,
  execution_id uuid,
  lock_name    text        NOT NULL,
  action       text        NOT NULL,
  old_epoch    bigint,
  new_epoch    bigint,
  holder_id    text,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  db_user      name        NOT NULL DEFAULT session_user,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_writer_lease_audit_exec
  ON public.writer_lease_audit (execution_id, created_at);

-- Bootstrap row. Epoch 1 with no holder_db_role binding (H1 disabled until the
-- first Controller bump binds a role). The first real holder is assigned by a
-- normal manual execution (bootstrap -> node-a) through openbot_ha_bump_epoch().
INSERT INTO public.writer_epoch_guard (lock_name, current_epoch)
VALUES ('openbot_writer', 1)
ON CONFLICT (lock_name) DO NOTHING;

INSERT INTO public.writer_lease (lock_name, holder_id, epoch, lease_until)
VALUES ('openbot_writer', 'bootstrap', 1, '-infinity')
ON CONFLICT (lock_name) DO NOTHING;

-- Defence in depth for INV-MONO (§10.1): even the owner / migrator cannot move
-- the epoch by anything other than exactly +1, nor rename the lock row.
-- (This is NOT a commit gate; HA tables must never carry openbot_epoch_gate.)
CREATE OR REPLACE FUNCTION public.openbot_ha_guard_monotonic_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.lock_name IS DISTINCT FROM OLD.lock_name THEN
    RAISE EXCEPTION USING ERRCODE = 'OB013',
      MESSAGE = 'writer_epoch_guard: lock_name is immutable';
  END IF;
  IF NEW.current_epoch IS DISTINCT FROM OLD.current_epoch
     AND NEW.current_epoch <> OLD.current_epoch + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'OB013',
      MESSAGE = format('writer_epoch_guard: epoch must advance by exactly +1 (old=%s, new=%s); use openbot_ha_bump_epoch()',
                       OLD.current_epoch, NEW.current_epoch);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER ha_guard_monotonic
  BEFORE UPDATE ON public.writer_epoch_guard
  FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_guard_monotonic_trg();

-- P1-DC controller heartbeat (§12.3).
CREATE TABLE IF NOT EXISTS public.ha_controller_instance (
  controller_id   text PRIMARY KEY,
  failure_domain  text NOT NULL,
  version         text NOT NULL,
  last_heartbeat  timestamptz NOT NULL
);

-- DB-arbitrated single-winner execution log (§12.4).
CREATE TABLE IF NOT EXISTS public.ha_failover_execution (
  execution_id        uuid PRIMARY KEY,
  lock_name           text NOT NULL,
  from_epoch          bigint NOT NULL,
  to_epoch            bigint,
  from_holder         text NOT NULL,
  to_holder           text NOT NULL,
  owner_controller_id text NOT NULL,
  owner_gen           int  NOT NULL DEFAULT 1,
  owner_lease_until   timestamptz NOT NULL,
  state               text NOT NULL,      -- CLAIMED|FENCING_*|DRAIN_WAIT|TERMINATING_OLD_SESSIONS|VERIFYING|VERIFIED|LEASED|PROMOTING|CF_CUTOVER|OBSERVING|DONE|ABORTED_MANUAL|ABORTED_CLOSED
  mode                text NOT NULL CHECK (mode IN ('auto', 'manual')),
  steps               jsonb NOT NULL DEFAULT '[]'::jsonb,
  drain_evidence      jsonb,
  verify_evidence     jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- INV-ONE: at most one live execution per (lock_name, from_epoch).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ha_exec_one_active_per_epoch
  ON public.ha_failover_execution (lock_name, from_epoch)
  WHERE state <> 'ABORTED_CLOSED';

-- Tables that must NEVER carry the commit gate (§10.6 #11). Changes to this
-- list require architecture review (§15.2 rule 3).
CREATE TABLE IF NOT EXISTS public.ha_gate_exempt (
  table_name regclass PRIMARY KEY,
  reason     text NOT NULL
);
INSERT INTO public.ha_gate_exempt VALUES
  ('public.writer_lease',           'HA 控制表'),
  ('public.writer_lease_audit',     'HA 控制表'),
  ('public.writer_epoch_guard',     'HA 控制表'),
  ('public.ha_failover_execution',  'HA 控制表'),
  ('public.ha_controller_instance', 'HA 控制表'),
  ('public.ha_gate_exempt',         'HA 控制表')
ON CONFLICT DO NOTHING;

-- RPO drill probe (§19.3, Appendix A.2). NOT exempt: it carries the gate and
-- is written through the production write path. written_epoch is stamped by
-- trigger and immutable (see 004).
CREATE TABLE IF NOT EXISTS public.ha_rpo_probe (
  run_id          uuid   NOT NULL,
  seq             bigint NOT NULL,
  client_sent_at  timestamptz NOT NULL,
  payload_sha256  text   NOT NULL,
  written_epoch   bigint NOT NULL,
  inserted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

-- ALTER ... OWNER TO requires the new owner to hold CREATE on the schema
-- (PG >= 15 no longer grants CREATE on public to PUBLIC). Only the migrator is
-- a member of openbot_ha_owner; business / controller roles are not.
GRANT USAGE, CREATE ON SCHEMA public TO openbot_ha_owner;

-- Ownership + privileges (Appendix A.2). Business roles are never owners
-- (§10.6 #1) and get no TRUNCATE (§10.6 #3).
ALTER TABLE public.writer_lease           OWNER TO openbot_ha_owner;
ALTER TABLE public.writer_lease_audit     OWNER TO openbot_ha_owner;
ALTER TABLE public.writer_epoch_guard     OWNER TO openbot_ha_owner;
ALTER TABLE public.ha_failover_execution  OWNER TO openbot_ha_owner;
ALTER TABLE public.ha_controller_instance OWNER TO openbot_ha_owner;
ALTER TABLE public.ha_gate_exempt         OWNER TO openbot_ha_owner;
ALTER FUNCTION public.openbot_ha_guard_monotonic_trg() OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_guard_monotonic_trg() FROM PUBLIC;

REVOKE ALL ON public.writer_lease, public.writer_lease_audit, public.writer_epoch_guard,
              public.ha_failover_execution, public.ha_controller_instance, public.ha_gate_exempt
  FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.writer_lease_audit_id_seq FROM PUBLIC;

GRANT SELECT ON public.writer_epoch_guard, public.writer_lease TO openbot_app_a, openbot_app_b;
GRANT SELECT, INSERT, UPDATE ON public.ha_failover_execution, public.ha_controller_instance TO openbot_controller;
GRANT SELECT ON public.writer_epoch_guard, public.writer_lease, public.writer_lease_audit, public.ha_gate_exempt TO openbot_controller;
GRANT INSERT ON public.writer_lease_audit TO openbot_controller;
GRANT USAGE ON SEQUENCE public.writer_lease_audit_id_seq TO openbot_controller;

-- Probe: append-only for business roles (no UPDATE / DELETE / TRUNCATE).
-- Table owner stays the migration role (NOT a business role, §10.6 #1).
REVOKE ALL ON public.ha_rpo_probe FROM PUBLIC;
GRANT SELECT, INSERT ON public.ha_rpo_probe TO openbot_app_a, openbot_app_b;
GRANT SELECT ON public.ha_rpo_probe TO openbot_controller;
