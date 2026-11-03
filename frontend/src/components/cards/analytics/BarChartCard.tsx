import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AnalyticsCard } from "./AnalyticsCard";
import { BarChart, type DataPoint } from "./charts";
import type { CardAppearance, CardDensity } from "../shared/tokens";

export interface BarChartCardProps {
  title: string;
  subtitle?: string;
  data: DataPoint[];
  layout?: "vertical" | "horizontal";
  color?: string;
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

export function BarChartCard({
  title,
  subtitle,
  data,
  layout = "vertical",
  color = "#7c3aed",
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
}: BarChartCardProps) {
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
      emptyTitle="No categorical data"
      emptyDescription="Categories will populate once data is logged."
      error={error}
      onRetry={onRetry}
      className={className}
    >
      <BarChart
        data={data}
        layout={layout}
        color={color}
        valueFormatter={valueFormatter}
      />
    </AnalyticsCard>
  );
}

