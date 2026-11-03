import { CheckCircle2, Clock, Sparkles, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Sparkline } from "../analytics/charts";
import { CardHeader } from "../shared/CardHeader";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface WorkflowPerformanceCardProps {
  workflowName: string;
  successRate: number; // 0 to 100
  totalExecutions: number;
  failedCount: number;
  avgDurationMs: number;
  executionHistory?: number[];
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function WorkflowPerformanceCard({
  workflowName,
  successRate,
  totalExecutions,
  failedCount,
  avgDurationMs,
  executionHistory = [12, 18, 15, 22, 28, 24, 30],
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: WorkflowPerformanceCardProps) {
  const isHealthy = successRate >= 95;

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={workflowName}
        subtitle="Execution performance & health metrics"
        icon={Sparkles}
        iconTone={isHealthy ? "success" : "warning"}
        actions={actions}
      />

      <div className="flex items-end justify-between gap-4 py-1">
        <div>
          <span className="text-2xl font-bold tracking-tight text-foreground">
            {successRate.toFixed(1)}%
          </span>
          <p className="text-[11px] text-muted font-medium">Success Rate</p>
        </div>

        <div className="w-24 shrink-0">
          <Sparkline
            data={executionHistory}
            color={isHealthy ? "#10b981" : "#f59e0b"}
            height={32}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 text-[11px]">
        <div>
          <span className="text-muted flex items-center gap-1">
            <CheckCircle2 className="size-3 text-success" /> Total
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">{totalExecutions}</p>
        </div>
        <div>
          <span className="text-muted flex items-center gap-1">
            <XCircle className="size-3 text-danger" /> Failed
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">{failedCount}</p>
        </div>
        <div>
          <span className="text-muted flex items-center gap-1">
            <Clock className="size-3 text-muted" /> Avg latency
          </span>
          <p className="mt-0.5 font-semibold text-foreground font-mono">
            {avgDurationMs < 1000 ? `${avgDurationMs}ms` : `${(avgDurationMs / 1000).toFixed(1)}s`}
          </p>
        </div>
      </div>
    </div>
  );
}
