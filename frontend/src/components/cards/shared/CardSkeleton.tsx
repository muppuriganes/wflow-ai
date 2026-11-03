import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export interface CardSkeletonProps extends ComponentProps<"div"> {
  variant?: "metric" | "chart" | "list" | "card";
  className?: string;
}

export function CardSkeleton({ variant = "card", className, ...props }: CardSkeletonProps) {
  if (variant === "metric") {
    return (
      <div
        className={cn(
          "flex flex-col justify-between rounded-xl border border-border bg-surface p-5 animate-pulse gap-3",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 rounded bg-surface-muted" />
          <div className="size-7 rounded-lg bg-surface-muted" />
        </div>
        <div className="space-y-2">
          <div className="h-7 w-20 rounded bg-surface-muted" />
          <div className="h-3 w-36 rounded bg-surface-muted" />
        </div>
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border bg-surface p-5 animate-pulse gap-4",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-4 w-32 rounded bg-surface-muted" />
            <div className="h-3 w-20 rounded bg-surface-muted" />
          </div>
          <div className="h-7 w-24 rounded bg-surface-muted" />
        </div>
        <div className="h-48 w-full rounded-lg bg-surface-muted/60" />
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border bg-surface p-5 animate-pulse gap-3",
          className
        )}
        {...props}
      >
        <div className="h-4 w-32 rounded bg-surface-muted" />
        <div className="space-y-2.5 pt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="size-8 rounded-full bg-surface-muted" />
              <div className="flex-1 space-y-1">
                <div className="h-3.5 w-3/4 rounded bg-surface-muted" />
                <div className="h-2.5 w-1/2 rounded bg-surface-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-5 animate-pulse space-y-3",
        className
      )}
      {...props}
    >
      <div className="h-4 w-1/3 rounded bg-surface-muted" />
      <div className="h-16 w-full rounded bg-surface-muted/50" />
      <div className="h-3 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}
