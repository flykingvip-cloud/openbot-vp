-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — CommitSafety CI coverage check (Appendix A.6)
-- Spec: §10.6 #6 / #11, §15.2 rules 1–2, §20.1 P0-CS-3
--
-- Fails (non-zero psql exit with ON_ERROR_STOP=1) when:
--   (a) an ordinary table / partition in a checked schema is neither HA-exempt
--       nor carries a VALID openbot_epoch_gate constraint trigger;
--   (b) an HA-exempt control table carries openbot_epoch_gate (Controller self-lock);
--   (c) the gate function is not SECURITY DEFINER with a pinned search_path.
--
-- "Valid" is stricter than the Appendix A.6 reference query: in addition to
-- name / constraint / DEFERRABLE INITIALLY DEFERRED / enabled, it requires
-- AFTER ROW INSERT+UPDATE+DELETE and the trigger function to be
-- public.openbot_ha_epoch_gate_trg() (a same-named no-op trigger is rejected).
--
-- Usage:  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--           [-v schemas=public,other] [-v report_only=1] -f checks/gate_coverage.sql
-- =============================================================================
\if :{?schemas}
\else
  \set schemas public
\endif
\if :{?report_only}
\else
  \set report_only 0
\endif

SELECT set_config('openbot.cs_check_schemas', :'schemas', false) AS checked_schemas,
       set_config('openbot.cs_check_report_only', :'report_only', false) AS report_only
\gset

-- (a) authoritative tables missing a valid gate (result MUST be empty)
CREATE TEMP VIEW openbot_cs_missing_gate AS
SELECT c.oid::regclass AS missing_gate
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'                       -- ordinary tables incl. every partition
   AND n.nspname = ANY (string_to_array(current_setting('openbot.cs_check_schemas'), ','))
   AND c.oid NOT IN (SELECT e.table_name::oid FROM public.ha_gate_exempt e)
   AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = c.oid
            AND t.tgname = 'openbot_epoch_gate'
            AND t.tgconstraint <> 0
            AND t.tgdeferrable AND t.tginitdeferred
            AND t.tgenabled IN ('O', 'A')
            AND (t.tgtype & 1)  = 1           -- FOR EACH ROW
            AND (t.tgtype & 2)  = 0           -- AFTER
            AND (t.tgtype & 28) = 28          -- INSERT(4) + DELETE(8) + UPDATE(16)
            AND t.tgfoid = 'public.openbot_ha_epoch_gate_trg()'::regprocedure);

-- (b) HA control tables must not carry the gate (result MUST be empty)
CREATE TEMP VIEW openbot_cs_exempt_with_gate AS
SELECT t.tgrelid::regclass AS exempt_with_gate
  FROM pg_catalog.pg_trigger t
 WHERE t.tgname = 'openbot_epoch_gate'
   AND t.tgrelid IN (SELECT e.table_name::oid FROM public.ha_gate_exempt e);

\echo '== (a) authoritative tables missing openbot_epoch_gate (must be empty) =='
SELECT * FROM openbot_cs_missing_gate ORDER BY 1::text;
\echo '== (b) HA-exempt tables carrying openbot_epoch_gate (must be empty) =='
SELECT * FROM openbot_cs_exempt_with_gate ORDER BY 1::text;

DO $$
DECLARE
  v_missing text;
  v_exempt  text;
  v_gate_ok boolean;
BEGIN
  SELECT string_agg(missing_gate::text, ', ' ORDER BY missing_gate::text) INTO v_missing FROM openbot_cs_missing_gate;
  SELECT string_agg(exempt_with_gate::text, ', ' ORDER BY exempt_with_gate::text) INTO v_exempt FROM openbot_cs_exempt_with_gate;

  SELECT p.prosecdef AND coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=%', false)
    INTO v_gate_ok
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.openbot_ha_commit_gate()'::regprocedure;

  IF v_missing IS NULL AND v_exempt IS NULL AND coalesce(v_gate_ok, false) THEN
    RAISE NOTICE 'CommitSafety gate coverage: PASS (schemas=%)', current_setting('openbot.cs_check_schemas');
    RETURN;
  END IF;

  IF current_setting('openbot.cs_check_report_only') = '1' THEN
    RAISE WARNING 'CommitSafety gate coverage: FAIL (report_only) missing=[%] exempt_with_gate=[%] gate_secdef_ok=%',
      coalesce(v_missing, ''), coalesce(v_exempt, ''), v_gate_ok;
  ELSE
    RAISE EXCEPTION 'CommitSafety gate coverage: FAIL missing=[%] exempt_with_gate=[%] gate_secdef_ok=%',
      coalesce(v_missing, ''), coalesce(v_exempt, ''), v_gate_ok
      USING HINT = 'Attach the gate in the SAME expand migration: SELECT public.openbot_ha_attach_epoch_gate(''<table>''); exempt-list changes need architecture review (§15.2).';
  END IF;
END
$$;
