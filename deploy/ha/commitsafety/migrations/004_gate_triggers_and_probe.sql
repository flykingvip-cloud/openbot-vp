-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 004 gate triggers + probe
-- Spec: §10.5 (Layer 1), §10.6, §15.2, §19.3, Appendix A.4
--
-- Layer 1 (mandatory): every authoritative table carries
--   CONSTRAINT TRIGGER openbot_epoch_gate
--     AFTER INSERT OR UPDATE OR DELETE  DEFERRABLE INITIALLY DEFERRED
--     FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_epoch_gate_trg()
-- so the gate runs in the commit phase, cannot be skipped or caught by the
-- application, and a gate error turns COMMIT into a full rollback.
--
-- New authoritative tables MUST attach the trigger in the SAME expand
-- migration that creates them (§15.2 rule 1), e.g.
--   SELECT public.openbot_ha_attach_epoch_gate('public.my_new_table');
-- or the raw template in templates/attach_epoch_gate.sql. CI runs
-- checks/gate_coverage.sql, which fails if any table is missing it.
-- =============================================================================

-- Trigger body: runs as the writing role (not SECURITY DEFINER); the gate
-- itself is SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.openbot_ha_epoch_gate_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.openbot_ha_commit_gate();
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.openbot_ha_epoch_gate_trg() OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_epoch_gate_trg() FROM PUBLIC;

-- Helper for migrations: idempotently attach the gate to an authoritative
-- table. Runs as the caller (must own the table, i.e. the migration role).
-- Refuses HA-exempt tables (§10.6 #11: Controller would self-lock).
CREATE OR REPLACE FUNCTION public.openbot_ha_attach_epoch_gate(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ha_gate_exempt e WHERE e.table_name = p_table) THEN
    RAISE EXCEPTION 'openbot_ha_attach_epoch_gate: % is HA-exempt and must NOT carry the commit gate', p_table;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
              WHERE t.tgrelid = p_table AND t.tgname = 'openbot_epoch_gate') THEN
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE CONSTRAINT TRIGGER openbot_epoch_gate'
    ' AFTER INSERT OR UPDATE OR DELETE ON %s'
    ' DEFERRABLE INITIALLY DEFERRED'
    ' FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_epoch_gate_trg()',
    p_table);
END;
$$;
ALTER FUNCTION public.openbot_ha_attach_epoch_gate(regclass) OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_attach_epoch_gate(regclass) FROM PUBLIC;

-- Test / drill tables: written_epoch is stamped by trigger so it always equals
-- e(T) (the declared epoch), regardless of what the client sent.
CREATE OR REPLACE FUNCTION public.openbot_ha_stamp_epoch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_raw text := current_setting('openbot.expected_epoch', true);
BEGIN
  IF v_raw IS NULL OR v_raw !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'OB001',
      MESSAGE = format('written_epoch stamp: openbot.expected_epoch not set or malformed (%L) (fail-closed)', v_raw);
  END IF;
  NEW.written_epoch := v_raw::bigint;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.openbot_ha_stamp_epoch() OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_stamp_epoch() FROM PUBLIC;

-- EXPERT HARDENING (Stage A.1): written_epoch is an immutable audit field.
-- Any UPDATE that changes it is rejected (OB020) for every role, including
-- the table owner; business roles additionally have no UPDATE privilege on
-- ha_rpo_probe. Split-brain audits (§14.2) and the RPO drill (§19.3) rely on
-- written_epoch being the epoch the row was originally committed under.
CREATE OR REPLACE FUNCTION public.openbot_ha_written_epoch_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.written_epoch IS DISTINCT FROM OLD.written_epoch THEN
    RAISE EXCEPTION USING ERRCODE = 'OB020',
      MESSAGE = format('%I.%I.written_epoch is immutable (old=%s, attempted=%s)',
                       TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.written_epoch, NEW.written_epoch);
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.openbot_ha_written_epoch_immutable() OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_written_epoch_immutable() FROM PUBLIC;

CREATE OR REPLACE TRIGGER stamp_epoch
  BEFORE INSERT ON public.ha_rpo_probe
  FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_stamp_epoch();

CREATE OR REPLACE TRIGGER written_epoch_immutable
  BEFORE UPDATE ON public.ha_rpo_probe
  FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_written_epoch_immutable();

-- Layer 1 gate on the probe (production write path).
SELECT public.openbot_ha_attach_epoch_gate('public.ha_rpo_probe');
