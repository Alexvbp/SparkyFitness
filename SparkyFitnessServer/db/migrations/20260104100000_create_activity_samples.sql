-- Create activity_samples table for time-series activity data
CREATE TABLE IF NOT EXISTS activity_samples (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    sample_index integer NOT NULL,
    timestamp_ms bigint NOT NULL,
    elapsed_seconds numeric,
    distance_meters numeric,
    heart_rate smallint,
    speed_mps numeric,
    elevation_meters numeric,
    location geography(Point,4326),
    cadence smallint,
    power_watts smallint,
    created_at timestamptz DEFAULT now()
);

-- Optimizations: composite index for ordered retrieval, user index for RLS, spatial index
CREATE INDEX idx_activity_samples_activity ON activity_samples(activity_id, sample_index);
CREATE INDEX idx_activity_samples_user ON activity_samples(user_id);
CREATE INDEX idx_activity_samples_location ON activity_samples USING GIST(location);

-- Enable RLS
ALTER TABLE activity_samples ENABLE ROW LEVEL SECURITY;
