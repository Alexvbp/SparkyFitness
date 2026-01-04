const { log } = require('../../config/logging');
const activityRepository = require('../../models/activityRepository');

/**
 * Transform Garmin activity data to structured activity format
 * @param {object} garminActivity - Raw Garmin activity data
 * @returns {object} Transformed activity data
 */
async function transformGarminActivity(garminActivity) {
    const { activity, details, splits, hr_in_timezones } = garminActivity;

    if (!activity) {
        throw new Error('Invalid Garmin activity data: missing activity object');
    }

    // Get normalized activity type
    const platformTypeId = activity.activityType?.typeKey || 'other';
    const typeMapping = await activityRepository.getActivityTypeMapping('garmin', platformTypeId);

    const activityType = typeMapping?.normalized_type || platformTypeId;
    const activitySubtype = typeMapping?.normalized_subtype || null;

    // Parse start time
    const startTime = activity.startTimeLocal
        ? new Date(activity.startTimeLocal).toISOString()
        : new Date().toISOString();

    // Calculate end time from duration
    const durationSeconds = activity.duration ? Math.round(activity.duration) : null;
    const endTime = durationSeconds
        ? new Date(new Date(startTime).getTime() + durationSeconds * 1000).toISOString()
        : null;

    // Build route from GPS data if available
    let route = null;
    let routeSimplified = null;

    if (details?.activityDetailMetrics && details?.metricDescriptors) {
        const latIdx = details.metricDescriptors.findIndex(d => d.key === 'directLatitude');
        const lonIdx = details.metricDescriptors.findIndex(d => d.key === 'directLongitude');

        if (latIdx !== -1 && lonIdx !== -1) {
            const points = details.activityDetailMetrics
                .filter(m => m.metrics[latIdx] != null && m.metrics[lonIdx] != null)
                .map(m => `${m.metrics[lonIdx]} ${m.metrics[latIdx]}`);

            if (points.length >= 2) {
                route = `SRID=4326;LINESTRING(${points.join(', ')})`;
                // Simplified version takes every 10th point
                const simplifiedPoints = points.filter((_, i) => i % 10 === 0);
                if (simplifiedPoints.length >= 2) {
                    routeSimplified = `SRID=4326;LINESTRING(${simplifiedPoints.join(', ')})`;
                }
            }
        }
    }

    // Extract platform-specific data
    const platformData = {
        garmin_activity_id: activity.activityId,
        activity_type_key: activity.activityType?.typeKey,
        training_effect_aerobic: activity.aerobicTrainingEffect,
        training_effect_anaerobic: activity.anaerobicTrainingEffect,
        vo2_max: activity.vO2MaxValue,
        training_load: activity.trainingLoad,
        recovery_time: activity.recoveryTime,
        avg_stress: activity.avgStress,
        max_stress: activity.maxStress
    };

    const transformedActivity = {
        source: 'garmin',
        source_id: activity.activityId?.toString(),
        activity_type: activityType,
        activity_subtype: activitySubtype,
        name: activity.activityName || `${typeMapping?.platform_type_name || activityType}`,
        start_time: startTime,
        end_time: endTime,
        duration_seconds: durationSeconds,
        active_duration_seconds: activity.movingDuration ? Math.round(activity.movingDuration) : durationSeconds,
        timezone: activity.timeZoneId || null,
        calories_total: activity.calories || null,
        distance_meters: activity.distance || null,
        elevation_gain_meters: activity.elevationGain || null,
        elevation_loss_meters: activity.elevationLoss || null,
        avg_heart_rate: activity.averageHR || activity.averageHeartRateInBeatsPerMinute || null,
        max_heart_rate: activity.maxHR || activity.maxHeartRateInBeatsPerMinute || null,
        avg_speed_mps: activity.averageSpeed || null,
        max_speed_mps: activity.maxSpeed || null,
        steps: activity.steps || null,
        route: route,
        route_simplified: routeSimplified,
        platform_data: platformData
    };

    return transformedActivity;
}

/**
 * Transform Garmin lap data to activity laps format
 * @param {object} splits - Garmin splits/laps data
 * @returns {array} Transformed laps
 */
function transformGarminLaps(splits) {
    if (!splits?.lapDTOs || !Array.isArray(splits.lapDTOs)) {
        return [];
    }

    return splits.lapDTOs.map((lap, index) => ({
        lap_number: index + 1,
        start_time: lap.startTimeGMT ? new Date(lap.startTimeGMT).toISOString() : null,
        duration_seconds: lap.duration ? Math.round(lap.duration) : null,
        distance_meters: lap.distance || null,
        calories: lap.calories || null,
        avg_heart_rate: lap.averageHR || null,
        max_heart_rate: lap.maxHR || null,
        avg_speed_mps: lap.averageSpeed || null,
        avg_cadence: lap.averageRunCadence || lap.averageBikeCadence || null,
        elevation_gain_meters: lap.elevationGain || null,
        stroke_count: lap.totalStrokes || null,
        stroke_type: lap.swimStroke || null,
        swolf: lap.avgStrokes ? Math.round(lap.avgStrokes + (lap.duration || 0) / (lap.lengths || 1)) : null
    }));
}

/**
 * Transform Garmin HR zone data to activity HR zones format
 * @param {array} hrInTimezones - Garmin HR zones data
 * @returns {array} Transformed HR zones
 */
function transformGarminHeartRateZones(hrInTimezones) {
    if (!hrInTimezones || !Array.isArray(hrInTimezones)) {
        return [];
    }

    const zoneNames = ['Recovery', 'Aerobic', 'Threshold', 'VO2 Max', 'Anaerobic'];

    return hrInTimezones.map((zone, index) => ({
        zone_number: zone.zoneNumber || (index + 1),
        zone_name: zoneNames[index] || `Zone ${index + 1}`,
        min_bpm: zone.zoneLowBoundary || null,
        max_bpm: zone.zoneHighBoundary || null,
        duration_seconds: zone.secsInZone ? Math.round(zone.secsInZone) : null,
        calories: null // Garmin doesn't provide per-zone calories in this format
    }));
}

/**
 * Transform Garmin activity detail metrics to normalized samples
 * @param {object} details - Garmin details object with activityDetailMetrics and metricDescriptors
 * @returns {array} Transformed samples
 */
function transformGarminSamples(details) {
    if (!details?.activityDetailMetrics || !details?.metricDescriptors) {
        return [];
    }

    const metrics = details.activityDetailMetrics;
    const descriptors = details.metricDescriptors;

    // Build index map from descriptors - use highest metricsIndex for each key (handles duplicates)
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
        log('warn', 'No timestamp index found in Garmin metrics, skipping samples');
        return [];
    }

    // Find activity start time (first valid timestamp)
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
        const validSpeed = speed != null && speed >= 0 && speed < 100 ? speed : null; // Max 100 m/s = 360 km/h
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
            power_watts: null // Garmin sends power in a different format, add later if needed
        };
    }).filter(s => s !== null);
}

module.exports = {
    transformGarminActivity,
    transformGarminLaps,
    transformGarminHeartRateZones,
    transformGarminSamples
};
