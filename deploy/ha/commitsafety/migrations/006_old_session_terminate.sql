-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 006 old-session helpers
-- Spec: §9.2 steps 5–6, §9.3 item 3, §11.4, §11.5, Appendix A.6
--
-- FAILOVER MUST NOT WAIT FOR transaction_timeout. transaction_timeout /
-- statement_timeout / idle_in_transaction_session_timeout (001) are
-- steady-state protection only. The failover drain path is:
--   App Fence -> drain window (only if App Fence confirmed, <= T_wait 5s)
--   -> Network Fence -> [Compute Fence if needed]
--   -> openbot_ha_terminate_holder_sessions(...)   (this file)
--   -> confirm: openbot_ha_holder_sessions(...) = 0 for T_confirm,
--               pg_prepared_xacts empty
--   -> state = 'VERIFIED' -> openbot_ha_bump_epoch() (epoch++)
-- Termination must happen AFTER Network Fence, otherwise the old node simply
-- reconnects (§11.4).
--
-- Session identification (§11.5): application_name = 'openbot:<holder_id>:<role>:<pid>'
-- and/or the per-node DB role (openbot_app_a / openbot_app_b). Only
-- openbot_app_* sessions can ever be matched; Controller, migration and
-- superuser sessions are never terminated.
-- =============================================================================

-- Read-only: list sessions still attributable to the old holder (drain
-- polling and the VERIFY "old holder sessions = 0" check).
CREATE OR REPLACE FUNCTION public.openbot_ha_holder_sessions(
  p_holder_id text,
  p_db_role   name DEFAULT NULL)
RETURNS TABLE(pid int, usename name, app_name text, state text,
              xact_age interval, client_addr inet)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_holder_id IS NULL OR p_holder_id !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'invalid holder_id %', p_holder_id;
  END IF;
  IF p_db_role IS NOT NULL AND p_db_role::text NOT LIKE 'openbot\_app\_%' THEN
    RAISE EXCEPTION 'only openbot_app_* roles may be targeted';
  END IF;

  RETURN QUERY
  SELECT a.pid, a.usename, a.application_name::text, a.state::text,
         now() - a.xact_start, a.client_addr
    FROM pg_catalog.pg_stat_activity a
   WHERE a.datname = current_database()
     AND a.pid <> pg_catalog.pg_backend_pid()
     AND a.usename::text LIKE 'openbot\_app\_%'
     AND (a.application_name LIKE 'openbot:' || p_holder_id || ':%'
          OR (p_db_role IS NOT NULL AND a.usename = p_db_role));
END;
$$;

ALTER FUNCTION public.openbot_ha_holder_sessions(text, name) OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_holder_sessions(text, name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.openbot_ha_holder_sessions(text, name) TO openbot_controller;

-- Terminate old-holder sessions (Appendix A.6) and audit each one into
-- writer_lease_audit (§11.5 P0). p_execution_id is optional so the
-- Appendix A.6 3-argument call form keeps working.
CREATE OR REPLACE FUNCTION public.openbot_ha_terminate_holder_sessions(
  p_holder_id    text,
  p_db_role      name,
  p_timeout_ms   int  DEFAULT 2000,
  p_execution_id uuid DEFAULT NULL)
RETURNS TABLE(pid int, usename name, app_name text, state text,
              xact_age interval, terminated boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  r record;
BEGIN
  IF p_holder_id IS NULL OR p_holder_id !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'invalid holder_id %', p_holder_id;
  END IF;
  IF p_db_role IS NOT NULL AND p_db_role::text NOT LIKE 'openbot\_app\_%' THEN
    RAISE EXCEPTION 'only openbot_app_* roles may be terminated';
  END IF;
  IF p_timeout_ms IS NULL OR p_timeout_ms < 0 OR p_timeout_ms > 10000 THEN
    RAISE EXCEPTION 'invalid timeout_ms % (0..10000)', p_timeout_ms;
  END IF;

  FOR r IN
    SELECT a.pid AS a_pid, a.usename AS a_usename, a.application_name::text AS a_app,
           a.state::text AS a_state, now() - a.xact_start AS a_age
      FROM pg_catalog.pg_stat_activity a
     WHERE a.datname = current_database()
       AND a.pid <> pg_catalog.pg_backend_pid()
       AND a.usename::text LIKE 'openbot\_app\_%'
       AND (a.application_name LIKE 'openbot:' || p_holder_id || ':%'
            OR (p_db_role IS NOT NULL AND a.usename = p_db_role))
  LOOP
    pid        := r.a_pid;
    usename    := r.a_usename;
    app_name   := r.a_app;
    state      := r.a_state;
    xact_age   := r.a_age;
    terminated := pg_catalog.pg_terminate_backend(r.a_pid, p_timeout_ms::bigint);

    INSERT INTO public.writer_lease_audit(execution_id, lock_name, action, holder_id, detail)
    VALUES (p_execution_id, 'openbot_writer', 'terminate_session', p_holder_id,
            jsonb_build_object('pid', r.a_pid, 'usename', r.a_usename,
                               'application_name', r.a_app, 'state', r.a_state,
                               'xact_age', r.a_age::text, 'terminated', terminated,
                               'timeout_ms', p_timeout_ms));
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION public.openbot_ha_terminate_holder_sessions(text, name, int, uuid) OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_terminate_holder_sessions(text, name, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.openbot_ha_terminate_holder_sessions(text, name, int, uuid) TO openbot_controller;
