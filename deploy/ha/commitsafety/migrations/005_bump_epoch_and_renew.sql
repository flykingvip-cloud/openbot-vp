-- =============================================================================
-- OpenBot Cloud HA V2.1.2 — Stage A.1 CommitSafety — 005 epoch bump + renew
-- Spec: §10.8, §10.9, §12.4, §12.6, Appendix A.5 (+ note after A.6)
--
-- openbot_ha_bump_epoch() is the ONLY path that advances the epoch, for both
-- auto and manual failover (§10.8, §13.2). Manual UPDATE of
-- writer_epoch_guard is forbidden (and additionally blocked by the
-- ha_guard_monotonic trigger + privileges).
--
-- Caller contract (Controller):
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';       -- = T_wait, REQUIRED (enforced: OB012)
--   SET LOCAL statement_timeout = '10s';
--   SELECT openbot_ha_bump_epoch(:execution_id, :owner_gen, :from_epoch,
--                                :to_holder, :to_db_role);
--   COMMIT;                              -- commit == "epoch N+1 in effect"
--
-- Lock order (§10.3.3, deadlock-free):
--   writer_epoch_guard (EXCLUSIVE) -> writer_lease row -> execution row -> audit
-- =============================================================================

CREATE OR REPLACE FUNCTION public.openbot_ha_bump_epoch(
  p_execution_id uuid,
  p_owner_gen    int,
  p_from_epoch   bigint,
  p_to_holder    text,
  p_to_db_role   name,
  p_ttl          interval DEFAULT '45 seconds')
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_new  bigint := p_from_epoch + 1;
  v_exec public.ha_failover_execution%ROWTYPE;
  v_rows int;
BEGIN
  -- HARDENING: while EXCLUSIVE is queued, every new business commit queues
  -- behind it. An unbounded wait would freeze all writes, so the caller MUST
  -- bound it (§10.8 / §11.4 step 7: lock_timeout = T_wait = 5s).
  IF current_setting('lock_timeout') IN ('0', '0ms', '0s') THEN
    RAISE EXCEPTION USING ERRCODE = 'OB012',
      MESSAGE = 'bump: caller must SET LOCAL lock_timeout (e.g. ''5s'') before openbot_ha_bump_epoch()';
  END IF;

  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = 'OB010', MESSAGE = format('bump: invalid ttl %s', p_ttl);
  END IF;

  -- H1 role binding target must be a real business role (or NULL = unbound).
  IF p_to_db_role IS NOT NULL AND (
       p_to_db_role::text NOT LIKE 'openbot\_app\_%'
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = p_to_db_role)) THEN
    RAISE EXCEPTION USING ERRCODE = 'OB010',
      MESSAGE = format('bump: to_db_role %s must be an existing openbot_app_* role', p_to_db_role);
  END IF;

  -- (1) mutual exclusion with every gate holder; held to end of the bump txn
  LOCK TABLE public.writer_epoch_guard IN EXCLUSIVE MODE;
  -- (2) lease row, (3) execution row
  PERFORM 1 FROM public.writer_lease l WHERE l.lock_name = 'openbot_writer' FOR UPDATE;
  SELECT * INTO v_exec
    FROM public.ha_failover_execution e
   WHERE e.execution_id = p_execution_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'OB010', MESSAGE = 'bump: execution not found';
  END IF;

  -- Idempotent retry of the same execution: already done -> return, no +1.
  IF v_exec.state = 'LEASED' AND v_exec.to_epoch = v_new
     AND EXISTS (SELECT 1 FROM public.writer_epoch_guard g
                  WHERE g.lock_name = 'openbot_writer' AND g.current_epoch = v_new) THEN
    RETURN v_new;
  END IF;

  -- INV-VERIFY + zombie-owner protection (§12.4.3) + target from execution row
  -- (§12.5: side-effect targets come from the execution row, not the caller).
  IF v_exec.owner_gen <> p_owner_gen
     OR v_exec.from_epoch <> p_from_epoch
     OR v_exec.lock_name <> 'openbot_writer'
     OR v_exec.to_holder IS DISTINCT FROM p_to_holder
     OR v_exec.state <> 'VERIFIED' THEN
    RAISE EXCEPTION USING ERRCODE = 'OB010',
      MESSAGE = format('bump: not owner / not VERIFIED / target mismatch (state=%s, gen=%s, from=%s, to_holder=%s)',
                       v_exec.state, v_exec.owner_gen, v_exec.from_epoch, v_exec.to_holder);
  END IF;

  -- INV-MONO: CAS on the epoch
  UPDATE public.writer_epoch_guard
     SET current_epoch = v_new, holder_db_role = p_to_db_role,
         last_execution_id = p_execution_id, updated_at = now()
   WHERE lock_name = 'openbot_writer' AND current_epoch = p_from_epoch;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'OB011', MESSAGE = 'bump: epoch CAS failed';
  END IF;

  UPDATE public.writer_lease
     SET holder_id = p_to_holder, epoch = v_new, lease_until = now() + p_ttl,
         fence_token = p_execution_id, updated_at = now()
   WHERE lock_name = 'openbot_writer' AND epoch = p_from_epoch;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'OB011', MESSAGE = 'bump: lease CAS failed';
  END IF;

  UPDATE public.ha_failover_execution
     SET to_epoch = v_new, state = 'LEASED', updated_at = now()
   WHERE execution_id = p_execution_id AND owner_gen = p_owner_gen;

  INSERT INTO public.writer_lease_audit(execution_id, lock_name, action, old_epoch, new_epoch, holder_id, detail)
  VALUES (p_execution_id, 'openbot_writer', 'epoch_bump', p_from_epoch, v_new, p_to_holder,
          jsonb_build_object('owner_gen', p_owner_gen, 'to_db_role', p_to_db_role,
                             'from_holder', v_exec.from_holder, 'mode', v_exec.mode));

  RETURN v_new;
END;
$$;

ALTER FUNCTION public.openbot_ha_bump_epoch(uuid, int, bigint, text, name, interval) OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_bump_epoch(uuid, int, bigint, text, name, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.openbot_ha_bump_epoch(uuid, int, bigint, text, name, interval) TO openbot_controller;

-- Renew (§10.9; note after Appendix A.6): SECURITY DEFINER so business roles
-- never hold UPDATE on writer_lease. Touches only the writer_lease row (never
-- the guard), so it cannot deadlock with bump (§10.3.3). Returns the new
-- lease_until, or NULL when the caller is no longer holder/epoch -> the node
-- MUST self-fence (stop writing) and alert.
CREATE OR REPLACE FUNCTION public.openbot_ha_renew(
  p_holder_id text,
  p_epoch     bigint,
  p_ttl       interval DEFAULT '45 seconds')
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = 'OB010', MESSAGE = format('renew: invalid ttl %s', p_ttl);
  END IF;
  UPDATE public.writer_lease
     SET lease_until = now() + p_ttl, updated_at = now()
   WHERE lock_name = 'openbot_writer'
     AND holder_id = p_holder_id
     AND epoch = p_epoch
  RETURNING lease_until INTO v_until;
  RETURN v_until;   -- NULL => not holder anymore => self-fence
END;
$$;

ALTER FUNCTION public.openbot_ha_renew(text, bigint, interval) OWNER TO openbot_ha_owner;
REVOKE ALL ON FUNCTION public.openbot_ha_renew(text, bigint, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.openbot_ha_renew(text, bigint, interval) TO openbot_app_a, openbot_app_b;
