import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

export type NotificationSeverity = "info" | "success" | "warning" | "danger";

export interface NotificationCardProps extends ComponentProps<"div"> {
  title: string;
  message: ReactNode;
  severity?: NotificationSeverity;
  timestamp?: string;
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}

const severityConfig = {
  info: { icon: Info, border: "border-info/30", bg: "bg-info-soft/40", text: "text-info" },
  success: { icon: CheckCircle2, border: "border-success/30", bg: "bg-success-soft/40", text: "text-success" },
  warning: { icon: AlertTriangle, border: "border-warning/30", bg: "bg-warning-soft/40", text: "text-warning" },
  danger: { icon: AlertCircle, border: "border-danger/30", bg: "bg-danger-soft/40", text: "text-danger" },
};

export function NotificationCard({
  title,
  message,
  severity = "info",
  timestamp,
  onDismiss,
  action,
  className,
  ...props
}: NotificationCardProps) {
  const cfg = severityConfig[severity];
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-xl border p-4 shadow-xs transition-colors",
        cfg.border,
        cfg.bg,
        className
      )}
      {...props}
    >
      <div className={cn("size-5 shrink-0 mt-0.5", cfg.text)}>
        <Icon className="size-5" aria-hidden />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-foreground tracking-tight">{title}</h4>
          {timestamp && <span className="text-[10px] text-muted">{timestamp}</span>}
        </div>
        <div className="text-xs text-muted leading-relaxed">{message}</div>
        {action && <div className="pt-1.5">{action}</div>}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
