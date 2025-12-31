const { getClient } = require('../db/poolManager');
const { log } = require('../config/logging');
const externalProviderRepository = require('../models/externalProviderRepository');
const sleepRepository = require('../models/sleepRepository');
const measurementRepository = require('../models/measurementRepository');
const moment = require('moment');

/**
 * Get today's Garmin dashboard data for the widgets
 * Returns: Body Battery, Sleep Score, Training Readiness
 */
async function getDashboardData(userId) {
    log('debug', `[garminDashboardService] getDashboardData called for user: ${userId}`);

    // Check if Garmin is linked
    const provider = await externalProviderRepository.getExternalDataProviderByUserIdAndProviderName(userId, 'garmin');
    if (!provider) {
        log('debug', `[garminDashboardService] No Garmin provider found for user: ${userId}`);
        return { isLinked: false };
    }

    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
    log('debug', `[garminDashboardService] Querying for today: ${today}, yesterday: ${yesterday}`);

    // Get custom categories for the user to find category IDs
    const categories = await measurementRepository.getCustomCategories(userId);
    const categoryMap = {};
    categories.forEach(cat => {
        categoryMap[cat.name] = cat.id;
    });
    log('debug', `[garminDashboardService] Found ${categories.length} custom categories for user`);

    // Fetch Body Battery data
    // Priority: Current (most recent) > At Wake > Highest
    let bodyBattery = null;
    const bodyBatteryCurrentId = categoryMap['Body Battery Current'];
    const bodyBatteryHighestId = categoryMap['Body Battery Highest'];
    const bodyBatteryAtWakeId = categoryMap['Body Battery At Wake'];
    const bodyBatteryChargedId = categoryMap['Body Battery Charged'];
    const bodyBatteryDrainedId = categoryMap['Body Battery Drained'];

    log('debug', `[garminDashboardService] Body Battery category IDs - Current: ${bodyBatteryCurrentId}, Highest: ${bodyBatteryHighestId}, AtWake: ${bodyBatteryAtWakeId}, Charged: ${bodyBatteryChargedId}, Drained: ${bodyBatteryDrainedId}`);

    // Try to get body battery data
    const chargedData = bodyBatteryChargedId
        ? await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryChargedId, today, today)
        : [];
    const drainedData = bodyBatteryDrainedId
        ? await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryDrainedId, today, today)
        : [];

    log('debug', `[garminDashboardService] Body Battery Charged: ${JSON.stringify(chargedData)}, Drained: ${JSON.stringify(drainedData)}`);

    // Try Current (most recent) first, then atWake, then highest as fallback
    let currentValue = null;
    if (bodyBatteryCurrentId) {
        const currentData = await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryCurrentId, today, today);
        if (currentData.length > 0) {
            currentValue = currentData[0].value;
            log('debug', `[garminDashboardService] Using Body Battery Current: ${currentValue}`);
        }
    }
    if (currentValue === null && bodyBatteryAtWakeId) {
        const atWakeData = await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryAtWakeId, today, today);
        if (atWakeData.length > 0) {
            currentValue = atWakeData[0].value;
            log('debug', `[garminDashboardService] Using Body Battery At Wake: ${currentValue}`);
        }
    }
    if (currentValue === null && bodyBatteryHighestId) {
        const highestData = await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryHighestId, today, today);
        if (highestData.length > 0) {
            currentValue = highestData[0].value;
            log('debug', `[garminDashboardService] Using Body Battery Highest as fallback: ${currentValue}`);
        }
    }

    // Build bodyBattery object if we have any data
    if (currentValue !== null || chargedData.length > 0 || drainedData.length > 0) {
        bodyBattery = {
            current: currentValue,
            charged: chargedData.length > 0 ? chargedData[0].value : null,
            drained: drainedData.length > 0 ? drainedData[0].value : null
        };
        log('debug', `[garminDashboardService] Body Battery result: ${JSON.stringify(bodyBattery)}`);
    } else {
        log('debug', `[garminDashboardService] No Body Battery data found for user`);
    }

    // Fetch Sleep data (last night's sleep)
    let sleep = null;
    const sleepEntries = await sleepRepository.getSleepEntriesByUserIdAndDateRange(userId, yesterday, today);
    log('debug', `[garminDashboardService] Sleep entries found: ${sleepEntries.length}`);
    if (sleepEntries.length > 0) {
        const latestSleep = sleepEntries[0];
        log('debug', `[garminDashboardService] Latest sleep: score=${latestSleep.sleep_score}, duration=${latestSleep.duration_in_seconds}`);
        sleep = {
            score: latestSleep.sleep_score,
            durationSeconds: latestSleep.duration_in_seconds
        };
    }

    // Fetch Training Readiness data
    let trainingReadiness = null;
    const trainingReadinessId = categoryMap['Training Readiness Score'];
    log('debug', `[garminDashboardService] Training Readiness category ID: ${trainingReadinessId}`);
    if (trainingReadinessId) {
        const readinessData = await measurementRepository.getCustomMeasurementsByDateRange(userId, trainingReadinessId, today, today);
        log('debug', `[garminDashboardService] Training Readiness data for today: ${JSON.stringify(readinessData)}`);
        if (readinessData.length > 0) {
            const score = readinessData[0].value;
            let status = 'rest';
            if (score >= 70) status = 'ready';
            else if (score >= 40) status = 'moderate';

            trainingReadiness = {
                score: score,
                status: status
            };
        }
    } else {
        log('debug', `[garminDashboardService] No 'Training Readiness Score' category found for user`);
    }

    return {
        isLinked: true,
        date: today,
        bodyBattery,
        sleep,
        trainingReadiness
    };
}

