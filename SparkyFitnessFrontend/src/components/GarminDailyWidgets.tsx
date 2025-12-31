import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Battery, Moon, Activity } from "lucide-react";
import { getGarminDashboard, GarminDashboardData } from "@/services/garminDashboardService";

interface GarminDailyWidgetsProps {
  className?: string;
}

const GarminDailyWidgets = ({ className = "" }: GarminDailyWidgetsProps) => {
  const { t } = useTranslation();
  const [data, setData] = useState<GarminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const dashboardData = await getGarminDashboard();
        setData(dashboardData);
        setError(null);
      } catch (err) {
        setError("Failed to load Garmin data");
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Don't render if Garmin is not linked or if there's an error
  if (!loading && (!data?.isLinked || error)) {
    return null;
  }

  // Format duration from seconds to "Xh Xm"
  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return "--";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  // Get status label for training readiness
  const getReadinessLabel = (status: string | undefined): string => {
    switch (status) {
      case "ready":
        return t("garmin.readinessReady", "Ready");
      case "moderate":
        return t("garmin.readinessModerate", "Moderate");
      case "rest":
        return t("garmin.readinessRest", "Rest");
      default:
        return "--";
    }
  };

  // Get color classes for training readiness status
  const getReadinessColor = (status: string | undefined): string => {
    switch (status) {
      case "ready":
        return "text-green-600 dark:text-green-400";
      case "moderate":
        return "text-yellow-600 dark:text-yellow-400";
      case "rest":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${className}`}>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="dark:text-slate-300">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Check if we have any data to display
  const hasBodyBattery = data?.bodyBattery?.current != null;
  const hasSleep = data?.sleep?.score != null;
  const hasReadiness = data?.trainingReadiness?.score != null;

  // Don't render if no data available
  if (!hasBodyBattery && !hasSleep && !hasReadiness) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${className}`}>
      {/* Body Battery Widget */}
      <Card className="dark:text-slate-300">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Battery className="h-4 w-4" />
            <span>{t("garmin.bodyBattery", "Body Battery")}</span>
          </div>
          <div className="text-2xl font-bold">
            {data?.bodyBattery?.current ?? "--"}
          </div>
          {data?.bodyBattery?.charged != null && (
            <div className="text-xs text-muted-foreground">
              +{data.bodyBattery.charged} {t("garmin.charged", "charged")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sleep Score Widget */}
      <Card className="dark:text-slate-300">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Moon className="h-4 w-4" />
            <span>{t("garmin.sleepScore", "Sleep Score")}</span>
          </div>
          <div className="text-2xl font-bold">
            {data?.sleep?.score ?? "--"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDuration(data?.sleep?.durationSeconds)}
          </div>
        </CardContent>
      </Card>

      {/* Training Readiness Widget */}
      <Card className="dark:text-slate-300">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Activity className="h-4 w-4" />
            <span>{t("garmin.trainingReadiness", "Readiness")}</span>
          </div>
          <div className={`text-2xl font-bold ${getReadinessColor(data?.trainingReadiness?.status)}`}>
            {getReadinessLabel(data?.trainingReadiness?.status)}
          </div>
          <div className="text-xs text-muted-foreground">
            {data?.trainingReadiness?.score ?? "--"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GarminDailyWidgets;
