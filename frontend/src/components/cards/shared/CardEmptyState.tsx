import type { LucideIcon } from "lucide-react";
import { FolderOpen } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface CardEmptyStateProps extends ComponentProps<"div"> {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

export function CardEmptyState({
  title = "No data available",
  description = "Information will appear here once activity starts.",
  icon: Icon = FolderOpen,
  action,
  className,
  ...props
}: CardEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center text-muted",
        className
      )}
      {...props}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-surface-muted text-muted mb-2.5">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted max-w-xs">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

