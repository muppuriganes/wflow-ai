import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AnalyticsCard } from "./AnalyticsCard";
import { DonutChart, type DonutSegment } from "./charts";
import type { CardAppearance, CardDensity } from "../shared/tokens";

export interface DonutChartCardProps {
  title: string;
  subtitle?: string;
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function DonutChartCard({
  title,
  subtitle,
  segments,
  size = 130,
  strokeWidth = 14,
  centerLabel,
  centerValue,
  icon,
  badge,
  actions,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  empty = false,
  error = null,
  onRetry,
  className,
}: DonutChartCardProps) {
  return (
    <AnalyticsCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      badge={badge}
      actions={actions}
      appearance={appearance}
      density={density}
      loading={loading}
      empty={empty || segments.length === 0}
      emptyTitle="No distribution data"
      emptyDescription="Distribution segments will display here."
      error={error}
      onRetry={onRetry}
      className={className}
    >
      <DonutChart
        segments={segments}
        size={size}
        strokeWidth={strokeWidth}
        centerLabel={centerLabel}
        centerValue={centerValue}
      />
    </AnalyticsCard>
  );
}

