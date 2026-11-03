import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { CardStatus, type CardStatusTone } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface ActivityCardProps extends ComponentProps<"div"> {
  title: string;
  description?: ReactNode;
  timestamp: string;
  avatar?: string;
  initials?: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  status?: CardStatusTone;
  statusLabel?: string;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
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

export function ActivityCard({
  title,
  description,
  timestamp,
  avatar,
  initials,
  icon: Icon,
  iconTone = "neutral",
  status,
  statusLabel,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
  ...props
}: ActivityCardProps) {
  return (
    <div
      className={cn(cardVariants({ appearance, density }), "flex-row items-center justify-between gap-4", className)}
      {...props}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        {/* Avatar or Icon */}
        {avatar ? (
          <img src={avatar} alt={title} className="size-9 rounded-full object-cover shrink-0" />
        ) : initials ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials}
          </div>
        ) : Icon ? (
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", iconToneStyles[iconTone])}>
            <Icon className="size-4" aria-hidden />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{title}</span>
            {status && statusLabel && <CardStatus tone={status} label={statusLabel} />}
          </div>
          {description && (
            <p className="truncate text-xs text-muted mt-0.5">{description}</p>
          )}
          <span className="text-[11px] text-subtle mt-0.5 block">{timestamp}</span>
        </div>
      </div>

      {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}
