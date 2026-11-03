import { Activity, Clock, Cpu, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { RadialProgress } from "../analytics/charts";
import { CardHeader } from "../shared/CardHeader";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface AgentHealthCardProps {
  modelName: string;
  provider: string;
  uptimePercent: number; // e.g. 99.8
  p50LatencyMs: number;
  p99LatencyMs: number;
  tokensConsumedToday: number;
  status?: "healthy" | "degraded" | "down";
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function AgentHealthCard({
  modelName,
  provider,
  uptimePercent = 99.8,
  p50LatencyMs,
  p99LatencyMs,
  tokensConsumedToday,
  status = "healthy",
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: AgentHealthCardProps) {
  const isHealthy = status === "healthy";

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={modelName}
        subtitle={`Provider: ${provider}`}
        icon={Cpu}
        iconTone={isHealthy ? "primary" : "warning"}
        badge={
          <CardStatus
            tone={isHealthy ? "success" : "warning"}
            label={status.toUpperCase()}
          />
        }
        actions={actions}
      />

      <div className="flex items-center justify-between gap-4 py-1">
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-muted">Availability</span>
          <p className="text-xl font-bold font-mono text-foreground">{uptimePercent}%</p>
          <span className="text-[10px] text-muted">Uptime over 30d</span>
        </div>

        <div className="shrink-0">
          <RadialProgress
            value={uptimePercent}
            size={56}
            strokeWidth={5}
            color={isHealthy ? "#10b981" : "#f59e0b"}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 text-[11px]">
        <div>
          <span className="text-muted flex items-center gap-1">
            <Clock className="size-3 text-muted" /> p50
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">{p50LatencyMs}ms</p>
        </div>
        <div>
          <span className="text-muted flex items-center gap-1">
            <Activity className="size-3 text-warning" /> p99
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">{p99LatencyMs}ms</p>
        </div>
        <div>
          <span className="text-muted flex items-center gap-1">
            <Zap className="size-3 text-primary" /> Tokens
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">
            {tokensConsumedToday > 1000 ? `${(tokensConsumedToday / 1000).toFixed(1)}k` : tokensConsumedToday}
          </p>
        </div>
      </div>
    </div>
  );
}
