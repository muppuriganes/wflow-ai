/**
 * Small, dependency-free charts for the Super Admin dashboard.
 * Specs: bars <= 24px with 4px rounded data-ends, 2px surface gap between stacked segments,
 * hairline recessive gridlines, clean y ticks, legend for >= 2 series, hover tooltip on every
 * column, and a screen-reader table for every chart. Series colors come from the validated
 * categorical palette (slot 1 blue, slot 2 orange); text never wears a series color.
 */
import { useId, useState } from "react";
import { cn } from "@/utils/cn";

export const SERIES = {
  blue: "#2a78d6",
  orange: "#eb6834",
  violet: "#6250d6",
  critical: "#c42b2b",
} as const;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= value) return step * pow;
  return 10 * pow;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export type Series<T> = { key: keyof T & string; label: string; color: string };

/** Daily stacked columns (or a single series) with axes, legend, tooltip and a table view. */
export function ColumnChart<T extends { day: string }>({
  data,
  series,
  height = 200,
  caption,
}: {
  data: T[];
  series: Series<T>[];
  height?: number;
  caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const totals = data.map((d) => series.reduce((sum, s) => sum + Number(d[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const active = hover !== null ? data[hover] : null;

  return (
    <figure className="w-full">
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2" aria-describedby={tableId}>
        {/* y axis */}
        <div className="relative w-8 shrink-0 text-right text-[10px] tabular-nums text-subtle" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / max) * 100}%`, transform: "translateY(50%)" }}>
              {compact.format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-border-strong" : "bg-border/70")} style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
          </div>
          {/* columns */}
          <div className="relative flex items-end" style={{ height }} onMouseLeave={() => setHover(null)}>
            {data.map((d, i) => (
              <div
                key={d.day}
                className="flex h-full flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setHover(i)}
                aria-hidden
              >
                <div className={cn("flex w-full max-w-6 flex-col-reverse gap-[2px] transition-opacity", hover !== null && hover !== i && "opacity-50")}>
                  {series.map((s, si) => {
                    const v = Number(d[s.key] ?? 0);
                    if (!v) return null;
                    const top = series.slice(si + 1).every((n) => !Number(d[n.key] ?? 0));
                    return (
                      <div
                        key={s.key}
                        className={cn("w-full", top && "rounded-t-[4px]")}
                        style={{ height: `${(v / max) * height}px`, background: s.color, minHeight: 2 }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {active && hover !== null && (
              <div
                className="pointer-events-none absolute -top-2 z-10 min-w-36 -translate-y-full rounded-md border bg-surface px-3 py-2 text-xs shadow-overlay"
                style={{
                  left: `${((hover + 0.5) / data.length) * 100}%`,
                  transform: `translate(${hover > data.length * 0.7 ? "-100%" : hover < data.length * 0.3 ? "0" : "-50%"}, -100%)`,
                }}
                role="status"
              >
                <p className="mb-1 font-medium text-foreground">{shortDate(active.day)}</p>
                {series.map((s) => (
                  <p key={s.key} className="flex items-center justify-between gap-4 text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="font-medium tabular-nums text-foreground">{Number(active[s.key] ?? 0).toLocaleString()}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
          {/* x axis */}
          <div className="mt-1.5 flex text-[10px] text-subtle" aria-hidden>
            {data.map((d, i) => (
              <span key={d.day} className="flex-1 text-center">
                {i % labelEvery === 0 || i === data.length - 1 ? shortDate(d.day) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table id={tableId} className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Day</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              {series.map((s) => (
                <td key={s.key}>{Number(d[s.key] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A tiny trend line for a KPI card (single series: no legend, no axis). */
export function Sparkline({ values, color = SERIES.blue, label }: { values: number[]; color?: string; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 32;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const last = pts.at(-1)!;
  return (
    <div className="relative h-8 w-full" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The end dot is HTML so the stretched SVG can't turn it into an oval. */}
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
        style={{ left: "100%", top: `${(last[1] / h) * 100}%`, background: color }}
        aria-hidden
      />
    </div>
  );
}

/** Horizontal share bars (plans, etc.): label, bar, value and percentage. */
export function ShareBars({ items, color = SERIES.blue }: { items: { label: string; value: number }[]; color?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="text-foreground">{i.label}</span>
            <span className="tabular-nums text-muted">
              <span className="font-medium text-foreground">{i.value}</span> · {Math.round((i.value / total) * 100)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-muted">
            <div className="h-2 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One bar split into parts (with the 2px surface gap) plus a legend. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted" role="img"
        aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        {total > 0 &&
          parts.map((p) => (p.value ? <div key={p.label} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))}
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-muted">
              <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
              {p.label}
            </span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{p.value}</span>
              <span className="text-muted"> · {total ? Math.round((p.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
