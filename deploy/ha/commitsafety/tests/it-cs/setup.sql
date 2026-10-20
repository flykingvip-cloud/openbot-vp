-- =============================================================================
-- HA V2.1.2 Stage A.2 — IT-CS fixture objects (test DB only).
-- Spec §19.1.1: cs_probe + naive_probe + logical-decoding oracle slot.
-- Does NOT attach gates to production business tables.
-- =============================================================================

-- Probe used by IT-CS-01..13 (gated + stamped). Prefer this over business tables.
CREATE TABLE IF NOT EXISTS public.cs_probe (
  id            text PRIMARY KEY,
  written_epoch bigint NOT NULL,
  note          text
);
ALTER TABLE public.cs_probe OWNER TO openbot_ha_owner;
REVOKE ALL ON public.cs_probe FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cs_probe TO openbot_app_a, openbot_app_b;
GRANT SELECT ON public.cs_probe TO openbot_controller;

CREATE OR REPLACE TRIGGER stamp_epoch
  BEFORE INSERT ON public.cs_probe
  FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_stamp_epoch();

CREATE OR REPLACE TRIGGER written_epoch_immutable
  BEFORE UPDATE ON public.cs_probe
  FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_written_epoch_immutable();

SELECT public.openbot_ha_attach_epoch_gate('public.cs_probe');

-- IT-CS-04 negative control: NO gate, NO lock, plain SELECT validate.
CREATE TABLE IF NOT EXISTS public.naive_probe (
  id            text PRIMARY KEY,
  written_epoch bigint NOT NULL,
  note          text
);
ALTER TABLE public.naive_probe OWNER TO CURRENT_USER;
REVOKE ALL ON public.naive_probe FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.naive_probe TO openbot_app_a, openbot_app_b;

CREATE OR REPLACE FUNCTION public.naive_validate(p_expected bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_current bigint;
BEGIN
  -- Deliberately lock-free + snapshot-blind (the broken pattern).
  SELECT g.current_epoch INTO v_current
    FROM public.writer_epoch_guard g
   WHERE g.lock_name = 'openbot_writer';
  IF v_current IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION USING ERRCODE = 'OB002',
      MESSAGE = format('naive_validate: stale (expected=%s, current=%s)', p_expected, v_current);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.naive_validate(bigint) TO openbot_app_a, openbot_app_b;

-- Logical decoding oracle slot (test_decoding). Idempotent recreate.
DO $$
BEGIN
  PERFORM pg_drop_replication_slot('it_cs_oracle')
    FROM pg_replication_slots WHERE slot_name = 'it_cs_oracle';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
SELECT pg_create_logical_replication_slot('it_cs_oracle', 'test_decoding');

-- Bootstrap: ensure guard starts at a known epoch with H1 unbound until first bump.
-- Stage A.1 migrations leave epoch=1 / holder=bootstrap / holder_db_role NULL.