/**
 * Get historical Garmin data for reports
 */
async function getReportsData(userId, startDate, endDate) {
    log('debug', `[garminDashboardService] getReportsData called for user: ${userId}, range: ${startDate} to ${endDate}`);

    // Check if Garmin is linked
    const provider = await externalProviderRepository.getExternalDataProviderByUserIdAndProviderName(userId, 'garmin');
    if (!provider) {
        log('debug', `[garminDashboardService] getReportsData: No Garmin provider found for user`);
        return { isLinked: false };
    }

    // Get custom categories for the user
    const categories = await measurementRepository.getCustomCategories(userId);
    const categoryMap = {};
    categories.forEach(cat => {
        categoryMap[cat.name] = cat.id;
    });
    log('debug', `[garminDashboardService] getReportsData: Found ${categories.length} custom categories. Categories: ${categories.map(c => c.name).join(', ')}`);

    // ===== DIAGNOSTIC: Check which expected categories exist =====
    const expectedCategories = [
        // Recovery
        'Body Battery Current', 'Body Battery Highest', 'Body Battery At Wake',
        'Average Overnight HRV', 'Training Readiness Score',
        // Heart Health
        'Resting Heart Rate', 'Average SpO2', 'Average Respiration Rate',
        // Stress
        'Stress Level', 'Stress Percentage Low', 'Stress Percentage Medium', 'Stress Percentage High',
        // Fitness
        'VO2 Max', 'Endurance Score', 'Hill Score', 'Training Status',
        // Activity
        'Total Intensity Minutes', 'Total Distance', 'Floors Ascended'
    ];
    const missingCategories = expectedCategories.filter(name => !categoryMap[name]);
    const presentCategories = expectedCategories.filter(name => categoryMap[name]);

    log('info', `[GARMIN REPORTS DIAGNOSTIC] ===== CATEGORY AVAILABILITY =====`);
    log('info', `[GARMIN REPORTS DIAGNOSTIC] Present categories (${presentCategories.length}): ${presentCategories.join(', ') || 'none'}`);
    if (missingCategories.length > 0) {
        log('warn', `[GARMIN REPORTS DIAGNOSTIC] Missing categories (${missingCategories.length}): ${missingCategories.join(', ')}`);
        log('warn', `[GARMIN REPORTS DIAGNOSTIC] Missing categories will cause empty report cards. Run a Garmin sync to create them.`);
    }
    log('info', `[GARMIN REPORTS DIAGNOSTIC] ===== END CATEGORY AVAILABILITY =====`);
    // ===== END DIAGNOSTIC =====

    // Helper function to get metric data
    async function getMetricData(categoryName) {
        const categoryId = categoryMap[categoryName];
        if (!categoryId) {
            log('debug', `[garminDashboardService] getReportsData: No category found for '${categoryName}'`);
            return [];
        }
        const data = await measurementRepository.getCustomMeasurementsByDateRange(userId, categoryId, startDate, endDate);
        // Format date consistently - PostgreSQL may return Date objects
        return data.map(d => ({
            date: d.date instanceof Date ? moment(d.date).format('YYYY-MM-DD') : d.date,
            value: d.value
        }));
    }

    // Recovery metrics - try Body Battery Current first, then fallbacks for historical chart
    let bodyBattery = await getMetricData('Body Battery Current');
    if (bodyBattery.length === 0) {
        bodyBattery = await getMetricData('Body Battery Highest');
        log('debug', `[garminDashboardService] getReportsData: Using Body Battery Highest fallback, found ${bodyBattery.length} entries`);
    }
    if (bodyBattery.length === 0) {
        bodyBattery = await getMetricData('Body Battery At Wake');
        log('debug', `[garminDashboardService] getReportsData: Using Body Battery At Wake fallback, found ${bodyBattery.length} entries`);
    }
    let hrv = await getMetricData('Average Overnight HRV');
    const trainingReadinessData = await getMetricData('Training Readiness Score');

    // Heart Health metrics
    let restingHr = await getMetricData('Resting Heart Rate');

    // Fallback: Get HRV and Resting HR from sleep entries if custom measurements are empty
    if (hrv.length === 0 || restingHr.length === 0) {
        const sleepEntries = await sleepRepository.getSleepEntriesByUserIdAndDateRange(userId, startDate, endDate);
        log('debug', `[garminDashboardService] getReportsData: Fallback - found ${sleepEntries.length} sleep entries`);
        if (hrv.length === 0) {
            hrv = sleepEntries
                .filter(s => s.avg_overnight_hrv != null)
                .map(s => ({
                    date: s.entry_date instanceof Date ? moment(s.entry_date).format('YYYY-MM-DD') : s.entry_date,
                    value: parseFloat(s.avg_overnight_hrv)
                }));
        }
        if (restingHr.length === 0) {
            restingHr = sleepEntries
                .filter(s => s.resting_heart_rate != null)
                .map(s => ({
                    date: s.entry_date instanceof Date ? moment(s.entry_date).format('YYYY-MM-DD') : s.entry_date,
                    value: parseInt(s.resting_heart_rate)
                }));
        }
    }
    const spo2 = await getMetricData('Average SpO2');
    const respiration = await getMetricData('Average Respiration Rate');

    // Stress metrics
    const stressLevel = await getMetricData('Stress Level');
    const stressLow = await getMetricData('Stress Percentage Low');
    const stressMedium = await getMetricData('Stress Percentage Medium');
    const stressHigh = await getMetricData('Stress Percentage High');

    // Calculate average stress distribution
    let stressDistribution = null;
    if (stressLow.length > 0 || stressMedium.length > 0 || stressHigh.length > 0) {
        const avgLow = stressLow.length > 0
            ? stressLow.reduce((sum, d) => sum + d.value, 0) / stressLow.length
            : 0;
        const avgMedium = stressMedium.length > 0
            ? stressMedium.reduce((sum, d) => sum + d.value, 0) / stressMedium.length
            : 0;
        const avgHigh = stressHigh.length > 0
            ? stressHigh.reduce((sum, d) => sum + d.value, 0) / stressHigh.length
            : 0;

        stressDistribution = {
            low: Math.round(avgLow),
            medium: Math.round(avgMedium),
            high: Math.round(avgHigh)
        };
    }

    // Fitness metrics
    const vo2Max = await getMetricData('VO2 Max');
    const enduranceScore = await getMetricData('Endurance Score');
    const hillScore = await getMetricData('Hill Score');
    const trainingStatus = await getMetricData('Training Status');

    // Get latest values for scores that don't change frequently
    const latestEndurance = enduranceScore.length > 0 ? enduranceScore[enduranceScore.length - 1].value : null;
    const latestHillScore = hillScore.length > 0 ? hillScore[hillScore.length - 1].value : null;
    const latestTrainingStatus = trainingStatus.length > 0 ? trainingStatus[trainingStatus.length - 1].value : null;

    // Activity metrics
    const activeMinutes = await getMetricData('Total Intensity Minutes');
    const distance = await getMetricData('Total Distance');
    const floors = await getMetricData('Floors Ascended');

    return {
        isLinked: true,
        dateRange: { startDate, endDate },
        recovery: {
            bodyBattery: bodyBattery,
            hrv: hrv,
            trainingReadiness: trainingReadinessData
        },
        heartHealth: {
            restingHr: restingHr,
            spo2: spo2,
            respiration: respiration
        },
        stress: {
            level: stressLevel,
            distribution: stressDistribution
        },
        fitness: {
            vo2Max: vo2Max,
            enduranceScore: latestEndurance,
            hillScore: latestHillScore,
            trainingStatus: latestTrainingStatus
        },
        activity: {
            activeMinutes: activeMinutes,
            distance: distance,
            floors: floors
        }
    };
}

module.exports = {
    getDashboardData,
    getReportsData
};
