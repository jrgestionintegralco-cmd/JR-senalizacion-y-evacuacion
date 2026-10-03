-- Additive migration. Fail closed if pre-existing data needs manual reconciliation.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM floor_plans WHERE status='ready' GROUP BY organization_id,floor_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Multiple current plans: reconcile explicitly before applying 004';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_plans_one_ready
  ON floor_plans (organization_id,floor_id) WHERE status='ready';
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS verified_at timestamptz;
COMMENT ON COLUMN stored_files.verified_at IS 'Validated bytes sealed by stage 4.0; NULL means legacy or pending, not verified';
COMMIT;
