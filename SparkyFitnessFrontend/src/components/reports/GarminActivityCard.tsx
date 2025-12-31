import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Footprints } from "lucide-react";
import { MetricDataPoint } from "@/services/garminDashboardService";

interface GarminActivityCardProps {
  activeMinutes: MetricDataPoint[];
  distance: MetricDataPoint[];
  floors: MetricDataPoint[];
}

const GarminActivityCard = ({ activeMinutes, distance, floors }: GarminActivityCardProps) => {
  const { t } = useTranslation();

  const activeMinutesData = activeMinutes.map(d => ({
    date: d.date.slice(5),
    value: Math.round(d.value)
  }));

  const distanceData = distance.map(d => ({
    date: d.date.slice(5),
    value: Math.round(d.value * 10) / 10
  }));

  const floorsData = floors.map(d => ({
    date: d.date.slice(5),
    value: Math.round(d.value)
  }));

  // Calculate totals
  const totalActiveMinutes = activeMinutes.reduce((sum, d) => sum + d.value, 0);
  const totalDistance = distance.reduce((sum, d) => sum + d.value, 0);
  const totalFloors = floors.reduce((sum, d) => sum + d.value, 0);

  const hasData = activeMinutes.length > 0 || distance.length > 0 || floors.length > 0;

  if (!hasData) {
    return null;
  }

  return (
    <Card className="dark:text-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Footprints className="h-5 w-5" />
          {t("garmin.activity", "Activity")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-green-500">
              {Math.round(totalActiveMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.totalActiveMinutes", "Total Active Min")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-blue-500">
              {totalDistance.toFixed(1)} km
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.totalDistance", "Total Distance")}
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-orange-500">
              {Math.round(totalFloors)}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("garmin.totalFloors", "Total Floors")}
            </div>
          </div>
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Active Minutes bar chart */}
          {activeMinutes.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                {t("garmin.activeMinutesTrend", "Active Minutes")}
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeMinutesData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [`${value} min`, t("garmin.activeMinutes", "Active Minutes")]}
                    />
                    <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Distance line chart */}
          {distance.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                {t("garmin.distanceTrend", "Distance")} (km)
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={distanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [`${value} km`, t("garmin.distance", "Distance")]}
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
        </div>

        {/* Floors chart if we have data */}
        {floors.length > 0 && (
          <div className="mt-4">
            <div className="text-sm text-muted-foreground mb-2">
              {t("garmin.floorsTrend", "Floors Climbed")}
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={floorsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
                    formatter={(value: number) => [`${value}`, t("garmin.floors", "Floors")]}
                  />
                  <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GarminActivityCard;
