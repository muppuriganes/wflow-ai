import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardEmptyState } from "../shared/CardEmptyState";
import { CardSkeleton } from "../shared/CardSkeleton";
import { CardErrorState } from "../shared/CardErrorState";
import { CardStatus, type CardStatusTone } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface TimelineItem {
  id: string;
  title: string;
  description?: ReactNode;
  timestamp: string;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral" | "info";
  status?: CardStatusTone;
  statusLabel?: string;
  avatar?: string;
  initials?: string;
}

export interface ActivityTimelineCardProps {
  title: string;
  subtitle?: string;
  items: TimelineItem[];
  icon?: LucideIcon;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

const iconToneStyles = {
  primary: "bg-primary text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
  neutral: "bg-surface-muted text-muted",
  info: "bg-info text-white",
};

export function ActivityTimelineCard({
  title,
  subtitle,
  items,
  icon,
  actions,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  empty = false,
  error = null,
  onRetry,
  className,
}: ActivityTimelineCardProps) {
  if (loading) {
    return <CardSkeleton variant="list" className={className} />;
  }

  if (error) {
    return (
      <div className={cn(cardVariants({ appearance, density }), className)}>
        <CardErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className={cn(cardVariants({ appearance, density }), className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={actions}
      />

      {empty || items.length === 0 ? (
        <CardEmptyState title="No recent activity" description="Events will appear here chronologically." />
      ) : (
        <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.id} className="relative flex items-start gap-3 text-xs">
                {/* Timeline node */}
                <div
                  className={cn(
                    "absolute -left-6 top-0 flex size-5.5 items-center justify-center rounded-full ring-4 ring-surface",
                    item.iconTone ? iconToneStyles[item.iconTone] : "bg-primary text-white"
                  )}
                >
                  {Icon ? (
                    <Icon className="size-3" aria-hidden />
                  ) : item.initials ? (
                    <span className="text-[9px] font-bold">{item.initials}</span>
                  ) : (
                    <span className="size-1.5 rounded-full bg-white" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground truncate">{item.title}</span>
                    <span className="shrink-0 text-[11px] text-muted">{item.timestamp}</span>
                  </div>
                  {item.description && (
                    <p className="mt-0.5 text-xs text-muted leading-relaxed">{item.description}</p>
                  )}
                  {item.status && item.statusLabel && (
                    <div className="mt-1">
                      <CardStatus tone={item.status} label={item.statusLabel} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

