import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { RadialProgress } from "../analytics/charts";
import { CardHeader } from "../shared/CardHeader";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { CardStatus, TrendBadge } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface MetricCardProps {
  id?: string;
  title?: string;
  label?: string;
  value: ReactNode;
  unit?: string;
  description?: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  trend?: {
    value: number | string;
    positive?: boolean;
    neutral?: boolean;
    comparisonLabel?: string;
  };
  progress?: number; // 0 to 100 for circular progress
  variant?: "minimal" | "trend" | "compact" | "featured" | "split" | "circular";
  appearance?: CardAppearance;
  density?: CardDensity;
  status?: "success" | "warning" | "danger" | "info" | "neutral";
  statusLabel?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function MetricCard({
  title,
  label,
  value,
  unit,
  description,
  icon: Icon,
  iconTone = "neutral",
  trend,
  progress,
  variant = "trend",
  appearance = "outlined",
  density = "comfortable",
  status,
  statusLabel,
  loading = false,
  error = null,
  onRetry,
  onClick,
  actions,
  className,
}: MetricCardProps) {
  const displayTitle = title ?? label ?? "";

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

  const isCompact = variant === "compact" || density === "compact";
  const isFeatured = variant === "featured";
  const isSplit = variant === "split";

  return (
    <div
      onClick={onClick}
      className={cn(
        cardVariants({
          appearance: isFeatured ? "elevated" : appearance,
          density: isCompact ? "compact" : density,
          interactive: Boolean(onClick),
        }),
        isFeatured && "ring-1 ring-primary/20 bg-gradient-to-br from-surface via-surface to-primary-soft/10",
        className
      )}
    >
      {/* Header */}
      <CardHeader
        title={displayTitle}
        icon={Icon}
        iconTone={iconTone}
        badge={
          status && statusLabel ? (
            <CardStatus tone={status} label={statusLabel} />
          ) : undefined
        }
        actions={actions}
      />

      {/* Main Value & Metrics */}
      <div className={cn("flex", isSplit ? "items-center justify-between gap-4" : "flex-col gap-1")}>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-bold tracking-tight text-foreground truncate",
                isCompact ? "text-xl" : isFeatured ? "text-3xl" : "text-2xl"
              )}
            >
              {value}
            </span>
            {unit && <span className="text-xs font-semibold text-muted">{unit}</span>}
          </div>

          {/* Description or trend comparison */}
          {description && (
            <p className="mt-1 text-xs text-muted leading-relaxed line-clamp-1">{description}</p>
          )}
        </div>

        {/* Circular progress variant */}
        {variant === "circular" && progress !== undefined && (
          <div className="shrink-0">
            <RadialProgress value={progress} size={isCompact ? 56 : 64} strokeWidth={6} />
          </div>
        )}
      </div>

      {/* Trend footer / comparison */}
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
