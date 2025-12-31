import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useActiveUser } from "@/contexts/ActiveUserContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { getGarminReports, GarminReportsData } from "@/services/garminDashboardService";
import { debug, info, error } from "@/utils/logging";
import GarminRecoveryCard from "./GarminRecoveryCard";
import GarminHeartHealthCard from "./GarminHeartHealthCard";
import GarminStressCard from "./GarminStressCard";
import GarminFitnessCard from "./GarminFitnessCard";
import GarminActivityCard from "./GarminActivityCard";

interface GarminHealthReportProps {
  startDate: string;
  endDate: string;
}

const GarminHealthReport = ({ startDate, endDate }: GarminHealthReportProps) => {
  const { t } = useTranslation();
  const { activeUserId } = useActiveUser();
  const { loggingLevel } = usePreferences();
  const [data, setData] = useState<GarminReportsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeUserId && startDate && endDate) {
      fetchGarminData();
    }
  }, [activeUserId, startDate, endDate]);

  const fetchGarminData = async () => {
    setLoading(true);
    try {
      debug(loggingLevel, `GarminHealthReport: Fetching data for ${startDate} to ${endDate}`);
      const reportsData = await getGarminReports(startDate, endDate);
      setData(reportsData);
      info(loggingLevel, "GarminHealthReport: Data fetched successfully", reportsData);
    } catch (err) {
      error(loggingLevel, "GarminHealthReport: Error fetching data", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground">
        {t("garmin.loadingData", "Loading Garmin data...")}
      </div>
    );
  }

  if (!data?.isLinked) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{t("garmin.notLinked", "Garmin is not linked to your account.")}</p>
        <p className="text-sm mt-2">
          {t("garmin.linkInSettings", "You can connect your Garmin account in Settings.")}
        </p>
      </div>
    );
  }

  const hasAnyData =
    (data.recovery?.bodyBattery?.length ?? 0) > 0 ||
    (data.recovery?.hrv?.length ?? 0) > 0 ||
    (data.recovery?.trainingReadiness?.length ?? 0) > 0 ||
    (data.heartHealth?.restingHr?.length ?? 0) > 0 ||
    (data.stress?.level?.length ?? 0) > 0 ||
    (data.fitness?.vo2Max?.length ?? 0) > 0 ||
    (data.activity?.activeMinutes?.length ?? 0) > 0;

  if (!hasAnyData) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{t("garmin.noData", "No Garmin data available for this date range.")}</p>
        <p className="text-sm mt-2">
          {t("garmin.syncHint", "Try syncing your Garmin data in Settings.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GarminRecoveryCard
        bodyBattery={data.recovery?.bodyBattery ?? []}
        hrv={data.recovery?.hrv ?? []}
        trainingReadiness={data.recovery?.trainingReadiness ?? []}
      />

      <GarminHeartHealthCard
        restingHr={data.heartHealth?.restingHr ?? []}
        spo2={data.heartHealth?.spo2 ?? []}
        respiration={data.heartHealth?.respiration ?? []}
      />

      <GarminStressCard
        level={data.stress?.level ?? []}
        distribution={data.stress?.distribution ?? null}
      />

      <GarminFitnessCard
        vo2Max={data.fitness?.vo2Max ?? []}
        enduranceScore={data.fitness?.enduranceScore ?? null}
        hillScore={data.fitness?.hillScore ?? null}
        trainingStatus={data.fitness?.trainingStatus ?? null}
      />

      <GarminActivityCard
        activeMinutes={data.activity?.activeMinutes ?? []}
        distance={data.activity?.distance ?? []}
        floors={data.activity?.floors ?? []}
      />
    </div>
  );
};

export default GarminHealthReport;
