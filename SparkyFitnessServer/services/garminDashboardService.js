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
        return { isLinked: false };
    }

    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');

    // Get custom categories for the user to find category IDs
    const categories = await measurementRepository.getCustomCategories(userId);
    const categoryMap = {};
    categories.forEach(cat => {
        categoryMap[cat.name] = cat.id;
    });

    // Fetch Body Battery data
    let bodyBattery = null;
    const bodyBatteryAtWakeId = categoryMap['Body Battery At Wake'];
    const bodyBatteryChargedId = categoryMap['Body Battery Charged'];
    const bodyBatteryDrainedId = categoryMap['Body Battery Drained'];

    if (bodyBatteryAtWakeId) {
        const atWakeData = await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryAtWakeId, today, today);
        const chargedData = bodyBatteryChargedId
            ? await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryChargedId, today, today)
            : [];
        const drainedData = bodyBatteryDrainedId
            ? await measurementRepository.getCustomMeasurementsByDateRange(userId, bodyBatteryDrainedId, today, today)
            : [];

        if (atWakeData.length > 0) {
            bodyBattery = {
                current: atWakeData[0].value,
                charged: chargedData.length > 0 ? chargedData[0].value : null,
                drained: drainedData.length > 0 ? drainedData[0].value : null
            };
        }
    }

    // Fetch Sleep data (last night's sleep)
    let sleep = null;
    const sleepEntries = await sleepRepository.getSleepEntriesByUserIdAndDateRange(userId, yesterday, today);
    if (sleepEntries.length > 0) {
        const latestSleep = sleepEntries[0];
        sleep = {
            score: latestSleep.sleep_score,
            durationSeconds: latestSleep.duration_in_seconds
        };
    }

    // Fetch Training Readiness data
    let trainingReadiness = null;
    const trainingReadinessId = categoryMap['Training Readiness Score'];
    if (trainingReadinessId) {
        const readinessData = await measurementRepository.getCustomMeasurementsByDateRange(userId, trainingReadinessId, today, today);
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
        return { isLinked: false };
    }

    // Get custom categories for the user
    const categories = await measurementRepository.getCustomCategories(userId);
    const categoryMap = {};
    categories.forEach(cat => {
        categoryMap[cat.name] = cat.id;
    });

    // Helper function to get metric data
    async function getMetricData(categoryName) {
        const categoryId = categoryMap[categoryName];
        if (!categoryId) return [];
        const data = await measurementRepository.getCustomMeasurementsByDateRange(userId, categoryId, startDate, endDate);
        return data.map(d => ({ date: d.date, value: d.value }));
    }

    // Recovery metrics
    const bodyBatteryAtWake = await getMetricData('Body Battery At Wake');
    const hrv = await getMetricData('Average Overnight HRV');
    const trainingReadinessData = await getMetricData('Training Readiness Score');

    // Heart Health metrics
    const restingHr = await getMetricData('Resting Heart Rate');
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
            bodyBattery: bodyBatteryAtWake,
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
