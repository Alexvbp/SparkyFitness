const { getClient, getSystemClient } = require('../db/poolManager');
const { log } = require('../config/logging');

/**
 * Create a new activity record
 * @param {string} userId - The user ID
 * @param {object} activityData - Activity data
 * @param {string} createdByUserId - The user creating this record
 * @returns {object} Created activity
 */
async function createActivity(userId, activityData, createdByUserId) {
    const client = await getClient(userId);
    try {
        await client.query('BEGIN');

        const {
            source,
            source_id,
            activity_type,
            activity_subtype,
            name,
            start_time,
            end_time,
            duration_seconds,
            active_duration_seconds,
            timezone,
            calories_total,
            distance_meters,
            elevation_gain_meters,
            elevation_loss_meters,
            avg_heart_rate,
            max_heart_rate,
            avg_speed_mps,
            max_speed_mps,
            steps,
            route,
            route_simplified,
            platform_data
        } = activityData;

        const query = `
            INSERT INTO activities (
                user_id, source, source_id, activity_type, activity_subtype, name,
                start_time, end_time, duration_seconds, active_duration_seconds, timezone,
                calories_total, distance_meters, elevation_gain_meters, elevation_loss_meters,
                avg_heart_rate, max_heart_rate, avg_speed_mps, max_speed_mps, steps,
                route, route_simplified, platform_data, created_by_user_id
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17, $18, $19, $20,
                $21, $22, $23, $24
            )
            RETURNING *;
        `;

        const values = [
            userId, source, source_id, activity_type, activity_subtype, name,
            start_time, end_time, duration_seconds, active_duration_seconds, timezone,
            calories_total, distance_meters, elevation_gain_meters, elevation_loss_meters,
            avg_heart_rate, max_heart_rate, avg_speed_mps, max_speed_mps, steps,
            route, route_simplified, platform_data, createdByUserId
        ];

        const result = await client.query(query, values);
        await client.query('COMMIT');

        log('info', `Created activity ${result.rows[0].id} for user ${userId}`);
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        log('error', `Error creating activity for user ${userId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Create activity laps
 * @param {string} userId - The user ID
 * @param {string} activityId - The activity ID
 * @param {array} laps - Array of lap data
 * @returns {array} Created laps
 */
async function createActivityLaps(userId, activityId, laps) {
    if (!laps || laps.length === 0) return [];

    const client = await getClient(userId);
    try {
        await client.query('BEGIN');

        const createdLaps = [];
        for (const lap of laps) {
            const query = `
                INSERT INTO activity_laps (
                    activity_id, user_id, lap_number, start_time, duration_seconds,
                    distance_meters, calories, avg_heart_rate, max_heart_rate,
                    avg_speed_mps, avg_cadence, elevation_gain_meters,
                    stroke_count, stroke_type, swolf
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING *;
            `;

            const values = [
                activityId, userId, lap.lap_number, lap.start_time, lap.duration_seconds,
                lap.distance_meters, lap.calories, lap.avg_heart_rate, lap.max_heart_rate,
                lap.avg_speed_mps, lap.avg_cadence, lap.elevation_gain_meters,
                lap.stroke_count, lap.stroke_type, lap.swolf
            ];

            const result = await client.query(query, values);
            createdLaps.push(result.rows[0]);
        }

        await client.query('COMMIT');
        log('info', `Created ${createdLaps.length} laps for activity ${activityId}`);
        return createdLaps;
    } catch (error) {
        await client.query('ROLLBACK');
        log('error', `Error creating laps for activity ${activityId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Create activity heart rate zones
 * @param {string} userId - The user ID
 * @param {string} activityId - The activity ID
 * @param {array} zones - Array of HR zone data
 * @returns {array} Created zones
 */
async function createActivityHeartRateZones(userId, activityId, zones) {
    if (!zones || zones.length === 0) return [];

    const client = await getClient(userId);
    try {
        await client.query('BEGIN');

        const createdZones = [];
        for (const zone of zones) {
            const query = `
                INSERT INTO activity_heart_rate_zones (
                    activity_id, user_id, zone_number, zone_name,
                    min_bpm, max_bpm, duration_seconds, calories
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *;
            `;

            const values = [
                activityId, userId, zone.zone_number, zone.zone_name,
                zone.min_bpm, zone.max_bpm, zone.duration_seconds, zone.calories
            ];

            const result = await client.query(query, values);
            createdZones.push(result.rows[0]);
        }

        await client.query('COMMIT');
        log('info', `Created ${createdZones.length} HR zones for activity ${activityId}`);
        return createdZones;
    } catch (error) {
        await client.query('ROLLBACK');
        log('error', `Error creating HR zones for activity ${activityId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Create activity samples (time-series data)
 * @param {string} userId - The user ID
 * @param {string} activityId - The activity ID
 * @param {array} samples - Array of sample data
 * @returns {number} Number of samples created
 */
async function createActivitySamples(userId, activityId, samples) {
    if (!samples || samples.length === 0) return 0;

    const client = await getClient(userId);
    try {
        await client.query('BEGIN');

        // Batch insert for efficiency - insert all samples without location first
        const insertValues = [];
        const insertParams = [];
        let paramIndex = 1;

        for (const sample of samples) {
            insertParams.push(
                activityId,
                userId,
                sample.sample_index,
                sample.timestamp_ms,
                sample.elapsed_seconds || null,
                sample.distance_meters || null,
                sample.heart_rate || null,
                sample.speed_mps || null,
                sample.elevation_meters || null,
                sample.cadence || null,
                sample.power_watts || null
            );
            insertValues.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        }

        const insertQuery = `
            INSERT INTO activity_samples (
                activity_id, user_id, sample_index, timestamp_ms, elapsed_seconds,
                distance_meters, heart_rate, speed_mps, elevation_meters,
                cadence, power_watts
            )
            VALUES ${insertValues.join(', ')}
        `;

        await client.query(insertQuery, insertParams);

        // Update locations for samples with GPS data
        for (const sample of samples) {
            if (sample.latitude != null && sample.longitude != null) {
                await client.query(`
                    UPDATE activity_samples
                    SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)
                    WHERE activity_id = $3 AND sample_index = $4
                `, [sample.longitude, sample.latitude, activityId, sample.sample_index]);
            }
        }

        await client.query('COMMIT');
        log('info', `Created ${samples.length} samples for activity ${activityId}`);
        return samples.length;
    } catch (error) {
        await client.query('ROLLBACK');
        log('error', `Error creating samples for activity ${activityId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get activity samples
 * @param {string} userId - The user ID
 * @param {string} activityId - The activity ID
 * @returns {array} Array of samples
 */
async function getActivitySamples(userId, activityId) {
    const client = await getClient(userId);
    try {
        const query = `
            SELECT
                sample_index,
                timestamp_ms,
                elapsed_seconds,
                distance_meters,
                heart_rate,
                speed_mps,
                elevation_meters,
                ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude,
                cadence,
                power_watts
            FROM activity_samples
            WHERE activity_id = $1
            ORDER BY sample_index;
        `;

        const result = await client.query(query, [activityId]);
        return result.rows;
    } catch (error) {
        log('error', `Error fetching samples for activity ${activityId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get activities by user and date range
 * @param {string} userId - The user ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {array} Activities
 */
async function getActivitiesByDateRange(userId, startDate, endDate) {
    const client = await getClient(userId);
    try {
        const query = `
            SELECT
                a.*,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', al.id,
                            'lap_number', al.lap_number,
                            'duration_seconds', al.duration_seconds,
                            'distance_meters', al.distance_meters,
                            'avg_heart_rate', al.avg_heart_rate,
                            'avg_speed_mps', al.avg_speed_mps
                        )
                    ) FILTER (WHERE al.id IS NOT NULL),
                    '[]'
                ) as laps,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', hz.id,
                            'zone_number', hz.zone_number,
                            'zone_name', hz.zone_name,
                            'duration_seconds', hz.duration_seconds
                        )
                    ) FILTER (WHERE hz.id IS NOT NULL),
                    '[]'
                ) as heart_rate_zones
            FROM activities a
            LEFT JOIN activity_laps al ON a.id = al.activity_id
            LEFT JOIN activity_heart_rate_zones hz ON a.id = hz.activity_id
            WHERE a.user_id = $1
              AND a.start_time::date BETWEEN $2 AND $3
            GROUP BY a.id
            ORDER BY a.start_time DESC;
        `;

        const result = await client.query(query, [userId, startDate, endDate]);
        return result.rows;
    } catch (error) {
        log('error', `Error fetching activities for user ${userId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get activity by ID with full details including samples
 * @param {string} userId - The user ID
 * @param {string} activityId - The activity ID
 * @returns {object} Activity with laps, zones, and samples
 */
async function getActivityById(userId, activityId) {
    const client = await getClient(userId);
    try {
        const activityQuery = `SELECT * FROM activities WHERE id = $1 AND user_id = $2;`;
        const activityResult = await client.query(activityQuery, [activityId, userId]);

        if (activityResult.rows.length === 0) {
            return null;
        }

        const activity = activityResult.rows[0];

        const lapsQuery = `SELECT * FROM activity_laps WHERE activity_id = $1 ORDER BY lap_number;`;
        const lapsResult = await client.query(lapsQuery, [activityId]);

        const zonesQuery = `SELECT * FROM activity_heart_rate_zones WHERE activity_id = $1 ORDER BY zone_number;`;
        const zonesResult = await client.query(zonesQuery, [activityId]);

        const samplesQuery = `
            SELECT
                sample_index,
                timestamp_ms,
                elapsed_seconds,
                distance_meters,
                heart_rate,
                speed_mps,
                elevation_meters,
                ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude,
                cadence,
                power_watts
            FROM activity_samples
            WHERE activity_id = $1
            ORDER BY sample_index;
        `;
        const samplesResult = await client.query(samplesQuery, [activityId]);

        return {
            ...activity,
            laps: lapsResult.rows,
            heart_rate_zones: zonesResult.rows,
            samples: samplesResult.rows
        };
    } catch (error) {
        log('error', `Error fetching activity ${activityId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Delete activities by source and date range (for re-syncing)
 * @param {string} userId - The user ID
 * @param {string} source - Source platform (e.g., 'garmin')
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {object} Deletion result
 */
async function deleteActivitiesBySourceAndDateRange(userId, source, startDate, endDate) {
    const client = await getClient(userId);
    try {
        await client.query('BEGIN');

        const query = `
            DELETE FROM activities
            WHERE user_id = $1
              AND source = $2
              AND start_time::date BETWEEN $3 AND $4
            RETURNING id;
        `;

        const result = await client.query(query, [userId, source, startDate, endDate]);
        await client.query('COMMIT');

        log('info', `Deleted ${result.rows.length} activities for user ${userId} from ${source} between ${startDate} and ${endDate}`);
        return { deletedCount: result.rows.length };
    } catch (error) {
        await client.query('ROLLBACK');
        log('error', `Error deleting activities for user ${userId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get normalized activity type from platform type
 * @param {string} platform - Platform name (e.g., 'garmin')
 * @param {string} platformTypeId - Platform's type ID
 * @returns {object} Normalized type info or null
 */
async function getActivityTypeMapping(platform, platformTypeId) {
    const client = await getSystemClient();
    try {
        const query = `
            SELECT normalized_type, normalized_subtype, platform_type_name
            FROM activity_type_mappings
            WHERE platform = $1 AND platform_type_id = $2;
        `;

        const result = await client.query(query, [platform, platformTypeId]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        log('error', `Error fetching activity type mapping:`, error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    createActivity,
    createActivityLaps,
    createActivityHeartRateZones,
    createActivitySamples,
    getActivitiesByDateRange,
    getActivityById,
    getActivitySamples,
    deleteActivitiesBySourceAndDateRange,
    getActivityTypeMapping
};
