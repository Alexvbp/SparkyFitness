import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import ZoomableChart from "./ZoomableChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePreferences } from "@/contexts/PreferencesContext";
import { FaRoute, FaClock, FaWalking, FaMountain, FaFire, FaHeartbeat, FaRunning, FaBiking, FaSwimmer, FaTachometerAlt } from 'react-icons/fa';
import ActivityReportLapTable from './ActivityReportLapTable';
import { info, warn, error as logError } from "@/utils/logging";
import ActivityReportMap from './ActivityReportMap';
import WorkoutReportVisualizer from './WorkoutReportVisualizer';
import { Activity, getActivityById } from '@/services/activityService';

interface ActivityReportVisualizerProps {
  exerciseEntryId: string;
  providerName: string; // e.g., 'garmin', 'withings'
}

type XAxisMode = 'timeOfDay' | 'activityDuration' | 'distance';

export interface WorkoutData {
  workoutName: string;
  description?: string;
  sportType?: { sportTypeKey: string };
  estimatedDurationInSecs?: number;
  workoutSegments?: {
    segmentOrder: number;
    workoutSteps: unknown[];
  }[];
}

const ActivityReportVisualizer: React.FC<ActivityReportVisualizerProps> = ({ exerciseEntryId, providerName }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [workoutData, setWorkoutData] = useState<WorkoutData | null>(null);
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>('activityDuration');
  const [mapColorMode, setMapColorMode] = useState<'none' | 'speed' | 'heartRate'>('speed');
  const { distanceUnit, convertDistance, loggingLevel, energyUnit, convertEnergy } = usePreferences();

  const getEnergyUnitString = (unit: 'kcal' | 'kJ'): string => {
    return unit === 'kcal' ? t('common.kcalUnit', 'kcal') : t('common.kJUnit', 'kJ');
  };

  // Helper to detect activity type
  const getActivityType = (): string => {
    return (activity?.activity_type || '').toLowerCase();
  };

  // Get appropriate emoji based on activity type
  const getActivityEmoji = (): string => {
    const type = getActivityType();
    if (type.includes('cycling') || type.includes('biking') || type.includes('bike')) return '🚴';
    if (type.includes('running') || type.includes('run')) return '🏃';
    if (type.includes('swimming') || type.includes('swim')) return '🏊';
    if (type.includes('strength') || type.includes('weight') || type.includes('gym')) return '🏋️';
    if (type.includes('walking') || type.includes('walk') || type.includes('hiking') || type.includes('hike')) return '🚶';
    if (type.includes('yoga')) return '🧘';
    if (type.includes('rowing') || type.includes('row')) return '🚣';
    if (type.includes('skiing') || type.includes('ski')) return '⛷️';
    if (type.includes('snowboard')) return '🏂';
    if (type.includes('elliptical') || type.includes('cardio')) return '🏃';
    return '🏃';
  };

  // Get appropriate icon component based on activity type
  const getSpeedPaceIcon = () => {
    const type = getActivityType();
    if (type.includes('cycling') || type.includes('biking') || type.includes('bike')) return FaBiking;
    if (type.includes('swimming') || type.includes('swim')) return FaSwimmer;
    if (type.includes('running') || type.includes('run')) return FaRunning;
    return FaWalking;
  };

  // Check if activity type typically has distance
  const activityHasDistance = (): boolean => {
    const type = getActivityType();
    if (type.includes('strength') || type.includes('weight') || type.includes('gym') ||
        type.includes('yoga') || type.includes('pilates') || type.includes('stretch')) {
      return false;
    }
    return true;
  };

  // Check if activity type uses pace (running/walking) vs speed (cycling)
  const activityUsesPace = (): boolean => {
    const type = getActivityType();
    if (type.includes('cycling') || type.includes('biking') || type.includes('bike') ||
        type.includes('swimming') || type.includes('swim')) {
      return false;
    }
    return true;
  };

  useEffect(() => {
    const fetchActivityData = async () => {
      try {
        setLoading(true);

        // First, get the exercise entry to find the activity_id
        const entryResponse = await axios.get(`/api/exercise-entries/${exerciseEntryId}`);
        const activityId = entryResponse.data?.activity_id;

        if (activityId) {
          // New path: Fetch from normalized activity API
          const activityData = await getActivityById(activityId);
          setActivity(activityData);
          info(loggingLevel, "Fetched normalized activity data:", JSON.stringify(activityData, null, 2));
        } else {
          // Fallback: Use old provider-specific endpoint during migration
          const apiUrl = `/api/exercises/activity-details/${exerciseEntryId}/${providerName}`;
          const response = await axios.get(apiUrl);

          if (response.data?.activity) {
            // Transform old format to new format for compatibility
            const oldData = response.data.activity;
            const legacyActivity: Activity = {
              id: exerciseEntryId,
              user_id: '',
              source: providerName,
              source_id: null,
              activity_type: oldData.activity?.activityType?.typeKey || 'other',
              activity_subtype: null,
              name: oldData.activity?.activityName || 'Activity',
              start_time: oldData.activity?.startTimeLocal || new Date().toISOString(),
              end_time: null,
              duration_seconds: oldData.activity?.duration || null,
              active_duration_seconds: null,
              timezone: null,
              calories_total: oldData.activity?.calories || null,
              distance_meters: oldData.activity?.distance || null,
              elevation_gain_meters: oldData.activity?.totalAscent || null,
              elevation_loss_meters: null,
              avg_heart_rate: oldData.activity?.averageHR || null,
              max_heart_rate: oldData.activity?.maxHR || null,
              avg_speed_mps: oldData.activity?.averageSpeed || null,
              max_speed_mps: null,
              steps: null,
              route: null,
              route_simplified: null,
              platform_data: oldData.activity,
              laps: transformLegacyLaps(oldData.splits?.lapDTOs),
              heart_rate_zones: transformLegacyZones(oldData.hr_in_timezones),
              samples: transformLegacySamples(oldData.details),
            };
            setActivity(legacyActivity);
          }

          if (response.data?.workout) {
            setWorkoutData(response.data.workout);
          }
        }
      } catch (err) {
        setError(t('reports.activityReport.error', { error: `Failed to fetch activity details.` }));
        logError(loggingLevel, t('reports.activityReport.error', { error: `Failed to fetch activity details.` }), err);
      } finally {
        setLoading(false);
      }
    };

    if (exerciseEntryId) {
      fetchActivityData();
    }
  }, [exerciseEntryId, providerName]);

  // Transform legacy lap data
  const transformLegacyLaps = (lapDTOs: unknown[] | undefined): Activity['laps'] => {
    if (!lapDTOs) return [];
    return lapDTOs.map((lap: unknown, index: number) => {
      const l = lap as Record<string, unknown>;
      return {
        id: String(index),
        lap_number: index + 1,
        start_time: l.startTimeGMT as string || null,
        duration_seconds: l.duration as number || null,
        distance_meters: l.distance as number || null,
        calories: l.calories as number || null,
        avg_heart_rate: l.averageHR as number || null,
        max_heart_rate: l.maxHR as number || null,
        avg_speed_mps: l.averageSpeed as number || null,
        avg_cadence: (l.averageRunCadence as number) || (l.averageBikeCadence as number) || null,
        elevation_gain_meters: l.elevationGain as number || null,
        stroke_count: null,
        stroke_type: null,
        swolf: null,
      };
    });
  };

  // Transform legacy HR zones
  const transformLegacyZones = (zones: unknown[] | undefined): Activity['heart_rate_zones'] => {
    if (!zones) return [];
    const zoneNames = ['Recovery', 'Aerobic', 'Threshold', 'VO2 Max', 'Anaerobic'];
    return zones.map((zone: unknown, index: number) => {
      const z = zone as Record<string, unknown>;
      return {
        id: String(index),
        zone_number: (z.zoneNumber as number) || index + 1,
        zone_name: zoneNames[index] || `Zone ${index + 1}`,
        min_bpm: z.zoneLowBoundary as number || null,
        max_bpm: z.zoneHighBoundary as number || null,
        duration_seconds: z.secsInZone as number || null,
        calories: null,
      };
    });
  };

  // Transform legacy samples from JSONB
  const transformLegacySamples = (details: Record<string, unknown> | undefined): Activity['samples'] => {
    if (!details?.activityDetailMetrics || !details?.metricDescriptors) return [];

    const metrics = details.activityDetailMetrics as Record<string, unknown>[];
    const descriptors = details.metricDescriptors as Record<string, unknown>[];

    // Build index map using highest metricsIndex for each key
    const indexMap: Record<string, number> = {};
    for (const desc of descriptors) {
      const key = desc.key as string;
      const metricsIndex = desc.metricsIndex as number;
      if (!indexMap[key] || metricsIndex > indexMap[key]) {
        indexMap[key] = metricsIndex;
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

    if (timestampIdx === undefined) return [];

    // Find start time
    let startTimestampMs: number | null = null;
    for (const m of metrics) {
      const metricsArr = m.metrics as number[];
      const ts = metricsArr[timestampIdx];
      if (ts != null && !isNaN(ts)) {
        if (startTimestampMs === null || ts < startTimestampMs) {
          startTimestampMs = ts;
        }
      }
    }

    if (startTimestampMs === null) return [];

    return metrics.map((m, index) => {
      const metricsArr = m.metrics as number[];
      const timestamp = metricsArr[timestampIdx];
      if (timestamp == null || isNaN(timestamp)) return null;

      const heartRate = heartRateIdx !== undefined ? metricsArr[heartRateIdx] : null;
      const speed = speedIdx !== undefined ? metricsArr[speedIdx] : null;
      const elevation = elevationIdx !== undefined ? metricsArr[elevationIdx] : null;
      const lat = latIdx !== undefined ? metricsArr[latIdx] : null;
      const lon = lonIdx !== undefined ? metricsArr[lonIdx] : null;
      const cadence = cadenceIdx !== undefined ? metricsArr[cadenceIdx] : null;
      const distance = distanceIdx !== undefined ? metricsArr[distanceIdx] : null;

      return {
        sample_index: index,
        timestamp_ms: timestamp,
        elapsed_seconds: (timestamp - startTimestampMs!) / 1000,
        distance_meters: distance,
        heart_rate: heartRate != null && heartRate > 0 && heartRate < 250 ? Math.round(heartRate) : null,
        speed_mps: speed != null && speed >= 0 && speed < 100 ? speed : null,
        elevation_meters: elevation != null && elevation > -500 && elevation < 9000 ? elevation : null,
        latitude: lat,
        longitude: lon,
        cadence: cadence != null && cadence > 0 && cadence < 300 ? Math.round(cadence) : null,
        power_watts: null,
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
  };

  // Process chart data from normalized samples - much simpler now!
  const processChartData = () => {
    if (!activity?.samples || activity.samples.length === 0) return [];

    const maxPoints = 50;
    const samplingRate = Math.max(1, Math.floor(activity.samples.length / maxPoints));

    const sampledData = activity.samples
      .filter((_, i) => i % samplingRate === 0 || i === activity.samples.length - 1)
      .map(sample => {
        const speed = sample.speed_mps || 0;
        const speedKmh = speed * 3.6;
        const paceMinutesPerKm = speed > 0 ? (1000 / (speed * 60)) : 0;

        return {
          timestamp: sample.timestamp_ms,
          activityDuration: (sample.elapsed_seconds || 0) / 60,
          distance: convertDistance((sample.distance_meters || 0) / 1000, 'km', distanceUnit),
          speed: parseFloat(speed.toFixed(2)),
          speedKmh: parseFloat(speedKmh.toFixed(1)),
          pace: parseFloat(paceMinutesPerKm.toFixed(2)),
          heartRate: sample.heart_rate,
          runCadence: sample.cadence || 0,
          elevation: sample.elevation_meters,
          lat: sample.latitude,
          lon: sample.longitude,
        };
      });

    return sampledData;
  };

  if (loading) {
    return <div>{t('reports.activityReport.loadingActivityReport')}</div>;
  }

  if (error) {
    return <div className="text-red-500">{t('reports.activityReport.error', { error: error })}</div>;
  }

  if (!activity && !workoutData) {
    return <div>{t('reports.activityReport.noActivityDataAvailable')}</div>;
  }

  const allChartData = processChartData();

  // Filter data for charts
  const paceData = allChartData.filter(data => data.speed > 0 && data.speedKmh < 200 && data.pace < 60);
  const heartRateData = allChartData.filter(data => data.heartRate !== null && data.heartRate > 30 && data.heartRate < 250);
  const runCadenceData = allChartData.filter(data => data.runCadence > 0 && data.runCadence < 300);
  const elevationData = allChartData
    .filter(data => data.elevation !== null && data.elevation > -500 && data.elevation < 9000)
    .filter((data, index, arr) => {
      if (index === 0) return true;
      const prevElevation = arr[index - 1]?.elevation;
      if (prevElevation === null || prevElevation === undefined) return true;
      return Math.abs(data.elevation! - prevElevation) < 200;
    });

  // HR zones data
  const hrInTimezonesData = activity?.heart_rate_zones?.map(zone => ({
    name: `Zone ${zone.zone_number} (${zone.min_bpm || 0}+ bpm)`,
    'Time in Zone': zone.duration_seconds ? parseFloat((zone.duration_seconds / 60).toFixed(1)) : 0,
  }));

  // Summary stats from normalized activity
  const totalActivityDurationSeconds = activity?.duration_seconds || 0;
  const totalActivityCalories = activity?.calories_total || 0;
  const totalActivityAscent = activity?.elevation_gain_meters || 0;
  const averageHR = activity?.avg_heart_rate || 0;

  // Get cadence from platform_data if available (Garmin-specific)
  const averageRunCadence = (activity?.platform_data as Record<string, unknown>)?.averageRunCadence as number || 0;

  let totalActivityDistanceForDisplay = 0;
  if (allChartData.length > 0) {
    totalActivityDistanceForDisplay = allChartData[allChartData.length - 1].distance;
  } else if (activity?.distance_meters && activity.distance_meters > 0) {
    totalActivityDistanceForDisplay = convertDistance(activity.distance_meters / 1000, 'km', distanceUnit);
  }

  // Calculate average pace/speed
  let averagePaceForDisplay = 0;
  let averageSpeedKmh = 0;

  if (activity?.avg_speed_mps && activity.avg_speed_mps > 0) {
    averageSpeedKmh = activity.avg_speed_mps * 3.6;
    const paceMinPerKm = 1000 / (activity.avg_speed_mps * 60);
    averagePaceForDisplay = distanceUnit === 'miles' ? paceMinPerKm * 1.60934 : paceMinPerKm;
  } else if (totalActivityDistanceForDisplay > 0 && totalActivityDurationSeconds > 0) {
    const distanceKm = distanceUnit === 'km' ? totalActivityDistanceForDisplay : totalActivityDistanceForDisplay * 1.60934;
    averageSpeedKmh = distanceKm / (totalActivityDurationSeconds / 3600);
    const paceMinPerKm = (totalActivityDurationSeconds / 60) / distanceKm;
    averagePaceForDisplay = distanceUnit === 'miles' ? paceMinPerKm * 1.60934 : paceMinPerKm;
  }

  const totalActivityDurationFormatted = totalActivityDurationSeconds > 0
    ? `${Math.floor(totalActivityDurationSeconds / 60)}:${(totalActivityDurationSeconds % 60).toFixed(0).padStart(2, '0')}`
    : null;
  const totalActivityDistanceFormatted = (totalActivityDistanceForDisplay > 0 && activityHasDistance())
    ? `${totalActivityDistanceForDisplay.toFixed(2)} ${distanceUnit}`
    : null;
  const averagePaceFormatted = (averagePaceForDisplay > 0 && activityUsesPace())
    ? `${averagePaceForDisplay.toFixed(2)} /${distanceUnit === 'km' ? 'km' : 'mi'}`
    : null;
  const averageSpeedFormatted = (averageSpeedKmh > 0 && !activityUsesPace())
    ? `${averageSpeedKmh.toFixed(1)} km/h`
    : null;
  const totalActivityAscentFormatted = totalActivityAscent > 0 ? `${totalActivityAscent.toFixed(0)} m` : null;
  const totalActivityCaloriesFormatted = totalActivityCalories > 0
    ? `${Math.round(convertEnergy(totalActivityCalories, 'kcal', energyUnit))} ${getEnergyUnitString(energyUnit)}`
    : null;
  const averageHRFormatted = averageHR > 0 ? `${averageHR.toFixed(0)} bpm` : null;
  const averageRunCadenceFormatted = averageRunCadence > 0 ? `${averageRunCadence.toFixed(0)} spm` : null;

  const getXAxisDataKey = () => {
    switch (xAxisMode) {
      case 'activityDuration':
        return 'activityDuration';
      case 'distance':
        return 'distance';
      case 'timeOfDay':
      default:
        return 'timestamp';
    }
  };

  const getXAxisLabel = () => {
    switch (xAxisMode) {
      case 'activityDuration':
        return t('reports.activityReport.activityDurationMin');
      case 'distance':
        return t('reports.activityReport.distance') + ` (${distanceUnit === 'km' ? 'km' : 'mi'})`;
      case 'timeOfDay':
      default:
        return t('reports.activityReport.timeOfDayLocal');
    }
  };

  // Build polyline from samples for map (including speed and HR for coloring)
  const polylineData = activity?.samples
    ?.filter(s => s.latitude != null && s.longitude != null)
    .map(s => ({
      lat: s.latitude!,
      lon: s.longitude!,
      speed_mps: s.speed_mps,
      heart_rate: s.heart_rate
    })) || [];

  // Transform laps to old format for ActivityReportLapTable compatibility
  const lapDTOsForTable = activity?.laps?.map(lap => ({
    lapIndex: lap.lap_number,
    startTimeGMT: lap.start_time,
    duration: lap.duration_seconds,
    distance: lap.distance_meters,
    calories: lap.calories,
    averageHR: lap.avg_heart_rate,
    maxHR: lap.max_heart_rate,
    averageSpeed: lap.avg_speed_mps,
    averageRunCadence: lap.avg_cadence,
    elevationGain: lap.elevation_gain_meters,
  }));

  return (
    <div className="activity-report-visualizer p-4">
      <div className="flex items-center mb-4">
        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mr-3">
          <span className="text-xl">{activity ? getActivityEmoji() : '🏋️'}</span>
        </div>
        <h2 className="text-2xl font-bold">{activity?.name || workoutData?.workoutName}</h2>
      </div>

      {activity && (
        <>
          {polylineData.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-semibold">{t('reports.activityReport.activityMap')}</h3>
                <div className="flex gap-1">
                  <button
                    className={`px-2 py-1 rounded text-xs ${mapColorMode === 'speed' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                    onClick={() => setMapColorMode('speed')}
                  >
                    {t('reports.activityReport.speed', 'Speed')}
                  </button>
                  <button
                    className={`px-2 py-1 rounded text-xs ${mapColorMode === 'heartRate' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                    onClick={() => setMapColorMode('heartRate')}
                  >
                    {t('reports.activityReport.heartRate', 'Heart Rate')}
                  </button>
                  <button
                    className={`px-2 py-1 rounded text-xs ${mapColorMode === 'none' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                    onClick={() => setMapColorMode('none')}
                  >
                    {t('reports.activityReport.plain', 'Plain')}
                  </button>
                </div>
              </div>
              <ActivityReportMap polylineData={polylineData} colorMode={mapColorMode} />
            </div>
          )}

          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-2">{t('reports.activityReport.stats')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {totalActivityDurationFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.time')}</CardTitle>
                    <FaClock className="h-5 w-5 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalActivityDurationFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {totalActivityDistanceFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.distance')}</CardTitle>
                    <FaRoute className="h-5 w-5 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalActivityDistanceFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {averageSpeedFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.avgSpeed', 'Avg Speed')}</CardTitle>
                    <FaTachometerAlt className="h-5 w-5 text-purple-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{averageSpeedFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {averagePaceFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.avgPace')}</CardTitle>
                    {React.createElement(getSpeedPaceIcon(), { className: "h-5 w-5 text-purple-500" })}
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{averagePaceFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {totalActivityAscentFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.totalAscent')}</CardTitle>
                    <FaMountain className="h-5 w-5 text-gray-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalActivityAscentFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {totalActivityCaloriesFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.calories')}</CardTitle>
                    <FaFire className="h-5 w-5 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalActivityCaloriesFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {averageHRFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.heartRate')}</CardTitle>
                    <FaHeartbeat className="h-5 w-5 text-pink-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{averageHRFormatted}</div>
                  </CardContent>
                </Card>
              )}
              {averageRunCadenceFormatted && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-sm font-medium">{t('reports.activityReport.cadence', 'Cadence')}</CardTitle>
                    <FaRunning className="h-5 w-5 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{averageRunCadenceFormatted}</div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <div className="mb-4">
            <span className="mr-2">{t('reports.activityReport.xAxis')}</span>
            <button
              className={`px-3 py-1 rounded-md text-sm ${xAxisMode === 'timeOfDay' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-white'}`}
              onClick={() => setXAxisMode('timeOfDay')}
            >
              {t('reports.activityReport.timeOfDay')}
            </button>
            <button
              className={`ml-2 px-3 py-1 rounded-md text-sm ${xAxisMode === 'activityDuration' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-white'}`}
              onClick={() => setXAxisMode('activityDuration')}
            >
              {t('reports.activityReport.duration')}
            </button>
            <button
              className={`ml-2 px-3 py-1 rounded-md text-sm ${xAxisMode === 'distance' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-white'}`}
              onClick={() => setXAxisMode('distance')}
            >
              {t('reports.activityReport.distance')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {paceData.length > 0 && (
              <ZoomableChart title={activityUsesPace() ? t('reports.activityReport.pace', 'Pace') : t('reports.activityReport.speed', 'Speed')}>
                {(isMaximized, zoomLevel) => (
                <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-sm">{activityUsesPace() ? t('reports.activityReport.pace', 'Pace') : t('reports.activityReport.speed', 'Speed')}</CardTitle>
                  </CardHeader>
                  <CardContent className={`flex-grow ${isMaximized ? 'min-h-0 h-full' : ''}`}>
                      <ResponsiveContainer width={`${100 * zoomLevel}%`} height={isMaximized ? `${100 * zoomLevel}%` : 300 * zoomLevel}>
                        <LineChart data={paceData} syncId="activityReportSync">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey={getXAxisDataKey()}
                            label={{ value: getXAxisLabel(), position: 'insideBottom', offset: -5 }}
                            tickFormatter={(value) => {
                              if (xAxisMode === 'activityDuration') return `${value.toFixed(0)}`;
                              if (xAxisMode === 'distance') return `${value.toFixed(1)}`;
                              if (xAxisMode === 'timeOfDay') return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              return value;
                            }}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            label={{
                              value: activityUsesPace() ? 'min/km' : 'km/h',
                              angle: -90,
                              position: 'insideLeft'
                            }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                            labelFormatter={(value) => {
                              if (xAxisMode === 'timeOfDay') {
                                return new Date(value).toLocaleTimeString();
                              }
                              if (xAxisMode === 'activityDuration') {
                                return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                              }
                              if (xAxisMode === 'distance') {
                                return `${Number(value).toFixed(2)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                              }
                              return String(value);
                            }}
                            formatter={(value: number) => activityUsesPace() ? `${value.toFixed(2)} min/km` : `${value.toFixed(1)} km/h`}
                          />
                          <Legend />
                          {activityUsesPace() ? (
                            <Line type="monotone" dataKey="pace" stroke="#8884d8" name={t('reports.activityReport.paceMinPerKm', 'Pace (min/km)')} dot={false} strokeWidth={2} />
                          ) : (
                            <Line type="monotone" dataKey="speedKmh" stroke="#82ca9d" name={t('reports.activityReport.speedKmH', 'Speed (km/h)')} dot={false} strokeWidth={2} />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                  </CardContent>
                </Card>
                )}
              </ZoomableChart>
            )}

            {heartRateData.length > 0 && (
              <ZoomableChart title={t('reports.activityReport.heartRateBpm')}>
                {(isMaximized, zoomLevel) => (
                <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-sm">{t('reports.activityReport.heartRateBpm')}</CardTitle>
                  </CardHeader>
                  <CardContent className={`flex-grow ${isMaximized ? 'min-h-0 h-full' : ''}`}>
                      <ResponsiveContainer width={`${100 * zoomLevel}%`} height={isMaximized ? `${100 * zoomLevel}%` : 300 * zoomLevel}>
                        <LineChart data={heartRateData} syncId="activityReportSync">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey={getXAxisDataKey()}
                            label={{ value: getXAxisLabel(), position: 'insideBottom', offset: -5 }}
                            tickFormatter={(value) => {
                              if (xAxisMode === 'activityDuration') return `${value.toFixed(0)}`;
                              if (xAxisMode === 'distance') return `${value.toFixed(1)}`;
                              if (xAxisMode === 'timeOfDay') return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              return value;
                            }}
                            interval="preserveStartEnd"
                          />
                          <YAxis />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                            labelFormatter={(value) => {
                              if (xAxisMode === 'timeOfDay') {
                                return new Date(value).toLocaleTimeString();
                              }
                              if (xAxisMode === 'activityDuration') {
                                return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                              }
                              if (xAxisMode === 'distance') {
                                return `${Number(value).toFixed(2)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                              }
                              return String(value);
                            }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="heartRate" stroke="#ff7300" name={t('reports.activityReport.heartRateBpm')} dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                  </CardContent>
                </Card>
                )}
              </ZoomableChart>
            )}

            {runCadenceData.length > 0 && (
              <ZoomableChart title={t('reports.activityReport.runCadenceSpM')}>
                {(isMaximized, zoomLevel) => (
                <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-sm">{t('reports.activityReport.runCadenceSpM')}</CardTitle>
                  </CardHeader>
                  <CardContent className={`flex-grow ${isMaximized ? 'min-h-0 h-full' : ''}`}>
                      <ResponsiveContainer width={`${100 * zoomLevel}%`} height={isMaximized ? `${100 * zoomLevel}%` : 300 * zoomLevel}>
                        <LineChart data={runCadenceData} syncId="activityReportSync">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey={getXAxisDataKey()}
                            label={{ value: getXAxisLabel(), position: 'insideBottom', offset: -5 }}
                            tickFormatter={(value) => {
                              if (xAxisMode === 'activityDuration') return `${value.toFixed(0)}`;
                              if (xAxisMode === 'distance') return `${value.toFixed(1)}`;
                              if (xAxisMode === 'timeOfDay') return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              return value;
                            }}
                            interval="preserveStartEnd"
                          />
                          <YAxis />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                            labelFormatter={(value) => {
                              if (xAxisMode === 'timeOfDay') {
                                return new Date(value).toLocaleTimeString();
                              }
                              if (xAxisMode === 'activityDuration') {
                                return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                              }
                              if (xAxisMode === 'distance') {
                                return `${Number(value).toFixed(2)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                              }
                              return String(value);
                            }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="runCadence" stroke="#387900" name={t('reports.activityReport.runCadenceSpM')} dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                  </CardContent>
                </Card>
                )}
              </ZoomableChart>
            )}

            {elevationData.length > 0 && (
              <ZoomableChart title={t('reports.activityReport.elevationM')}>
                {(isMaximized, zoomLevel) => (
                <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-sm">{t('reports.activityReport.elevationM')}</CardTitle>
                  </CardHeader>
                  <CardContent className={`flex-grow ${isMaximized ? 'min-h-0 h-full' : ''}`}>
                      <ResponsiveContainer width={`${100 * zoomLevel}%`} height={isMaximized ? `${100 * zoomLevel}%` : 300 * zoomLevel}>
                        <LineChart data={elevationData} syncId="activityReportSync">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey={getXAxisDataKey()}
                            label={{ value: getXAxisLabel(), position: 'insideBottom', offset: -5 }}
                            tickFormatter={(value) => {
                              if (xAxisMode === 'activityDuration') return `${value.toFixed(0)}`;
                              if (xAxisMode === 'distance') return `${value.toFixed(1)}`;
                              if (xAxisMode === 'timeOfDay') return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              return value;
                            }}
                            interval="preserveStartEnd"
                          />
                          <YAxis />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                            labelFormatter={(value) => {
                              if (xAxisMode === 'timeOfDay') {
                                return new Date(value).toLocaleTimeString();
                              }
                              if (xAxisMode === 'activityDuration') {
                                return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                              }
                              if (xAxisMode === 'distance') {
                                return `${Number(value).toFixed(2)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                              }
                              return String(value);
                            }}
                            formatter={(value: number) => Number(value).toFixed(2)}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="elevation" stroke="#007bff" name={t('reports.activityReport.elevationM')} dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                  </CardContent>
                </Card>
                )}
              </ZoomableChart>
            )}

            {hrInTimezonesData && hrInTimezonesData.length > 0 && (
              <ZoomableChart title={t('reports.activityReport.heartRateTimeInZones')}>
                {(isMaximized, zoomLevel) => (
                <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-sm">{t('reports.activityReport.heartRateTimeInZones')}</CardTitle>
                  </CardHeader>
                  <CardContent className={`flex-grow ${isMaximized ? 'min-h-0 h-full' : ''}`}>
                      <ResponsiveContainer width={`${100 * zoomLevel}%`} height={isMaximized ? `${100 * zoomLevel}%` : 300 * zoomLevel}>
                        <BarChart data={hrInTimezonesData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis label={{ value: t('common.min', 'min'), angle: -90, position: 'insideLeft' }} />
                          <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                              formatter={(value: number) => `${value.toFixed(1)} ${t('common.min', 'min')}`}
                            />
                          <Legend />
                          <Bar dataKey="Time in Zone" fill="#8884d8" name={t('reports.activityReport.timeInZoneMin', 'Time in Zone (min)')} />
                        </BarChart>
                      </ResponsiveContainer>
                  </CardContent>
                </Card>
                )}
              </ZoomableChart>
            )}
          </div>

          {lapDTOsForTable && lapDTOsForTable.length > 0 && (
            <ZoomableChart title={t('reports.activityReport.lapsTable')}>
              {(isMaximized, zoomLevel) => (
                <ActivityReportLapTable lapDTOs={lapDTOsForTable} isMaximized={isMaximized} zoomLevel={zoomLevel} />
              )}
            </ZoomableChart>
          )}
        </>
      )}
      {workoutData && <WorkoutReportVisualizer workoutData={workoutData} />}
    </div>
  );
};

export default ActivityReportVisualizer;
