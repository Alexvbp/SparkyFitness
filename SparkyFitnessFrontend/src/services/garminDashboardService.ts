import { apiCall } from './api';

export interface GarminBodyBattery {
  current: number | null;
  charged: number | null;
  drained: number | null;
}

export interface GarminSleep {
  score: number | null;
  durationSeconds: number | null;
}

export interface GarminTrainingReadiness {
  score: number | null;
  status: 'ready' | 'moderate' | 'rest';
}

export interface GarminDashboardData {
  isLinked: boolean;
  date?: string;
  bodyBattery?: GarminBodyBattery | null;
  sleep?: GarminSleep | null;
  trainingReadiness?: GarminTrainingReadiness | null;
}

export interface MetricDataPoint {
  date: string;
  value: number;
}

export interface GarminStressDistribution {
  low: number;
  medium: number;
  high: number;
}

export interface GarminReportsData {
  isLinked: boolean;
  dateRange?: {
    startDate: string;
    endDate: string;
  };
  recovery?: {
    bodyBattery: MetricDataPoint[];
    hrv: MetricDataPoint[];
    trainingReadiness: MetricDataPoint[];
  };
  heartHealth?: {
    restingHr: MetricDataPoint[];
    spo2: MetricDataPoint[];
    respiration: MetricDataPoint[];
  };
  stress?: {
    level: MetricDataPoint[];
    distribution: GarminStressDistribution | null;
  };
  fitness?: {
    vo2Max: MetricDataPoint[];
    enduranceScore: number | null;
    hillScore: number | null;
    trainingStatus: string | null;
  };
  activity?: {
    activeMinutes: MetricDataPoint[];
    distance: MetricDataPoint[];
    floors: MetricDataPoint[];
  };
}

export async function getGarminDashboard(): Promise<GarminDashboardData> {
  return await apiCall('/integrations/garmin/dashboard', {
    method: 'GET',
    suppress404Toast: true,
  });
}

export async function getGarminReports(startDate: string, endDate: string): Promise<GarminReportsData> {
  return await apiCall('/integrations/garmin/reports', {
    method: 'GET',
    params: { startDate, endDate },
    suppress404Toast: true,
  });
}
