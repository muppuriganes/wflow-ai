import { cn } from "@/utils/cn";

export interface ProgressBarProps {
  value: number; // 0 to 100
  max?: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
  showLabel = false,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-muted border border-border/40">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-300 ease-out",
            barClassName,
          )}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {showLabel && (
        <div className="flex justify-end text-[11px] font-semibold text-muted">
          <span>{percentage}%</span>
        </div>
      )}
    </div>
  );
}
