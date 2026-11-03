import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { CardEmptyState } from "../shared/CardEmptyState";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface AnalyticsCardProps extends Omit<ComponentProps<"div">, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
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
  emptyTitle?: string;
  emptyDescription?: string;
  error?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
  className?: string;
}

export function AnalyticsCard({
  title,
  subtitle,
  icon,
  badge,
  actions,
  summaryStats,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  empty = false,
  emptyTitle,
  emptyDescription,
  error = null,
  onRetry,
  children,
  className,
  ...props
}: AnalyticsCardProps) {
  if (loading) {
    return <CardSkeleton variant="chart" className={className} />;
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
      className={cn(cardVariants({ appearance, density }), "space-y-4", className)}
      {...props}
    >
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        badge={badge}
        actions={actions}
      />

      {/* Summary KPI row inside analytics card */}
      {summaryStats && summaryStats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2 border-y border-border/60">
          {summaryStats.map((stat, i) => (
            <div key={i} className="space-y-0.5">
              <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
                {stat.label}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-foreground truncate">
                  {stat.value}
                </span>
                {stat.trend && (
                  <span
                    className={cn(
                      "text-[10px] font-semibold",
                      stat.trend.positive ? "text-success" : "text-danger"
                    )}
                  >
                    {stat.trend.positive ? "+" : ""}
                    {stat.trend.value}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {empty ? (
        <CardEmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="min-w-0">{children}</div>
      )}
    </div>
  );
}
