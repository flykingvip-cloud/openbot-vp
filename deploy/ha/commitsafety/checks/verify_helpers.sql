-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — CommitSafety configuration / VERIFY helpers
-- Spec: §8.1, §9.3, §10.6, Appendix A.6 "VERIFY 辅助". Report-only (read-only).
-- Usage: psql "$DATABASE_URL" -X -f checks/verify_helpers.sql
-- =============================================================================
\echo '== 2PC must be disabled (§10.6 #4) =='
SELECT current_setting('max_prepared_transactions')            AS max_prepared_transactions,
       (SELECT count(*) FROM pg_catalog.pg_prepared_xacts)       AS prepared_xacts,
       CASE WHEN current_setting('max_prepared_transactions') = '0'
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts)
            THEN 'PASS' ELSE 'FAIL' END                          AS verdict;

\echo '== epoch guard / lease =='
SELECT g.lock_name, g.current_epoch, g.holder_db_role, l.holder_id, l.epoch AS lease_epoch,
       l.lease_until, g.last_execution_id,
       CASE WHEN g.current_epoch = l.epoch THEN 'PASS' ELSE 'MISMATCH' END AS guard_vs_lease
  FROM public.writer_epoch_guard g
  JOIN public.writer_lease l USING (lock_name);

\echo '== HA roles: attributes and per-role timeout settings (§8.1 / §11.2) =='
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       (SELECT array_agg(s ORDER BY s) FROM pg_catalog.pg_db_role_setting d,
               unnest(d.setconfig) s
         WHERE d.setrole = r.oid AND d.setdatabase = 0) AS role_settings
  FROM pg_catalog.pg_roles r
 WHERE r.rolname IN ('openbot_ha_owner', 'openbot_controller', 'openbot_app_a', 'openbot_app_b')
 ORDER BY 1;

\echo '== openbot_ha_owner predefined-role memberships (terminate / drain evidence) =='
SELECT pg_catalog.pg_has_role('openbot_ha_owner', 'pg_signal_backend', 'MEMBER') AS has_pg_signal_backend,
       pg_catalog.pg_has_role('openbot_ha_owner', 'pg_read_all_stats', 'MEMBER') AS has_pg_read_all_stats;

\echo '== HA functions: owner / SECURITY DEFINER / pinned search_path =='
SELECT p.oid::regprocedure AS function, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer, p.proconfig
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'openbot\_ha\_%'
 ORDER BY 1::text;

\echo '== instance parameters relevant to failover (§8.1) =='
SELECT name, setting, unit
  FROM pg_catalog.pg_settings
 WHERE name IN ('server_version', 'synchronous_commit', 'max_prepared_transactions',
                'tcp_keepalives_idle', 'tcp_keepalives_interval', 'tcp_keepalives_count',
                'client_connection_check_interval', 'transaction_timeout')
 ORDER BY name;
