#!/usr/bin/env node
/**
 * Migration script to convert existing JSONB activity data to normalized activity_samples table
 *
 * This script:
 * 1. Finds all exercise_entry_activity_details records with Garmin activity data
 * 2. For each, finds the matching activities record
 * 3. Extracts samples from the JSONB activityDetailMetrics using correct metricsIndex
 * 4. Inserts normalized samples into activity_samples table
 *
 * Usage: node scripts/migrateActivitySamples.js [--dry-run]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const dryRun = process.argv.includes('--dry-run');

const pool = new Pool({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: parseInt(process.env.SPARKY_FITNESS_DB_PORT || '5432'),
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_DB_USER,
    password: process.env.SPARKY_FITNESS_DB_PASSWORD,
});

async function transformGarminSamples(details) {
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

async function migrate() {
    const client = await pool.connect();

    try {
        console.log(`Starting migration${dryRun ? ' (DRY RUN)' : ''}...`);

        // Find all exercise_entry_activity_details with Garmin activity data
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
        console.log(`Found ${detailsResult.rows.length} activities to migrate`);

        let totalSamples = 0;
        let migratedActivities = 0;
        let errors = 0;

        for (const row of detailsResult.rows) {
            try {
                const details = row.detail_data?.details;
                if (!details) {
                    console.log(`  Skipping ${row.exercise_entry_id}: no details`);
                    continue;
                }

                const samples = await transformGarminSamples(details);
                if (samples.length === 0) {
                    console.log(`  Skipping ${row.exercise_entry_id}: no samples extracted`);
                    continue;
                }

                console.log(`  Processing activity ${row.activity_id}: ${samples.length} samples`);

                if (!dryRun) {
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
                } else {
                    totalSamples += samples.length;
                }

                migratedActivities++;
            } catch (error) {
                if (!dryRun) {
                    await client.query('ROLLBACK');
                }
                console.error(`  Error processing ${row.exercise_entry_id}:`, error.message);
                errors++;
            }
        }

        console.log(`\nMigration complete${dryRun ? ' (DRY RUN)' : ''}:`);
        console.log(`  - Activities migrated: ${migratedActivities}`);
        console.log(`  - Total samples ${dryRun ? 'would be ' : ''}inserted: ${totalSamples}`);
        console.log(`  - Errors: ${errors}`);

    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
