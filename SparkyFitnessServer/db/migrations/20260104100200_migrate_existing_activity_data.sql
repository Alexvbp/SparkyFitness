-- Migration script to convert existing JSONB activity data to normalized activity_samples table
-- This migrates data from exercise_entry_activity_details to activity_samples

-- Step 1: Link exercise_entries to activities via source_id matching
UPDATE exercise_entries ee
SET activity_id = a.id
FROM activities a
WHERE ee.source = 'garmin'
  AND ee.source_id IS NOT NULL
  AND a.source = 'garmin'
  AND a.source_id = ee.source_id
  AND ee.activity_id IS NULL;

-- Note: The sample data migration from JSONB to activity_samples is complex
-- and should be done via a Node.js script that can:
-- 1. Read the metricDescriptors from each JSONB record
-- 2. Build the correct index mapping (taking highest metricsIndex per key)
-- 3. Transform each metric row into a sample
-- 4. Insert into activity_samples with PostGIS location

-- Run the following script after this migration:
-- node SparkyFitnessServer/scripts/migrateActivitySamples.js
