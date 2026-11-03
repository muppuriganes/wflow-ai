import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  trend?: {
    value: string;
    positive?: boolean;
    neutral?: boolean;
  };
  subtitle?: string;
  className?: string;
  onClick?: () => void;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  subtitle,
  className,
  onClick,
}: MetricCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex flex-col justify-between rounded-lg border border-border bg-surface p-4 transition-all duration-150 shadow-card hover:shadow-card-hover",
        onClick && "cursor-pointer hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted truncate">{label}</span>
        {Icon && (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted group-hover:bg-primary-soft group-hover:text-primary transition-colors">
            <Icon className="size-3.5" aria-hidden />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-xl font-bold tracking-tight text-foreground truncate">{value}</div>
        {trend && (
          <div
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none shrink-0",
              trend.neutral
                ? "bg-surface-muted text-muted"
                : trend.positive !== false
                  ? "bg-success-soft text-success"
                  : "bg-danger-soft text-danger",
            )}
          >
            {trend.positive !== false && !trend.neutral ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : !trend.neutral ? (
              <TrendingDown className="size-3" aria-hidden />
            ) : null}
            <span>{trend.value}</span>
          </div>
        )}
      </div>

      {subtitle && <p className="mt-1 text-[11px] text-muted truncate">{subtitle}</p>}
    </div>
  );
}
