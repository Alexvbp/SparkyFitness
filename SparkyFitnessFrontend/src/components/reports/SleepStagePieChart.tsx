import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { SleepChartData, SLEEP_STAGE_COLORS } from '@/types';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useTheme } from '@/contexts/ThemeContext';
import { AlertCircle } from 'lucide-react';

interface SleepStagePieChartProps {
  sleepChartData: SleepChartData;
}

const stageLabels: { [key: string]: string } = {
  awake: 'Awake',
  rem: 'REM',
  light: 'Core',
  deep: 'Deep',
};

const SleepStagePieChart: React.FC<SleepStagePieChartProps> = ({ sleepChartData }) => {
  const { t } = useTranslation();
  const { formatDateInUserTimezone, dateFormat } = usePreferences();
  const { resolvedTheme } = useTheme();

  if (!sleepChartData || !sleepChartData.segments || sleepChartData.segments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sleepReport.sleepStages", "Sleep Stages")} - {formatDateInUserTimezone(sleepChartData.date, dateFormat)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{t("sleepReport.noSleepStageDataAvailable", "No sleep stage data available for this entry.")}</p>
        </CardContent>
      </Card>
    );
  }

  // Aggregate durations by stage type
  const stageDurations: { [key: string]: number } = {};
  sleepChartData.segments.forEach(segment => {
    const stageType = segment.stage_type;
    if (stageType && stageLabels[stageType]) {
      const duration = segment.duration_in_seconds ||
        (new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / 1000;
      stageDurations[stageType] = (stageDurations[stageType] || 0) + duration;
    }
  });

  const pieData = Object.entries(stageDurations)
    .filter(([_, duration]) => duration > 0)
    .map(([stageType, duration]) => ({
      name: t(`sleepAnalyticsCharts.${stageType === 'light' ? 'core' : stageType}`, stageLabels[stageType]),
      value: Math.round(duration / 60), // Convert to minutes for display
      seconds: duration,
      color: SLEEP_STAGE_COLORS[stageType],
      stageType,
    }));

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const isDark = resolvedTheme === 'dark';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("sleepReport.sleepStages", "Sleep Stages")} - {formatDateInUserTimezone(sleepChartData.date, dateFormat)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            {t("sleepReport.summaryDataOnly", "Detailed timing not available. Showing stage proportions only.")}
          </p>
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name, props) => [
                  formatDuration(props.payload.seconds),
                  name
                ]}
                contentStyle={{
                  backgroundColor: isDark ? '#1f2937' : '#ffffff',
                  borderColor: isDark ? '#374151' : '#e5e7eb',
                  color: isDark ? '#e5e7eb' : '#1f2937',
                  borderRadius: '0.5rem',
                }}
                itemStyle={{ color: isDark ? '#e5e7eb' : '#1f2937' }}
              />
              <Legend
                wrapperStyle={{ color: isDark ? '#e5e7eb' : '#1f2937' }}
                formatter={(value, entry) => {
                  const item = pieData.find(d => d.name === value);
                  return item ? `${value}: ${formatDuration(item.seconds)}` : value;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default SleepStagePieChart;
