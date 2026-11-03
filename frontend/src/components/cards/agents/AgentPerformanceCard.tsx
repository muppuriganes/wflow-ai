import { Bot, CheckCircle, Hand, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface AgentPerformanceCardProps {
  agentName: string;
  totalConversations: number;
  autonomousResolvedPercent: number; // e.g. 78
  humanEscalationPercent: number; // e.g. 22
  satisfactionScore?: number; // 0 to 5 or percentage
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function AgentPerformanceCard({
  agentName,
  totalConversations,
  autonomousResolvedPercent,
  humanEscalationPercent,
  satisfactionScore,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: AgentPerformanceCardProps) {
  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={agentName}
        subtitle="Conversational resolution metrics"
        icon={Bot}
        iconTone="primary"
        actions={actions}
      />

      <div className="space-y-2 py-1">
        <div className="flex justify-between items-center text-xs">
          <span className="font-medium text-muted">Autonomous Resolution</span>
          <span className="font-bold text-success font-mono">{autonomousResolvedPercent}%</span>
        </div>

        {/* Stacked Resolution Bar */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted border border-border/40">
          <div
            className="h-full bg-success transition-all duration-300"
            style={{ width: `${autonomousResolvedPercent}%` }}
            title={`Autonomous: ${autonomousResolvedPercent}%`}
          />
          <div
            className="h-full bg-warning transition-all duration-300"
            style={{ width: `${humanEscalationPercent}%` }}
            title={`Escalated to human: ${humanEscalationPercent}%`}
          />
        </div>

        <div className="flex justify-between text-[11px] text-muted pt-0.5">
          <span className="flex items-center gap-1">
            <CheckCircle className="size-3 text-success" /> Resolved autonomously
          </span>
          <span className="flex items-center gap-1">
            <Hand className="size-3 text-warning" /> Handed to agent ({humanEscalationPercent}%)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50 text-xs">
        <div>
          <span className="text-[10px] text-muted uppercase">Total Volume</span>
          <p className="mt-0.5 font-bold text-foreground font-mono">
            {totalConversations.toLocaleString()} chats
          </p>
        </div>
        {satisfactionScore !== undefined && (
          <div>
            <span className="text-[10px] text-muted uppercase">CSAT Score</span>
            <p className="mt-0.5 font-bold text-primary font-mono flex items-center gap-1">
              <TrendingUp className="size-3" />
              {satisfactionScore}/5.0
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
