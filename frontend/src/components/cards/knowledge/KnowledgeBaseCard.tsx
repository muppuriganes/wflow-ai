import { Database, FileText, HardDrive, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface KnowledgeBaseCardProps {
  id?: string;
  name: string;
  description?: string;
  documentCount: number;
  totalChunks: number;
  storageMb: number;
  maxStorageMb?: number;
  lastIndexedAt?: string;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function KnowledgeBaseCard({
  name,
  description,
  documentCount,
  totalChunks,
  storageMb,
  maxStorageMb = 500,
  lastIndexedAt,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: KnowledgeBaseCardProps) {
  const percentUsed = Math.min(100, Math.round((storageMb / maxStorageMb) * 100));

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={name}
        subtitle={description}
        icon={Database}
        iconTone="info"
        actions={actions}
      />

      {/* Primary counts */}
      <div className="grid grid-cols-2 gap-3 py-1 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
            <FileText className="size-4" />
          </div>
          <div>
            <span className="text-[10px] text-muted uppercase">Documents</span>
            <p className="font-bold text-foreground font-mono">{documentCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
            <Layers className="size-4 text-primary" />
          </div>
          <div>
            <span className="text-[10px] text-muted uppercase">Vector Chunks</span>
            <p className="font-bold text-foreground font-mono">{totalChunks.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Storage Utilization */}
      <div className="space-y-1.5 pt-2 border-t border-border/50 text-xs">
        <div className="flex justify-between items-center text-muted">
          <span className="flex items-center gap-1 text-[11px]">
            <HardDrive className="size-3" /> Storage Usage
          </span>
          <span className="font-mono text-[11px] font-semibold text-foreground">
            {storageMb} MB / {maxStorageMb} MB ({percentUsed}%)
          </span>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted border border-border/40">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percentUsed}%` }}
          />
        </div>
      </div>

      {lastIndexedAt && (
        <span className="text-[10px] text-muted block pt-1">
          Last indexed: {lastIndexedAt}
        </span>
      )}
    </div>
  );
}
