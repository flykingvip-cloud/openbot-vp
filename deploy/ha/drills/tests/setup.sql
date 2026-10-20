-- =============================================================================
-- HA V2.1.2 Stage B — drill fixtures (test DB only).
-- cs_probe (gated) + logical-decoding oracle slot for INV-CS (16L).
-- =============================================================================

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

-- Logical decoding oracle slot (test_decoding). Idempotent recreate.
DO $$
BEGIN
  PERFORM pg_drop_replication_slot('ha_drill_oracle')
    FROM pg_replication_slots WHERE slot_name = 'ha_drill_oracle';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
SELECT pg_create_logical_replication_slot('ha_drill_oracle', 'test_decoding');
