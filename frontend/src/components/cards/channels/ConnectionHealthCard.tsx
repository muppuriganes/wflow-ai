import { ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { CardHeader } from "../shared/CardHeader";
import { CardStatus } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface ConnectionHealthCardProps {
  totalConnections: number;
  activeSessions: number;
  pendingQrCount: number;
  gatewayStatus: "ok" | "degraded" | "down";
  latencyMs?: number;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function ConnectionHealthCard({
  totalConnections,
  activeSessions,
  pendingQrCount,
  gatewayStatus = "ok",
  latencyMs = 45,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: ConnectionHealthCardProps) {
  const isOk = gatewayStatus === "ok";

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title="Gateway Connection Health"
        subtitle="Real-time multi-device session runtime"
        icon={isOk ? Wifi : WifiOff}
        iconTone={isOk ? "success" : "danger"}
        badge={
          <CardStatus
            tone={isOk ? "success" : "danger"}
            label={isOk ? "GATEWAY OPERATIONAL" : "DEGRADED"}
          />
        }
        actions={actions}
      />

      <div className="grid grid-cols-3 gap-2 py-2 text-center text-xs divide-x divide-border/60">
        <div>
          <span className="text-[10px] text-muted uppercase">Active Links</span>
          <p className="mt-0.5 text-lg font-bold text-foreground font-mono">{activeSessions}</p>
        </div>
        <div className="pl-2">
          <span className="text-[10px] text-muted uppercase">Pending QR</span>
          <p className="mt-0.5 text-lg font-bold text-warning font-mono">{pendingQrCount}</p>
        </div>
        <div className="pl-2">
          <span className="text-[10px] text-muted uppercase">Latency</span>
          <p className="mt-0.5 text-lg font-bold text-foreground font-mono">{latencyMs}ms</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <ShieldCheck className="size-3.5 text-emerald-500" />
          End-to-end encrypted sessions
        </span>
        <span className="font-mono">{totalConnections} total registered</span>
      </div>
    </div>
  );
}
