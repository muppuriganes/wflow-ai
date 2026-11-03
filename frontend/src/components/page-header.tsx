import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground font-sans">{title}</h1>
        {description && <p className="mt-1 text-xs text-muted leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
