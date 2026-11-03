import { FileText, Layers, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface DocumentCardProps {
  id?: string;
  filename: string;
  fileSizeBytes: number;
  chunksCount: number;
  status: "indexed" | "processing" | "failed";
  indexedAt?: string;
  onDelete?: () => void;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

const statusToneMap = {
  indexed: "success" as const,
  processing: "info" as const,
  failed: "danger" as const,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentCard({
  filename,
  fileSizeBytes,
  chunksCount,
  status,
  indexedAt,
  onDelete,
  actions,
  appearance = "outlined",
  density = "compact",
  className,
}: DocumentCardProps) {
  return (
    <div
      className={cn(
        cardVariants({ appearance, density }),
        "flex-row items-center justify-between gap-3 text-xs",
        className
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-primary">
          <FileText className="size-4.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate max-w-xs">{filename}</span>
            <CardStatus tone={statusToneMap[status]} label={status} />
          </div>

          <div className="flex items-center gap-2 text-muted mt-0.5 text-[11px]">
            <span>{formatBytes(fileSizeBytes)}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Layers className="size-3" /> {chunksCount} chunks
            </span>
            {indexedAt && (
              <>
                <span>·</span>
                <span>{indexedAt}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {actions}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${filename}`}
            className="rounded p-1.5 text-muted hover:bg-danger-soft hover:text-danger transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
