import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Brain } from "lucide-react";
import { MetricDataPoint, GarminStressDistribution } from "@/services/garminDashboardService";

interface GarminStressCardProps {
  level: MetricDataPoint[];
  distribution: GarminStressDistribution | null;
}

const GarminStressCard = ({ level, distribution }: GarminStressCardProps) => {
  const { t } = useTranslation();

  const stressData = level.map(d => ({
    date: d.date.slice(5),
    value: d.value
  }));

  const pieData = distribution ? [
    { name: t("garmin.stressLow", "Low"), value: distribution.low, color: "#22c55e" },
    { name: t("garmin.stressMedium", "Medium"), value: distribution.medium, color: "#f59e0b" },
    { name: t("garmin.stressHigh", "High"), value: distribution.high, color: "#ef4444" }
  ].filter(d => d.value > 0) : [];

  const hasData = level.length > 0 || (distribution && (distribution.low > 0 || distribution.medium > 0 || distribution.high > 0));

  if (!hasData) {
    return null;
  }

  // Calculate average stress
  const avgStress = level.length > 0
    ? Math.round(level.reduce((sum, d) => sum + d.value, 0) / level.length)
    : null;

  const getStressLabel = (value: number): string => {
    if (value <= 25) return t("garmin.stressLow", "Low");
    if (value <= 50) return t("garmin.stressMedium", "Medium");
    if (value <= 75) return t("garmin.stressModerateHigh", "Moderate-High");
    return t("garmin.stressHigh", "High");
  };

  return (
    <Card className="dark:text-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          {t("garmin.stress", "Stress")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Stress trend chart */}
          {level.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                {t("garmin.stressTrend", "Stress Level Trend")}
                {avgStress !== null && (
                  <span className="ml-2 text-foreground font-medium">
                    (Avg: {avgStress} - {getStressLabel(avgStress)})
                  </span>
                )}
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stressData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [`${value}`, t("garmin.stressLevel", "Stress Level")]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Stress distribution pie chart */}
          {pieData.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                {t("garmin.stressDistribution", "Stress Distribution")}
              </div>
              <div className="h-48 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}%`}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [`${value}%`, ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default GarminStressCard;
