/**
 * Auto-migration utility to convert existing JSONB activity data to normalized activity_samples table.
 * Runs on server startup if there are unmigrated activities.
 */

const { getSystemClient } = require('../db/poolManager');
const { log } = require('../config/logging');

/**
 * Transform Garmin activity details JSONB to normalized samples
 */
function transformGarminSamples(details) {
    if (!details?.activityDetailMetrics || !details?.metricDescriptors) {
        return [];
    }

    const metrics = details.activityDetailMetrics;
    const descriptors = details.metricDescriptors;

    // Build index map from descriptors - use highest metricsIndex for each key
    const indexMap = {};
    for (const desc of descriptors) {
        if (!indexMap[desc.key] || desc.metricsIndex > indexMap[desc.key]) {
            indexMap[desc.key] = desc.metricsIndex;
        }
    }

    const timestampIdx = indexMap['directTimestamp'];
    const distanceIdx = indexMap['sumDistance'];
    const heartRateIdx = indexMap['directHeartRate'];
    const speedIdx = indexMap['directSpeed'];
    const elevationIdx = indexMap['directElevation'];
    const latIdx = indexMap['directLatitude'];
    const lonIdx = indexMap['directLongitude'];
    const cadenceIdx = indexMap['directRunCadence'] ?? indexMap['directBikeCadence'];

    if (timestampIdx === undefined) {
        return [];
    }

    // Find activity start time
    let startTimestampMs = null;
    for (const m of metrics) {
        const ts = m.metrics[timestampIdx];
        if (ts != null && !isNaN(ts)) {
            if (startTimestampMs === null || ts < startTimestampMs) {
                startTimestampMs = ts;
            }
        }
    }

    if (startTimestampMs === null) {
        return [];
    }

    return metrics.map((m, index) => {
        const timestamp = m.metrics[timestampIdx];
        if (timestamp == null || isNaN(timestamp)) {
            return null;
        }

        const heartRate = heartRateIdx !== undefined ? m.metrics[heartRateIdx] : null;
        const speed = speedIdx !== undefined ? m.metrics[speedIdx] : null;
        const elevation = elevationIdx !== undefined ? m.metrics[elevationIdx] : null;
        const lat = latIdx !== undefined ? m.metrics[latIdx] : null;
        const lon = lonIdx !== undefined ? m.metrics[lonIdx] : null;
        const cadence = cadenceIdx !== undefined ? m.metrics[cadenceIdx] : null;
        const distance = distanceIdx !== undefined ? m.metrics[distanceIdx] : null;

        // Filter invalid values
        const validHeartRate = heartRate != null && heartRate > 0 && heartRate < 250 ? Math.round(heartRate) : null;
        const validSpeed = speed != null && speed >= 0 && speed < 100 ? speed : null;
        const validElevation = elevation != null && elevation > -500 && elevation < 9000 ? elevation : null;
        const validCadence = cadence != null && cadence > 0 && cadence < 300 ? Math.round(cadence) : null;

        return {
            sample_index: index,
            timestamp_ms: Math.round(timestamp),
            elapsed_seconds: (timestamp - startTimestampMs) / 1000,
            distance_meters: distance,
            heart_rate: validHeartRate,
            speed_mps: validSpeed,
            elevation_meters: validElevation,
            latitude: lat,
            longitude: lon,
            cadence: validCadence,
            power_watts: null
        };
    }).filter(s => s !== null);
}

/**
 * Insert samples for an activity
 */
async function insertSamples(client, userId, activityId, samples) {
    if (samples.length === 0) return 0;

    // Batch insert
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

    return samples.length;
}

/**
 * Run migration on startup if needed
 */
async function migrateActivitySamples() {
    const client = await getSystemClient();

    try {
        // First check if there are any activities to migrate
        const countQuery = `
            SELECT COUNT(*) as count
            FROM exercise_entry_activity_details eead
            JOIN exercise_entries ee ON eead.exercise_entry_id = ee.id
            LEFT JOIN activities a ON a.source = 'garmin' AND a.source_id = ee.source_id
            WHERE ee.source = 'garmin'
              AND eead.detail_data ? 'details'
              AND eead.detail_data->'details' ? 'activityDetailMetrics'
              AND a.id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM activity_samples asm WHERE asm.activity_id = a.id LIMIT 1
              )
        `;

        const countResult = await client.query(countQuery);
        const count = parseInt(countResult.rows[0].count, 10);

        if (count === 0) {
            log('info', 'Activity samples migration: No activities to migrate.');
            return;
        }

        log('info', `Activity samples migration: Found ${count} activities to migrate...`);

        // Find all activities that need migration
        const detailsQuery = `
            SELECT
                eead.id,
                eead.exercise_entry_id,
                eead.detail_data,
                ee.user_id,
                ee.source_id,
                a.id as activity_id
            FROM exercise_entry_activity_details eead
            JOIN exercise_entries ee ON eead.exercise_entry_id = ee.id
            LEFT JOIN activities a ON a.source = 'garmin' AND a.source_id = ee.source_id
            WHERE ee.source = 'garmin'
              AND eead.detail_data ? 'details'
              AND eead.detail_data->'details' ? 'activityDetailMetrics'
              AND a.id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM activity_samples asm WHERE asm.activity_id = a.id LIMIT 1
              )
        `;

        const detailsResult = await client.query(detailsQuery);

        let totalSamples = 0;
        let migratedActivities = 0;
        let errors = 0;

        for (const row of detailsResult.rows) {
            try {
                const details = row.detail_data?.details;
                if (!details) {
                    continue;
                }

                const samples = transformGarminSamples(details);
                if (samples.length === 0) {
                    continue;
                }

                await client.query('BEGIN');
                const inserted = await insertSamples(client, row.user_id, row.activity_id, samples);

                // Also update exercise_entries.activity_id if not set
                await client.query(`
                    UPDATE exercise_entries
                    SET activity_id = $1
                    WHERE id = $2 AND activity_id IS NULL
                `, [row.activity_id, row.exercise_entry_id]);

                await client.query('COMMIT');
                totalSamples += inserted;
                migratedActivities++;
            } catch (error) {
                await client.query('ROLLBACK');
                log('error', `Activity samples migration error for ${row.exercise_entry_id}:`, error.message);
                errors++;
            }
        }

        log('info', `Activity samples migration complete: ${migratedActivities} activities, ${totalSamples} samples, ${errors} errors.`);

    } finally {
        client.release();
    }
}

module.exports = {
    migrateActivitySamples,
};
