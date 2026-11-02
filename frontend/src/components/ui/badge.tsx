import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-4", {
  variants: {
    tone: {
      neutral: "bg-surface-muted text-muted",
      primary: "bg-primary-soft text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const dotColors: Record<BadgeTone, string> = {
  neutral: "bg-subtle",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Status indicator: a coloured dot plus a text label (colour is never the only signal). */
export function StatusDot({ tone = "neutral", label }: { tone?: BadgeTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className={cn("size-1.5 rounded-full", dotColors[tone])} aria-hidden />
      {label}
    </span>
  );
}
