import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-foreground placeholder:text-subtle",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15",
        "aria-invalid:border-danger aria-invalid:ring-danger/10 disabled:cursor-not-allowed disabled:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border-strong bg-surface p-2.5 text-[13px] text-foreground placeholder:text-subtle",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15",
        "aria-invalid:border-danger aria-invalid:ring-danger/10 disabled:cursor-not-allowed disabled:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-[13px] text-foreground",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
