import { TrendingDown, TrendingUp } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export type CardStatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

export interface CardStatusProps extends ComponentProps<"div"> {
  tone?: CardStatusTone;
  label: string;
  dot?: boolean;
  className?: string;
}

const toneStyles: Record<CardStatusTone, { text: string; dot: string; bg: string }> = {
  success: { text: "text-success", dot: "bg-success", bg: "bg-success-soft" },
  warning: { text: "text-warning", dot: "bg-warning", bg: "bg-warning-soft" },
  danger: { text: "text-danger", dot: "bg-danger", bg: "bg-danger-soft" },
  info: { text: "text-info", dot: "bg-info", bg: "bg-info-soft" },
  neutral: { text: "text-muted", dot: "bg-subtle", bg: "bg-surface-muted" },
  primary: { text: "text-primary", dot: "bg-primary", bg: "bg-primary-soft" },
};

export function CardStatus({ tone = "neutral", label, dot = true, className, ...props }: CardStatusProps) {
  const t = toneStyles[tone];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-tight",
        t.bg,
        t.text,
        className
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />}
      <span>{label}</span>
    </div>
  );
}

export interface TrendBadgeProps {
  value: number | string;
  positive?: boolean;
  neutral?: boolean;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function TrendBadge({
  value,
  positive = true,
  neutral = false,
  prefix = "",
  suffix = "%",
  className,
}: TrendBadgeProps) {
  if (neutral) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold text-muted", className)}>
        {prefix}{value}{suffix}
      </span>
    );
  }

  const isUp = positive;
  const Icon = isUp ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-tight",
        isUp ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      <span>
        {isUp ? "+" : ""}
        {prefix}{value}{suffix}
      </span>
    </span>
  );
}

