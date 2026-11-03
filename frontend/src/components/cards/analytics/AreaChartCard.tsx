import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AnalyticsCard } from "./AnalyticsCard";
import { AreaChart, type DataPoint } from "./charts";
import type { CardAppearance, CardDensity } from "../shared/tokens";

export interface AreaChartCardProps {
  title: string;
  subtitle?: string;
  data: DataPoint[];
  height?: number;
  color?: string;
  secondaryColor?: string;
  valueFormatter?: (val: number) => string;
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  summaryStats?: Array<{
    label: string;
    value: ReactNode;
    trend?: { value: string | number; positive?: boolean };
  }>;
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function AreaChartCard({
  title,
  subtitle,
  data,
  height = 180,
  color = "#7c3aed",
  secondaryColor = "#3b82f6",
  valueFormatter,
  icon,
  badge,
  actions,
  summaryStats,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  empty = false,
  error = null,
  onRetry,
  className,
}: AreaChartCardProps) {
  return (
    <AnalyticsCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      badge={badge}
      actions={actions}
      summaryStats={summaryStats}
      appearance={appearance}
      density={density}
      loading={loading}
      empty={empty || data.length === 0}
      emptyTitle="No time-series data"
      emptyDescription="Analytics will plot here as conversations and workflow events are recorded."
      error={error}
      onRetry={onRetry}
      className={className}
    >
      <AreaChart
        data={data}
        height={height}
        color={color}
        secondaryColor={secondaryColor}
        valueFormatter={valueFormatter}
      />
    </AnalyticsCard>
  );
}
