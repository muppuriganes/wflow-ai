import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const iconToneStyles = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-muted text-muted",
  info: "bg-info-soft text-info",
};

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  iconTone = "neutral",
  badge,
  actions,
  className,
}: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 min-w-0", className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && (
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
              iconToneStyles[iconTone]
            )}
          >
            <Icon className="size-4" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground tracking-tight">{title}</h3>
            {badge}
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted leading-relaxed">{subtitle}</p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
}

