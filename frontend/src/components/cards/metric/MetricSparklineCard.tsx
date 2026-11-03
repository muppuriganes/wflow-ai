import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Sparkline } from "../analytics/charts";
import { CardHeader } from "../shared/CardHeader";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { TrendBadge } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface MetricSparklineCardProps {
  title: string;
  value: ReactNode;
  sparklineData: number[];
  unit?: string;
  description?: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  chartColor?: string;
  trend?: {
    value: number | string;
    positive?: boolean;
    neutral?: boolean;
    comparisonLabel?: string;
  };
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function MetricSparklineCard({
  title,
  value,
  sparklineData,
  unit,
  description,
  icon: Icon,
  iconTone = "primary",
  chartColor = "#7c3aed",
  trend,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  error = null,
  onRetry,
  onClick,
  actions,
  className,
}: MetricSparklineCardProps) {
  if (loading) {
    return <CardSkeleton variant="metric" className={className} />;
  }

  if (error) {
    return (
      <div className={cn(cardVariants({ appearance, density }), className)}>
        <CardErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        cardVariants({ appearance, density, interactive: Boolean(onClick) }),
        className
      )}
    >
      <CardHeader
        title={title}
        icon={Icon}
        iconTone={iconTone}
        actions={actions}
      />

      <div className="flex items-end justify-between gap-4 my-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-foreground truncate">
              {value}
            </span>
            {unit && <span className="text-xs font-semibold text-muted">{unit}</span>}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-muted truncate">{description}</p>
          )}
        </div>

        {/* Mini Sparkline */}
        <div className="w-24 shrink-0">
          <Sparkline data={sparklineData} color={chartColor} height={34} />
        </div>
      </div>

      {trend && (
        <div className="flex items-center gap-2 pt-1 text-xs text-muted">
          <TrendBadge
            value={trend.value}
            positive={trend.positive}
            neutral={trend.neutral}
          />
          {trend.comparisonLabel && (
            <span className="truncate text-[11px] text-muted">{trend.comparisonLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
