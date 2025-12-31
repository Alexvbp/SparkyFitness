import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Heart } from "lucide-react";
import { MetricDataPoint } from "@/services/garminDashboardService";

interface GarminHeartHealthCardProps {
  restingHr: MetricDataPoint[];
  spo2: MetricDataPoint[];
  respiration: MetricDataPoint[];
}

const GarminHeartHealthCard = ({ restingHr, spo2, respiration }: GarminHeartHealthCardProps) => {
  const { t } = useTranslation();

  // Calculate averages
  const avgRestingHr = restingHr.length > 0
    ? Math.round(restingHr.reduce((sum, d) => sum + d.value, 0) / restingHr.length)
    : null;
  const avgSpo2 = spo2.length > 0
    ? Math.round(spo2.reduce((sum, d) => sum + d.value, 0) / spo2.length)
    : null;
  const avgRespiration = respiration.length > 0
    ? Math.round(respiration.reduce((sum, d) => sum + d.value, 0) / respiration.length * 10) / 10
    : null;

  // Merge data for resting HR chart
  const restingHrData = restingHr.map(d => ({
    date: d.date.slice(5),
    value: d.value
  }));

  const hasData = restingHr.length > 0 || spo2.length > 0 || respiration.length > 0;

  if (!hasData) {
    return null;
  }

  return (
    <Card className="dark:text-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5" />
          {t("garmin.heartHealth", "Heart Health")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-red-500">
              {avgRestingHr ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.avgRestingHr", "Avg Resting HR")} (bpm)
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-blue-500">
              {avgSpo2 ?? "--"}%
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.avgSpo2", "Avg SpO2")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-green-500">
              {avgRespiration ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.avgRespiration", "Avg Respiration")} (brpm)
            </div>
          </div>
        </div>

        {/* Resting HR trend chart */}
        {restingHr.length > 0 && (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={restingHrData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                  formatter={(value: number) => [`${value} bpm`, t("garmin.restingHr", "Resting HR")]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GarminHeartHealthCard;
