import { CalendarClock, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface LeadCardProps {
  id: string;
  title: string;
  contactName: string;
  valueAmount: number;
  currency?: string;
  stage: string;
  stageLabel?: string;
  score?: number;
  openTasks?: number;
  expectedCloseDate?: string;
  ownerName?: string;
  draggable?: boolean;
  onOpen?: () => void;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

const stageToneMap: Record<string, "info" | "warning" | "success" | "neutral" | "primary" | "danger"> = {
  NEW: "info",
  CONTACTED: "primary",
  QUALIFIED: "primary",
  PROPOSAL: "warning",
  NEGOTIATION: "warning",
  CONVERTED: "success",
  LOST: "danger",
};

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function LeadCard({
  id,
  title,
  contactName,
  valueAmount,
  currency = "USD",
  stage,
  stageLabel,
  score,
  openTasks = 0,
  expectedCloseDate,
  ownerName,
  draggable = false,
  onOpen,
  actions,
  appearance = "outlined",
  density = "compact",
  className,
}: LeadCardProps) {
  return (
    <div
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        if (draggable) {
          e.dataTransfer.setData("text/lead-id", id);
          e.dataTransfer.effectAllowed = "move";
        }
      }}
      className={cn(
        cardVariants({ appearance, density, interactive: Boolean(onOpen) }),
        draggable && "cursor-grab active:cursor-grabbing",
        "gap-2 text-left",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground line-clamp-2">{title}</h4>
        <div className="flex items-center gap-1.5 shrink-0">
          <CardStatus
            tone={stageToneMap[stage] ?? "neutral"}
            label={stageLabel ?? stage}
          />
          {actions}
        </div>
      </div>

      <p className="text-[11px] text-muted truncate">{contactName}</p>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs">
        <span className="font-bold text-foreground font-mono">
          {formatCurrency(valueAmount, currency)}
        </span>

        <div className="flex items-center gap-2 text-muted text-[11px]">
          {openTasks > 0 && (
            <span className="inline-flex items-center gap-0.5" title={`${openTasks} task(s)`}>
              <ListTodo className="size-3" />
              {openTasks}
            </span>
          )}
          {expectedCloseDate && (
            <span className="inline-flex items-center gap-0.5" title="Close date">
              <CalendarClock className="size-3" />
              {expectedCloseDate}
            </span>
          )}
        </div>
      </div>

      {(ownerName || score !== undefined) && (
        <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-muted">
          <span className="truncate">{ownerName ?? "Unassigned"}</span>
          {score !== undefined && (
            <div className="flex items-center gap-1.5" title={`Score: ${score}/100`}>
              <div className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-muted border border-border/40">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                />
              </div>
              <span className="font-mono font-semibold">{score}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
