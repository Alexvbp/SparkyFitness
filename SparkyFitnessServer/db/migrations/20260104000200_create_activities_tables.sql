-- Activity Type Mappings (lookup table for platform -> normalized type)
CREATE TABLE activity_type_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL,
    platform_type_id VARCHAR(100),
    platform_type_name VARCHAR(100),
    normalized_type VARCHAR(100) NOT NULL,
    normalized_subtype VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(platform, platform_type_id)
);

-- Core Activities Table
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,

    -- Source tracking
    source VARCHAR(50) NOT NULL,
    source_id VARCHAR(255),

    -- Normalized activity type
    activity_type VARCHAR(100) NOT NULL,
    activity_subtype VARCHAR(100),
    name TEXT,

    -- Time
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    active_duration_seconds INTEGER,
    timezone VARCHAR(50),

    -- Universal metrics
    calories_total NUMERIC,
    distance_meters NUMERIC,
    elevation_gain_meters NUMERIC,
    elevation_loss_meters NUMERIC,
    avg_heart_rate INTEGER,
    max_heart_rate INTEGER,
    avg_speed_mps NUMERIC,
    max_speed_mps NUMERIC,
    steps INTEGER,

    -- GPS route (PostGIS)
    route GEOGRAPHY(LINESTRING, 4326),
    route_simplified GEOGRAPHY(LINESTRING, 4326),

    -- Platform-specific extras
    platform_data JSONB,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_user_id UUID
);

-- Activity Laps
CREATE TABLE activity_laps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,

    lap_number INTEGER NOT NULL,
    start_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    distance_meters NUMERIC,
    calories NUMERIC,

    avg_heart_rate INTEGER,
    max_heart_rate INTEGER,
    avg_speed_mps NUMERIC,
    avg_cadence NUMERIC,
    elevation_gain_meters NUMERIC,

    -- Swimming-specific
    stroke_count INTEGER,
    stroke_type VARCHAR(50),
    swolf INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity Heart Rate Zones
CREATE TABLE activity_heart_rate_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,

    zone_number INTEGER NOT NULL,
    zone_name VARCHAR(50),
    min_bpm INTEGER,
    max_bpm INTEGER,
    duration_seconds INTEGER,
    calories NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_activities_user_date ON activities(user_id, start_time DESC);
CREATE INDEX idx_activities_source ON activities(user_id, source, source_id);
CREATE INDEX idx_activities_type ON activities(user_id, activity_type);
CREATE INDEX idx_activities_route ON activities USING GIST(route);
CREATE INDEX idx_activity_laps_activity ON activity_laps(activity_id, lap_number);
CREATE INDEX idx_activity_hr_zones_activity ON activity_heart_rate_zones(activity_id);

-- Seed Garmin activity type mappings
INSERT INTO activity_type_mappings (platform, platform_type_id, platform_type_name, normalized_type, normalized_subtype) VALUES
('garmin', 'running', 'Running', 'running', NULL),
('garmin', 'trail_running', 'Trail Running', 'running', 'trail'),
('garmin', 'treadmill_running', 'Treadmill Running', 'running', 'treadmill'),
('garmin', 'cycling', 'Cycling', 'cycling', NULL),
('garmin', 'indoor_cycling', 'Indoor Cycling', 'cycling', 'indoor'),
('garmin', 'mountain_biking', 'Mountain Biking', 'cycling', 'mountain'),
('garmin', 'lap_swimming', 'Lap Swimming', 'swimming', 'pool'),
('garmin', 'open_water_swimming', 'Open Water Swimming', 'swimming', 'open_water'),
('garmin', 'strength_training', 'Strength Training', 'strength_training', NULL),
('garmin', 'yoga', 'Yoga', 'yoga', NULL),
('garmin', 'pilates', 'Pilates', 'pilates', NULL),
('garmin', 'hiking', 'Hiking', 'hiking', NULL),
('garmin', 'walking', 'Walking', 'walking', NULL),
('garmin', 'elliptical', 'Elliptical', 'elliptical', NULL),
('garmin', 'stair_climbing', 'Stair Climbing', 'stair_climbing', NULL),
('garmin', 'rowing', 'Rowing', 'rowing', NULL),
('garmin', 'indoor_rowing', 'Indoor Rowing', 'rowing', 'indoor'),
('garmin', 'hiit', 'HIIT', 'hiit', NULL),
('garmin', 'cardio', 'Cardio', 'cardio', NULL),
('garmin', 'other', 'Other', 'other', NULL);
