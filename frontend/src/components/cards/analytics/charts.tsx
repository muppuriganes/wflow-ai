import { useId, useState } from "react";
import { cn } from "@/utils/cn";

export interface DataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

// ---------------------------------------------------------------------------
// 1. Sparkline (Inline for KPI / metric cards)
// ---------------------------------------------------------------------------
export interface SparklineProps {
  data: number[];
  color?: string;
  fill?: boolean;
  height?: number;
  width?: number | string;
  className?: string;
}

export function Sparkline({
  data,
  color = "#7c3aed",
  fill = true,
  height = 36,
  width = "100%",
  className,
}: SparklineProps) {
  const gradientId = useId();
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const paddingY = 4;
  const innerHeight = height - paddingY * 2;
  const step = 100 / (data.length - 1);

  const points = data.map((val, idx) => {
    const x = idx * step;
    const y = height - paddingY - ((val - min) / range) * innerHeight;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const areaD = `${pathD} L 100,${height} L 0,${height} Z`;

  return (
    <div className={cn("relative overflow-hidden", className)} style={{ height, width }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        {fill && <path d={areaD} fill={`url(#${gradientId})`} />}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Interactive Area Chart with Hover Tooltip
// ---------------------------------------------------------------------------
export interface AreaChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  secondaryColor?: string;
  valueFormatter?: (val: number) => string;
  className?: string;
}

export function AreaChart({
  data,
  height = 200,
  color = "#7c3aed",
  secondaryColor = "#3b82f6",
  valueFormatter = (v) => v.toLocaleString(),
  className,
}: AreaChartProps) {
  const gradId1 = useId();
  const gradId2 = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) return null;

  const hasSecondary = data.some((d) => d.secondaryValue !== undefined);
  const allValues = data.flatMap((d) => [d.value, ...(d.secondaryValue !== undefined ? [d.secondaryValue] : [])]);
  const max = Math.max(...allValues, 10);
  const stepX = 100 / (data.length - 1 || 1);
  const paddingBottom = 24;
  const chartHeight = height - paddingBottom;

  const getPoints = (accessor: (d: DataPoint) => number) =>
    data.map((d, i) => {
      const x = i * stepX;
      const y = chartHeight - (accessor(d) / max) * (chartHeight - 10);
      return { x, y, ...d };
    });

  const p1 = getPoints((d) => d.value);
  const d1 = `M ${p1.map((p) => `${p.x},${p.y}`).join(" L ")}`;
  const area1 = `${d1} L 100,${chartHeight} L 0,${chartHeight} Z`;

  const p2 = hasSecondary ? getPoints((d) => d.secondaryValue ?? 0) : null;
  const d2 = p2 ? `M ${p2.map((p) => `${p.x},${p.y}`).join(" L ")}` : null;
  const area2 = p2 ? `${d2} L 100,${chartHeight} L 0,${chartHeight} Z` : null;

  const active = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className={cn("relative w-full flex flex-col select-none", className)}>
      {/* Tooltip display */}
      <div className="h-7 mb-2 flex items-center justify-between text-xs">
        {active ? (
          <div className="flex items-center gap-3">
            <span className="font-semibold text-foreground">{active.label}:</span>
            <span className="flex items-center gap-1 font-mono font-medium text-purple-600">
              <span className="size-2 rounded-full bg-purple-600" />
              {valueFormatter(active.value)}
            </span>
            {active.secondaryValue !== undefined && (
              <span className="flex items-center gap-1 font-mono font-medium text-blue-600">
                <span className="size-2 rounded-full bg-blue-500" />
                {valueFormatter(active.secondaryValue)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted text-[11px]">Hover over graph points for exact metrics</span>
        )}
      </div>

      <div className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 100 ${chartHeight}`}
          preserveAspectRatio="none"
          className="size-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId1} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
            {hasSecondary && (
              <linearGradient id={gradId2} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.2} />
                <stop offset="100%" stopColor={secondaryColor} stopOpacity={0.0} />
              </linearGradient>
            )}
          </defs>

          {/* Background grid lines */}
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <line
              key={r}
              x1="0"
              y1={chartHeight * (1 - r)}
              x2="100"
              y2={chartHeight * (1 - r)}
              stroke="currentColor"
              strokeDasharray="2,2"
              className="text-border/60"
              strokeWidth="0.5"
            />
          ))}

          {/* Area 1 */}
          <path d={area1} fill={`url(#${gradId1})`} />
          <path d={d1} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />

          {/* Area 2 */}
          {area2 && d2 && (
            <>
              <path d={area2} fill={`url(#${gradId2})`} />
              <path d={d2} fill="none" stroke={secondaryColor} strokeWidth="1.5" strokeDasharray="3,3" strokeLinecap="round" />
            </>
          )}

          {/* Interactive points & guide */}
          {p1.map((p, i) => (
            <g key={i}>
              {hoveredIdx === i && (
                <line
                  x1={p.x}
                  y1={0}
                  x2={p.x}
                  y2={chartHeight}
                  stroke={color}
                  strokeWidth="0.8"
                  strokeDasharray="1,1"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={hoveredIdx === i ? 4 : 2}
                fill={color}
                className="transition-all duration-150"
              />
            </g>
          ))}
        </svg>

        {/* Transparent hover capture columns */}
        <div className="absolute inset-0 flex">
          {data.map((_, i) => (
            <div
              key={i}
              className="flex-1 cursor-crosshair"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between text-[11px] text-muted pt-1 px-1">
        <span>{data[0]?.label}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Bar Chart (Horizontal & Vertical)
// ---------------------------------------------------------------------------
export interface BarChartProps {
  data: DataPoint[];
  layout?: "vertical" | "horizontal";
  color?: string;
  valueFormatter?: (val: number) => string;
  className?: string;
}

export function BarChart({
  data,
  layout = "vertical",
  color = "#7c3aed",
  valueFormatter = (v) => v.toLocaleString(),
  className,
}: BarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);

  if (layout === "horizontal") {
    return (
      <div className={cn("space-y-3", className)}>
        {data.map((d, i) => {
          const pct = Math.round((d.value / max) * 100);
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="space-y-1 text-xs"
            >
              <div className="flex justify-between items-center text-muted">
                <span className={cn("font-medium transition-colors", isHovered && "text-foreground font-semibold")}>
                  {d.label}
                </span>
                <span className="font-mono text-[11px] font-semibold text-foreground">
                  {valueFormatter(d.value)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted border border-border/40">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isHovered ? "#6d28d9" : color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Vertical Bar Chart
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-36 items-end gap-2 border-b border-border pb-1 pt-4">
        {data.map((d, i) => {
          const pct = Math.max(6, Math.round((d.value / max) * 100));
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              className="group relative flex flex-1 flex-col items-center justify-end h-full cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {isHovered && (
                <div className="absolute -top-7 z-10 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background shadow">
                  {valueFormatter(d.value)}
                </div>
              )}
              <div
                className="w-full rounded-t-md transition-all duration-200"
                style={{
                  height: `${pct}%`,
                  backgroundColor: isHovered ? "#6d28d9" : color,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted truncate">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Donut Chart
// ---------------------------------------------------------------------------
export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

export function DonutChart({
  segments,
  size = 130,
  strokeWidth = 14,
  centerLabel,
  centerValue,
  className,
}: DonutChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;

  return (
    <div className={cn("flex items-center gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {segments.map((seg, i) => {
            const percent = seg.value / total;
            const strokeDasharray = `${percent * circumference} ${circumference}`;
            const strokeDashoffset = -(accumulatedPercent * circumference);
            accumulatedPercent += percent;
            const isHovered = hoveredIdx === i;

            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeWidth + 2 : strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="transition-all duration-200 cursor-pointer"
              />
            );
          })}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-sm font-bold text-foreground">
            {hoveredIdx !== null ? (segments[hoveredIdx]?.value ?? "") : centerValue ?? total}
          </span>
          {(centerLabel || hoveredIdx !== null) && (
            <span className="text-[10px] text-muted max-w-[80%] truncate">
              {hoveredIdx !== null ? (segments[hoveredIdx]?.label ?? "") : centerLabel}
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex-1 space-y-2 text-xs">
        {segments.map((seg, i) => (
          <div
            key={i}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            className={cn(
              "flex items-center justify-between gap-2 p-1 rounded-md transition-colors cursor-pointer",
              hoveredIdx === i ? "bg-surface-muted font-semibold text-foreground" : "text-muted"
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="truncate">{seg.label}</span>
            </div>
            <span className="font-mono text-[11px] font-medium">{Math.round((seg.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Radial Progress Gauge
// ---------------------------------------------------------------------------
export interface RadialProgressProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  className?: string;
}

export function RadialProgress({
  value,
  size = 80,
  strokeWidth = 8,
  color = "#7c3aed",
  trackColor = "var(--color-surface-muted, #f1f5f9)",
  label,
  className,
}: RadialProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div className={cn("relative inline-flex flex-col items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs font-bold font-mono text-foreground">{clamped}%</span>
        {label && <span className="text-[9px] text-muted">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Funnel Chart (Stage drop-off visualization)
// ---------------------------------------------------------------------------
export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  className?: string;
}

export function FunnelChart({ stages, className }: FunnelChartProps) {
  const initial = stages[0]?.value || 1;

  return (
    <div className={cn("space-y-3", className)}>
      {stages.map((stage, i) => {
        const pctOfInitial = Math.round((stage.value / initial) * 100);
        const prev = stages[i - 1];
        const dropPct = prev ? Math.round(((prev.value - stage.value) / prev.value) * 100) : null;

        return (
          <div key={i} className="space-y-1 text-xs">
            <div className="flex items-center justify-between text-muted">
              <span className="font-medium text-foreground">{stage.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-foreground">{stage.value.toLocaleString()}</span>
                {dropPct !== null && (
                  <span className="text-[10px] text-danger">-{dropPct}% drop</span>
                )}
              </div>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-md bg-surface-muted border border-border/40">
              <div
                className="h-full rounded-md bg-primary transition-all duration-300"
                style={{
                  width: `${pctOfInitial}%`,
                  backgroundColor: stage.color || undefined,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
