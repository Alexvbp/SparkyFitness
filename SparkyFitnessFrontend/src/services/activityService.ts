import { apiCall } from './api';

export interface ActivitySample {
  sample_index: number;
  timestamp_ms: number;
  elapsed_seconds: number | null;
  distance_meters: number | null;
  heart_rate: number | null;
  speed_mps: number | null;
  elevation_meters: number | null;
  latitude: number | null;
  longitude: number | null;
  cadence: number | null;
  power_watts: number | null;
}

export interface ActivityLap {
  id: string;
  lap_number: number;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  calories: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_speed_mps: number | null;
  avg_cadence: number | null;
  elevation_gain_meters: number | null;
  stroke_count: number | null;
  stroke_type: string | null;
  swolf: number | null;
}

export interface HeartRateZone {
  id: string;
  zone_number: number;
  zone_name: string;
  min_bpm: number | null;
  max_bpm: number | null;
  duration_seconds: number | null;
  calories: number | null;
}

export interface Activity {
  id: string;
  user_id: string;
  source: string;
  source_id: string | null;
  activity_type: string;
  activity_subtype: string | null;
  name: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  active_duration_seconds: number | null;
  timezone: string | null;
  calories_total: number | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  elevation_loss_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  steps: number | null;
  route: string | null;
  route_simplified: string | null;
  platform_data: Record<string, unknown> | null;
  laps: ActivityLap[];
  heart_rate_zones: HeartRateZone[];
  samples: ActivitySample[];
}

/**
 * Fetch a single activity by ID with full details (laps, zones, samples)
 */
export async function getActivityById(activityId: string): Promise<Activity> {
  const response = await apiCall<Activity>(`/activities/${activityId}`, {
    method: 'GET',
  });
  return response;
}

/**
 * Fetch activities for a date range
 */
export async function getActivitiesByDateRange(
  startDate: string,
  endDate: string
): Promise<Activity[]> {
  const response = await apiCall<Activity[]>(
    `/activities?startDate=${startDate}&endDate=${endDate}`,
    { method: 'GET' }
  );
  return response;
}
