-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 001 roles
-- Spec: OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md §8.1, §10.6, §11.2, Appendix A.1
--
-- Expand-only, idempotent. Run as the migration role (Managed PG admin or a
-- dedicated migrator with CREATEROLE). Passwords / IAM auth are NOT set here:
-- they are injected by the secret manager (never commit credentials).
-- =============================================================================

-- PostgreSQL >= 14 is required: pg_terminate_backend(pid, timeout),
-- client_connection_check_interval, CREATE OR REPLACE TRIGGER.
-- PostgreSQL >= 17 is recommended (transaction_timeout).
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'HA CommitSafety requires PostgreSQL >= 14 (found %)',
      current_setting('server_version');
  END IF;
END
$$;

-- A.1 roles. CREATE ROLE has no IF NOT EXISTS, so guard it.
--   openbot_ha_owner   NOLOGIN  owns HA tables + SECURITY DEFINER functions
--   openbot_controller LOGIN    External HA Controller (bump / terminate only)
--   openbot_app_a      LOGIN    application node A (business writes)
--   openbot_app_b      LOGIN    application node B (business writes)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('openbot_ha_owner',   false),
      ('openbot_controller', true),
      ('openbot_app_a',      true),
      ('openbot_app_b',      true)
    ) AS v(rolname, can_login)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r.rolname) THEN
      EXECUTE format(
        'CREATE ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        r.rolname, CASE WHEN r.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END);
    END IF;
  END LOOP;
END
$$;

-- §10.6 #2: business / controller / owner roles must never be superuser or
-- bypass RLS (otherwise session_replication_role / DISABLE TRIGGER bypasses).
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO v_bad
    FROM pg_catalog.pg_roles
   WHERE rolname IN ('openbot_ha_owner', 'openbot_controller', 'openbot_app_a', 'openbot_app_b')
     AND (rolsuper OR rolbypassrls OR rolreplication);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'HA roles must not be SUPERUSER/BYPASSRLS/REPLICATION: %', v_bad;
  END IF;
END
$$;

-- The migrator must be able to SET ROLE / inherit openbot_ha_owner so it can
-- ALTER ... OWNER TO openbot_ha_owner on Managed PG (where it is not a real
-- superuser). On PG >= 16 a CREATEROLE creator only gets ADMIN OPTION on the
-- roles it creates (no SET / INHERIT), so grant those options explicitly.
DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT (pg_catalog.pg_has_role(current_user, 'openbot_ha_owner', 'SET')
            AND pg_catalog.pg_has_role(current_user, 'openbot_ha_owner', 'USAGE')) THEN
      EXECUTE format('GRANT openbot_ha_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user);
    END IF;
  ELSIF NOT pg_catalog.pg_has_role(current_user, 'openbot_ha_owner', 'MEMBER') THEN
    EXECUTE format('GRANT openbot_ha_owner TO %I', current_user);
  END IF;
END
$$;

-- pg_signal_backend: needed by openbot_ha_terminate_holder_sessions() (owner =
-- openbot_ha_owner). pg_read_all_stats: lets the same SECURITY DEFINER helpers
-- see state / xact_start of app sessions for drain + VERIFY evidence.
-- Managed PG vendors sometimes only allow these via console / admin role, so a
-- failure is surfaced as a loud WARNING; checks/verify_helpers.sql reports it.
DO $$
DECLARE
  v_grant text;
BEGIN
  FOREACH v_grant IN ARRAY ARRAY['pg_signal_backend', 'pg_read_all_stats'] LOOP
    IF NOT pg_catalog.pg_has_role('openbot_ha_owner', v_grant, 'MEMBER') THEN
      BEGIN
        EXECUTE format('GRANT %I TO openbot_ha_owner', v_grant);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'could not GRANT % TO openbot_ha_owner (%). Grant it through the Managed PG vendor mechanism before Stage A drills.',
          v_grant, SQLERRM;
      END;
    END IF;
  END LOOP;
END
$$;

-- §8.1 / §11.2 steady-state timeout baseline for business roles.
-- NOTE: these timeouts are STEADY-STATE PROTECTION ONLY. Failover never waits
-- for transaction_timeout; it uses App Fence -> drain window (<= T_wait 5s) ->
-- Network Fence -> terminate old sessions -> confirm -> epoch++ (§9.2, §11.4).
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['openbot_app_a', 'openbot_app_b'] LOOP
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', v_role, '10s');
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', v_role, '15s');
    EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', v_role, '3s');
    IF current_setting('server_version_num')::int >= 170000 THEN
      EXECUTE format('ALTER ROLE %I SET transaction_timeout = %L', v_role, '30s');
    ELSE
      RAISE NOTICE 'PostgreSQL < 17: transaction_timeout unavailable for %; the application watchdog (§11.3) is REQUIRED.', v_role;
    END IF;
  END LOOP;
END
$$;
