import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { TrendBadge } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface MetricComparisonCardProps {
  title: string;
  currentValue: ReactNode;
  previousValue: ReactNode;
  comparisonLabel?: string;
  unit?: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  trend?: {
    value: number | string;
    positive?: boolean;
    neutral?: boolean;
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

export function MetricComparisonCard({
  title,
  currentValue,
  previousValue,
  comparisonLabel = "vs previous period",
  unit,
  icon: Icon,
  iconTone = "neutral",
  trend,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  error = null,
  onRetry,
  onClick,
  actions,
  className,
}: MetricComparisonCardProps) {
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

      <div className="grid grid-cols-2 gap-4 py-1 divide-x divide-border/60">
        <div>
          <span className="text-[11px] font-medium text-muted">Current</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-bold tracking-tight text-foreground truncate">
              {currentValue}
            </span>
            {unit && <span className="text-[11px] font-medium text-muted">{unit}</span>}
          </div>
        </div>

        <div className="pl-4">
          <span className="text-[11px] font-medium text-muted">Previous</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-medium tracking-tight text-muted truncate">
              {previousValue}
            </span>
            {unit && <span className="text-[11px] text-subtle">{unit}</span>}
          </div>
        </div>
      </div>

      {trend && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/40 text-xs text-muted">
          <TrendBadge
            value={trend.value}
            positive={trend.positive}
            neutral={trend.neutral}
          />
          <span className="truncate text-[11px] text-muted">{comparisonLabel}</span>
        </div>
      )}
    </div>
  );
}
