import { Bot, Cpu, Database, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface AgentCardProps {
  id: string;
  name: string;
  purpose: string;
  model: string;
  knowledgeBase?: string;
  status: "active" | "training" | "paused" | "offline";
  handledConversations?: number;
  resolutionRate?: number;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

const statusToneMap = {
  active: "success" as const,
  training: "info" as const,
  paused: "warning" as const,
  offline: "neutral" as const,
};

export function AgentCard({
  name,
  purpose,
  model,
  knowledgeBase,
  status,
  handledConversations = 0,
  resolutionRate,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: AgentCardProps) {
  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={name}
        subtitle={purpose}
        icon={Bot}
        iconTone="primary"
        badge={<CardStatus tone={statusToneMap[status]} label={status} />}
        actions={actions}
      />

      {/* Model & KB configuration badges */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted/60 px-2 py-0.5 text-xs font-mono text-foreground">
          <Cpu className="size-3 text-primary" />
          {model}
        </span>
        {knowledgeBase && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted/60 px-2 py-0.5 text-xs text-muted truncate max-w-[160px]">
            <Database className="size-3 text-info shrink-0" />
            <span className="truncate">{knowledgeBase}</span>
          </span>
        )}
      </div>

      {/* Handled Conversations & Resolution Metrics */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50 text-xs">
        <div>
          <span className="text-[10px] font-medium text-muted uppercase">Handled</span>
          <p className="mt-0.5 font-semibold text-foreground flex items-center gap-1">
            <MessageSquare className="size-3 text-muted" />
            {handledConversations.toLocaleString()} chats
          </p>
        </div>
        {resolutionRate !== undefined && (
          <div>
            <span className="text-[10px] font-medium text-muted uppercase">Resolution</span>
            <p className="mt-0.5 font-semibold text-success font-mono">
              {resolutionRate}% autonomous
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

