-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 003 commit gate
-- Spec: §10.2–§10.7, §10.10, Appendix A.3
--
-- Not "SELECT-then-hope": the epoch is read only AFTER taking a ROW SHARE lock
-- on writer_epoch_guard, and that lock is held until the end of the calling
-- transaction (i.e. until after COMMIT is durable and visible). The Controller
-- bump takes EXCLUSIVE on the same table, which conflicts with ROW SHARE, so a
-- business commit and an epoch bump can never interleave (§10.7 proof).
--
-- Error codes (§10.10):
--   OB001  openbot.expected_epoch missing / malformed  -> defect, fail-closed
--   OB002  stale epoch (expected <> current)           -> self-fence (503 / not_writer)
--   OB003  session_user is not the epoch's DB role (H1) -> self-fence
--   40001  RR/SERIALIZABLE snapshot predates a bump    -> self-fence
-- =============================================================================

CREATE OR REPLACE FUNCTION public.openbot_ha_commit_gate()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- Hardened search_path: pg_catalog first, pg_temp explicitly last, every
-- object reference below is schema-qualified (no search_path hijack).
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_raw      text := current_setting('openbot.expected_epoch', true);
  v_expected bigint;
  v_current  bigint;
  v_role     name;
  v_iso      text := current_setting('transaction_isolation');
BEGIN
  -- HARDENING vs. Appendix A.3: there is deliberately NO trusted fast path on
  -- 'openbot.gate_passed'. That GUC is writable by any session (set_config),
  -- so trusting it would let a session skip the lock + epoch read entirely.
  -- Re-running the gate on every row is cheap: the ROW SHARE lock is already
  -- held (local lock table hit, no shared-memory traffic) and the guard read
  -- is a single-row primary-key lookup. IT-CS-12 (Stage A.2) measures it.

  -- 0) declared epoch must exist and be a plain non-negative integer (fail-closed)
  IF v_raw IS NULL OR v_raw !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'OB001',
      MESSAGE = format('commit gate: openbot.expected_epoch not set or malformed (%L) (fail-closed)', v_raw);
  END IF;
  v_expected := v_raw::bigint;

  -- 1) mutual exclusion with the Controller's EXCLUSIVE; held to end of txn
  LOCK TABLE public.writer_epoch_guard IN ROW SHARE MODE;

  -- 2) read the latest committed epoch; MUST be a new statement after the lock
  IF v_iso IN ('repeatable read', 'serializable') THEN
    -- Snapshot may predate a concurrent bump: FOR SHARE on a row updated by a
    -- committed-after-snapshot transaction raises 40001 instead of returning
    -- the stale value (§10.4). FOR KEY SHARE is forbidden (§10.4).
    SELECT g.current_epoch, g.holder_db_role
      INTO v_current, v_role
      FROM public.writer_epoch_guard AS g
     WHERE g.lock_name = 'openbot_writer'
       FOR SHARE;
  ELSE
    -- READ COMMITTED: a new statement takes a new snapshot, and the bump has
    -- committed + become visible before releasing EXCLUSIVE.
    SELECT g.current_epoch, g.holder_db_role
      INTO v_current, v_role
      FROM public.writer_epoch_guard AS g
     WHERE g.lock_name = 'openbot_writer';
  END IF;

  -- 3) generation check with <> (also defends against epoch regression, E6)
  IF v_current IS NULL OR v_current <> v_expected THEN
    RAISE EXCEPTION USING ERRCODE = 'OB002',
      MESSAGE = format('commit gate: stale epoch (expected=%s, current=%s)', v_expected, v_current);
  END IF;

  -- 4) H1: epoch bound to a DB role (skipped while holder_db_role IS NULL)
  IF v_role IS NOT NULL AND session_user <> v_role THEN
    RAISE EXCEPTION USING ERRCODE = 'OB003',
      MESSAGE = format('commit gate: role %s is not epoch holder %s', session_user, v_role);
  END IF;

  -- Informational marker only (never trusted for skipping, see above).
  PERFORM set_config('openbot.gate_passed', 'on', true);
END;
$$;

ALTER FUNCTION public.openbot_ha_commit_gate() OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_commit_gate() FROM PUBLIC;
-- Every role that writes authoritative tables needs EXECUTE (missing grant =
-- permission denied at COMMIT = fail-closed). Ops/audit write accounts must be
-- granted explicitly by the deploy that introduces them (§10.6 #10).
GRANT EXECUTE ON FUNCTION public.openbot_ha_commit_gate() TO openbot_app_a, openbot_app_b;
