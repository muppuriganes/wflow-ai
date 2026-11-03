import { useState } from "react";
import { cn } from "@/utils/cn";

export interface BarDataPoint {
  label: string; // e.g. "Mar 24", "Mon", "2026-11-01"
  primary: number; // e.g. Conversations
  secondary: number; // e.g. Leads
}

export interface DualBarChartProps {
  data: BarDataPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  height?: number;
  className?: string;
}

export function DualBarChart({
  data,
  primaryLabel = "Conversations",
  secondaryLabel = "Leads",
  height = 140,
  className,
}: DualBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-xs text-muted", className)} style={{ height }}>
        No chart data available for this range
      </div>
    );
  }

  const maxVal = Math.max(1, ...data.flatMap((d) => [d.primary, d.secondary]));

  return (
    <div className={cn("flex flex-col justify-between w-full select-none", className)}>
      {/* Legend */}
      <div className="flex items-center justify-end gap-4 text-[11px] text-muted mb-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          <span>{primaryLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-purple-300" aria-hidden />
          <span>{secondaryLabel}</span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="relative flex items-end justify-between gap-2 pt-6 pb-2" style={{ height }}>
        {data.map((d, i) => {
          const pHeight = Math.max(4, Math.round((d.primary / maxVal) * (height - 35)));
          const sHeight = Math.max(4, Math.round((d.secondary / maxVal) * (height - 35)));
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={d.label + i}
              className="group relative flex flex-1 flex-col items-center justify-end h-full cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Tooltip on Hover */}
              {isHovered && (
                <div className="absolute -top-7 z-20 flex flex-col items-center rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-white shadow-md pointer-events-none whitespace-nowrap animate-in fade-in zoom-in-95 duration-100">
                  <span>{d.label}</span>
                  <span className="text-purple-200">
                    {primaryLabel}: {d.primary} · {secondaryLabel}: {d.secondary}
                  </span>
                </div>
              )}

              {/* Side-by-side bars */}
              <div className="flex items-end gap-1 w-full max-w-[28px] justify-center">
                <div
                  className={cn(
                    "w-full rounded-t-sm bg-primary transition-all duration-150",
                    isHovered ? "bg-primary-hover opacity-100 ring-2 ring-primary/20" : "opacity-90",
                  )}
                  style={{ height: `${pHeight}px` }}
                />
                <div
                  className={cn(
                    "w-full rounded-t-sm bg-purple-300 transition-all duration-150",
                    isHovered ? "bg-purple-400 opacity-100 ring-2 ring-purple-300/20" : "opacity-90",
                  )}
                  style={{ height: `${sHeight}px` }}
                />
              </div>

              {/* X Axis Label */}
              <span className="mt-2 text-[10px] text-muted truncate max-w-full group-hover:text-foreground group-hover:font-medium transition-colors">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

