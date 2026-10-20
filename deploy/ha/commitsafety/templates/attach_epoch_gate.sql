-- =============================================================================
-- TEMPLATE — attach the CommitSafety gate to a NEW authoritative table.
-- Put this in the SAME expand migration that creates the table (§15.2 rule 1).
-- Run as the migration role (table owner). Never as a business role.
-- =============================================================================

-- Option A (preferred, idempotent helper):
SELECT public.openbot_ha_attach_epoch_gate('public.<authority_table>');

-- Option B (raw DDL, Appendix A.4):
-- CREATE CONSTRAINT TRIGGER openbot_epoch_gate
--   AFTER INSERT OR UPDATE OR DELETE ON public.<authority_table>
--   DEFERRABLE INITIALLY DEFERRED
--   FOR EACH ROW
--   EXECUTE FUNCTION public.openbot_ha_epoch_gate_trg();

-- Privileges for business roles: never ownership, never TRUNCATE (§10.6 #1/#3).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.<authority_table> TO openbot_app_a, openbot_app_b;

-- Optional, for audit/drill tables with a written_epoch bigint NOT NULL column:
-- CREATE OR REPLACE TRIGGER stamp_epoch BEFORE INSERT ON public.<authority_table>
--   FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_stamp_epoch();
-- CREATE OR REPLACE TRIGGER written_epoch_immutable BEFORE UPDATE ON public.<authority_table>
--   FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_written_epoch_immutable();

-- Rollout order (§15.2 rule 4): the trigger may only be attached to an
-- EXISTING business table after every write path sets
--   SELECT set_config('openbot.expected_epoch', '<N>', true);
-- at the start of each write transaction; otherwise its writes fail with OB001.
