import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export type StatusPillTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

export interface StatusPillProps extends ComponentProps<"div"> {
  tone?: StatusPillTone;
  label: string;
  dot?: boolean;
}

const toneStyles: Record<StatusPillTone, { bg: string; text: string; dot: string; border: string }> = {
  success: {
    bg: "bg-success-soft",
    text: "text-success",
    dot: "bg-success",
    border: "border-success/20",
  },
  warning: {
    bg: "bg-warning-soft",
    text: "text-warning",
    dot: "bg-warning",
    border: "border-warning/20",
  },
  danger: {
    bg: "bg-danger-soft",
    text: "text-danger",
    dot: "bg-danger",
    border: "border-danger/20",
  },
  info: {
    bg: "bg-info-soft",
    text: "text-info",
    dot: "bg-info",
    border: "border-info/20",
  },
  neutral: {
    bg: "bg-surface-muted",
    text: "text-muted",
    dot: "bg-subtle",
    border: "border-border",
  },
  primary: {
    bg: "bg-primary-soft",
    text: "text-primary",
    dot: "bg-primary",
    border: "border-primary/20",
  },
};

export function StatusPill({
  tone = "neutral",
  label,
  dot = true,
  className,
  ...props
}: StatusPillProps) {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4 shadow-xs",
        styles.bg,
        styles.text,
        styles.border,
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 rounded-full shrink-0", styles.dot)} aria-hidden />}
      <span>{label}</span>
    </div>
  );
}
