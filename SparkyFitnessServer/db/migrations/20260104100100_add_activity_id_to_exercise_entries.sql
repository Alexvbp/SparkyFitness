-- Add activity_id column to link exercise entries to activities
ALTER TABLE exercise_entries ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES activities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_exercise_entries_activity ON exercise_entries(activity_id);
