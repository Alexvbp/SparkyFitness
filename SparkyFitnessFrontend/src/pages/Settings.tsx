import React, { useState, useEffect } from 'react';
import { usePreferences, GarminReportCards } from "@/contexts/PreferencesContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { toast } from "@/hooks/use-toast";
import { getGarminDashboard } from "@/services/garminDashboardService";
import CustomNutrientsSettings from './CustomNutrientsSettings';

const Settings = () => {
  const { t } = useTranslation();
  const { energyUnit, setEnergyUnit, saveAllPreferences, garminReportCards, setGarminReportCards } = usePreferences();
  const [isGarminLinked, setIsGarminLinked] = useState(false);
  const [garminLoading, setGarminLoading] = useState(true);

  useEffect(() => {
    const checkGarminStatus = async () => {
      try {
        const data = await getGarminDashboard();
        setIsGarminLinked(data?.isLinked ?? false);
      } catch {
        setIsGarminLinked(false);
      } finally {
        setGarminLoading(false);
      }
    };
    checkGarminStatus();
  }, []);

  const handleEnergyUnitChange = async (unit: 'kcal' | 'kJ') => {
    try {
      await setEnergyUnit(unit);
      await saveAllPreferences();
      toast({
        title: t("settings.energyUnit.successTitle", "Success"),
        description: t("settings.energyUnit.successDescription", "Energy unit updated successfully."),
      });
    } catch (error) {
      console.error("Failed to update energy unit:", error);
      toast({
        title: t("settings.energyUnit.errorTitle", "Error"),
        description: t("settings.energyUnit.errorDescription", "Failed to update energy unit."),
        variant: "destructive",
      });
    }
  };

  const handleGarminCardToggle = (card: keyof GarminReportCards, enabled: boolean) => {
    const updatedCards = { ...garminReportCards, [card]: enabled };
    setGarminReportCards(updatedCards);
  };

  return (
    <div className="space-y-6 p-4 md:p-8">
      <h1 className="text-3xl font-bold">{t("settings.title", "Settings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Custom Nutrients</CardTitle>
          <CardDescription>Manage your custom nutrient definitions.</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomNutrientsSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.units.title", "Units")}</CardTitle>
          <CardDescription>{t("settings.units.description", "Manage your preferred units of measurement.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="energy-unit">{t("settings.units.energyUnitLabel", "Energy Unit")}</Label>
            <Select value={energyUnit} onValueChange={handleEnergyUnitChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("settings.units.selectEnergyUnitPlaceholder", "Select energy unit")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kcal">kcal ({t("settings.units.calories", "Calories")})</SelectItem>
                <SelectItem value="kJ">kJ ({t("settings.units.joules", "Joules")})</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("settings.units.energyUnitHint", "Choose your preferred unit for displaying energy values (e.g., calories, kilojoules).")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Garmin Reports Settings - only show when Garmin is linked */}
      {!garminLoading && isGarminLinked && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.garminReports.title", "Garmin Reports")}</CardTitle>
            <CardDescription>{t("settings.garminReports.description", "Choose which cards to display in Garmin health reports.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.garminReports.recovery", "Recovery")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.garminReports.recoveryDesc", "Body Battery, HRV, Training Readiness")}
                </p>
              </div>
              <Switch
                checked={garminReportCards.recovery}
                onCheckedChange={(checked) => handleGarminCardToggle('recovery', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.garminReports.heartHealth", "Heart Health")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.garminReports.heartHealthDesc", "Resting HR, SpO2, Respiration")}
                </p>
              </div>
              <Switch
                checked={garminReportCards.heartHealth}
                onCheckedChange={(checked) => handleGarminCardToggle('heartHealth', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.garminReports.stress", "Stress")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.garminReports.stressDesc", "Stress Level, Distribution")}
                </p>
              </div>
              <Switch
                checked={garminReportCards.stress}
                onCheckedChange={(checked) => handleGarminCardToggle('stress', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.garminReports.fitness", "Fitness")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.garminReports.fitnessDesc", "VO2 Max, Endurance Score, Hill Score")}
                </p>
              </div>
              <Switch
                checked={garminReportCards.fitness}
                onCheckedChange={(checked) => handleGarminCardToggle('fitness', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.garminReports.activity", "Activity")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.garminReports.activityDesc", "Active Minutes, Distance, Floors")}
                </p>
              </div>
              <Switch
                checked={garminReportCards.activity}
                onCheckedChange={(checked) => handleGarminCardToggle('activity', checked)}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Settings;
