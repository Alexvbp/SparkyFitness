import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from "lucide-react";
import { MetricDataPoint } from "@/services/garminDashboardService";

interface GarminFitnessCardProps {
  vo2Max: MetricDataPoint[];
  enduranceScore: number | null;
  hillScore: number | null;
  trainingStatus: string | null;
}

const GarminFitnessCard = ({ vo2Max, enduranceScore, hillScore, trainingStatus }: GarminFitnessCardProps) => {
  const { t } = useTranslation();

  const vo2Data = vo2Max.map(d => ({
    date: d.date.slice(5),
    value: d.value
  }));

  const latestVo2 = vo2Max.length > 0 ? vo2Max[vo2Max.length - 1].value : null;

  const hasData = vo2Max.length > 0 || enduranceScore !== null || hillScore !== null || trainingStatus !== null;

  if (!hasData) {
    return null;
  }

  const getTrainingStatusColor = (status: string | null): string => {
    if (!status) return "text-muted-foreground";
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes("productive") || lowerStatus.includes("peaking")) return "text-green-500";
    if (lowerStatus.includes("maintaining") || lowerStatus.includes("recovery")) return "text-blue-500";
    if (lowerStatus.includes("unproductive") || lowerStatus.includes("detraining")) return "text-yellow-500";
    if (lowerStatus.includes("overreaching")) return "text-red-500";
    return "text-foreground";
  };

  return (
    <Card className="dark:text-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          {t("garmin.fitness", "Fitness")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-blue-500">
              {latestVo2 ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.vo2Max", "VO2 Max")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-green-500">
              {enduranceScore ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.enduranceScore", "Endurance")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-orange-500">
              {hillScore ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.hillScore", "Hill Score")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className={`text-lg font-bold ${getTrainingStatusColor(trainingStatus)}`}>
              {trainingStatus ?? "--"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.trainingStatus", "Status")}
            </div>
          </div>
        </div>

        {/* VO2 Max trend chart */}
        {vo2Max.length > 0 && (
          <div>
            <div className="text-sm text-muted-foreground mb-2">
              {t("garmin.vo2MaxTrend", "VO2 Max Trend")} (mL/kg/min)
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={vo2Data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis domain={['dataMin - 2', 'dataMax + 2']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                    formatter={(value: number) => [`${value} mL/kg/min`, t("garmin.vo2Max", "VO2 Max")]}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GarminFitnessCard;
