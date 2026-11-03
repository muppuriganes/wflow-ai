import { AlertCircle, RotateCcw } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

export interface CardErrorStateProps extends ComponentProps<"div"> {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function CardErrorState({
  title = "Failed to load data",
  message = "An error occurred while loading this metric.",
  onRetry,
  className,
  ...props
}: CardErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center text-danger",
        className
      )}
      {...props}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger mb-2.5">
        <AlertCircle className="size-5" aria-hidden />
      </div>
      <p className="text-xs font-semibold text-danger">{title}</p>
      {message && <p className="mt-1 text-xs text-muted max-w-xs">{message}</p>}
      {onRetry && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-3 gap-1.5 text-xs h-7.5"
        >
          <RotateCcw className="size-3" /> Retry
        </Button>
      )}
    </div>
  );
}
