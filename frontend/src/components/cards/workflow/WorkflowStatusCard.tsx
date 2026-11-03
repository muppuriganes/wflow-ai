import { Pause, Play, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface WorkflowStatusCardProps {
  name: string;
  status: "active" | "paused" | "draft" | "archived";
  onToggleStatus?: () => void;
  isToggling?: boolean;
  version?: number;
  lastRun?: string;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function WorkflowStatusCard({
  name,
  status,
  onToggleStatus,
  isToggling = false,
  version,
  lastRun,
  appearance = "outlined",
  density = "comfortable",
  className,
}: WorkflowStatusCardProps) {
  const isActive = status === "active";

  return (
    <div
      className={cn(
        cardVariants({ appearance, density }),
        "flex-row items-center justify-between gap-4",
        className
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            isActive ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          )}
        >
          <Workflow className="size-5" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">{name}</h4>
            <CardStatus
              tone={isActive ? "success" : "warning"}
              label={status.toUpperCase()}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
            {version && <span>v{version}</span>}
            {lastRun && (
              <>
                <span>·</span>
                <span>Last run: {lastRun}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {onToggleStatus && (
        <Button
          size="sm"
          variant={isActive ? "secondary" : "primary"}
          onClick={onToggleStatus}
          loading={isToggling}
          className="gap-1.5 shrink-0"
        >
          {isActive ? (
            <>
              <Pause className="size-3.5" /> Pause
            </>
          ) : (
            <>
              <Play className="size-3.5" /> Activate
            </>
          )}
        </Button>
      )}
    </div>
  );
}
