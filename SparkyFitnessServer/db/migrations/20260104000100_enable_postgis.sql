-- Enable PostGIS extension for GPS route storage
CREATE EXTENSION IF NOT EXISTS postgis;

-- Helper function to simplify routes for map rendering
CREATE OR REPLACE FUNCTION simplify_route(route GEOGRAPHY, tolerance FLOAT DEFAULT 10)
RETURNS GEOGRAPHY AS $$
    SELECT ST_Simplify(route::geometry, tolerance)::geography;
$$ LANGUAGE SQL IMMUTABLE;
