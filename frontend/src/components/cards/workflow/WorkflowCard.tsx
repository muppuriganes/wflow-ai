import { Clock, Workflow, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CardHeader } from "../shared/CardHeader";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface WorkflowCardProps {
  id: string;
  name: string;
  description?: string;
  triggerType: string;
  status: "active" | "paused" | "draft" | "archived";
  version?: number;
  hasUnpublishedChanges?: boolean;
  totalRuns7d?: number;
  failedRuns7d?: number;
  lastRunAt?: string;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

const statusToneMap = {
  active: "success" as const,
  paused: "warning" as const,
  draft: "neutral" as const,
  archived: "neutral" as const,
};

export function WorkflowCard({
  id,
  name,
  description,
  triggerType,
  status,
  version,
  hasUnpublishedChanges,
  totalRuns7d = 0,
  failedRuns7d = 0,
  lastRunAt,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: WorkflowCardProps) {
  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={
          <Link to={`/workflows/${id}`} className="hover:text-primary hover:underline truncate">
            {name}
          </Link>
        }
        subtitle={description}
        icon={Workflow}
        iconTone="primary"
        badge={
          <div className="flex items-center gap-1.5">
            <CardStatus tone={statusToneMap[status]} label={status} />
            {version && <span className="text-[10px] text-muted font-mono">v{version}</span>}
            {hasUnpublishedChanges && (
              <span className="text-[10px] font-semibold text-warning" title="Draft differs from live">
                edited
              </span>
            )}
          </div>
        }
        actions={actions}
      />

      {/* Trigger & Metrics Info */}
      <div className="grid grid-cols-2 gap-2 py-2 border-y border-border/50 text-xs">
        <div>
          <span className="text-[10px] font-medium text-muted uppercase">Trigger</span>
          <p className="mt-0.5 font-medium text-foreground truncate flex items-center gap-1">
            <Zap className="size-3 text-primary shrink-0" />
            {triggerType}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-medium text-muted uppercase">7-Day Runs</span>
          <p className="mt-0.5 font-medium text-foreground truncate">
            {totalRuns7d.toLocaleString()}
            {failedRuns7d > 0 && (
              <span className="ml-1 text-[11px] text-danger font-semibold">({failedRuns7d} failed)</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted pt-1">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {lastRunAt ? `Last run: ${lastRunAt}` : "Never executed"}
        </span>

        <Link
          to={`/workflows/${id}`}
          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          Open builder →
        </Link>
      </div>
    </div>
  );
}
