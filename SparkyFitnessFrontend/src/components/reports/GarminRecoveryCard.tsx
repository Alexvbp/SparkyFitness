import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Battery } from "lucide-react";
import { MetricDataPoint } from "@/services/garminDashboardService";

interface GarminRecoveryCardProps {
  bodyBattery: MetricDataPoint[];
  hrv: MetricDataPoint[];
  trainingReadiness: MetricDataPoint[];
}

const GarminRecoveryCard = ({ bodyBattery, hrv, trainingReadiness }: GarminRecoveryCardProps) => {
  const { t } = useTranslation();

  // Merge all data by date for combined chart
  const mergedData = [...new Set([
    ...bodyBattery.map(d => d.date),
    ...hrv.map(d => d.date),
    ...trainingReadiness.map(d => d.date)
  ])].sort().map(date => {
    const bb = bodyBattery.find(d => d.date === date);
    const h = hrv.find(d => d.date === date);
    const tr = trainingReadiness.find(d => d.date === date);
    return {
      date: date.slice(5), // MM-DD format
      bodyBattery: bb?.value ?? null,
      hrv: h?.value ?? null,
      trainingReadiness: tr?.value ?? null
    };
  });

  const hasData = bodyBattery.length > 0 || hrv.length > 0 || trainingReadiness.length > 0;

  if (!hasData) {
    return null;
  }

  return (
    <Card className="dark:text-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Battery className="h-5 w-5" />
          {t("garmin.recovery", "Recovery")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                labelStyle={{ color: 'var(--foreground)' }}
              />
              <Legend />
              {bodyBattery.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="bodyBattery"
                  name={t("garmin.bodyBattery", "Body Battery")}
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
              {hrv.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="hrv"
                  name={t("garmin.hrv", "HRV")}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
              {trainingReadiness.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="trainingReadiness"
                  name={t("garmin.trainingReadiness", "Training Readiness")}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default GarminRecoveryCard;
