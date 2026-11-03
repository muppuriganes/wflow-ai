import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface MetricProgressCardProps {
  title: string;
  current: number;
  target: number;
  unit?: string;
  valueFormatter?: (val: number) => string;
  description?: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  progressTone?: "primary" | "success" | "warning" | "danger";
  segmented?: boolean;
  segmentsCount?: number;
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

const toneBgStyles = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function MetricProgressCard({
  title,
  current,
  target,
  unit,
  valueFormatter = (v) => v.toLocaleString(),
  description,
  icon: Icon,
  iconTone = "primary",
  progressTone = "primary",
  segmented = false,
  segmentsCount = 5,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  error = null,
  onRetry,
  onClick,
  actions,
  className,
}: MetricProgressCardProps) {
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

  const percent = Math.min(100, Math.max(0, Math.round((current / (target || 1)) * 100)));

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

      <div className="space-y-2 py-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-foreground truncate">
              {valueFormatter(current)}
            </span>
            {unit && <span className="text-xs font-semibold text-muted">{unit}</span>}
          </div>
          <span className="text-xs font-semibold text-muted">
            {percent}% <span className="font-normal text-[11px] text-subtle">of {valueFormatter(target)}</span>
          </span>
        </div>

        {/* Progress Visualization */}
        {segmented ? (
          <div className="flex items-center gap-1.5 w-full">
            {Array.from({ length: segmentsCount }).map((_, idx) => {
              const segThreshold = ((idx + 1) / segmentsCount) * 100;
              const isFilled = percent >= segThreshold;
              return (
                <div
                  key={idx}
                  className={cn(
                    "h-2 flex-1 rounded-sm transition-all duration-300",
                    isFilled ? toneBgStyles[progressTone] : "bg-surface-muted border border-border/40"
                  )}
                />
              );
            })}
          </div>
        ) : (
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted border border-border/40">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                toneBgStyles[progressTone]
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted truncate">{description}</p>
      )}
    </div>
  );
}
