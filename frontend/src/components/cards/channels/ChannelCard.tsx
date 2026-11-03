import { ChevronRight, FlaskConical, MessageSquare, QrCode } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CardHeader } from "../shared/CardHeader";
import { CardStatus, type CardStatusTone } from "../shared/CardStatus";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

export interface ChannelCardProps {
  id: string;
  displayName: string;
  channelType: "whatsapp_web" | "simulator";
  phoneNumber?: string | null;
  status: "CONNECTED" | "QR_PENDING" | "INITIALIZING" | "AUTHENTICATING" | "DISCONNECTED" | "ERROR" | "LOGGED_OUT" | "NOT_CONNECTED";
  statusLabel?: string;
  lastConnectedAt?: string;
  incomingCount?: number;
  outgoingCount?: number;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

const statusToneMap: Record<string, CardStatusTone> = {
  CONNECTED: "success",
  QR_PENDING: "warning",
  INITIALIZING: "info",
  AUTHENTICATING: "info",
  DISCONNECTED: "warning",
  ERROR: "danger",
  LOGGED_OUT: "neutral",
  NOT_CONNECTED: "neutral",
};

export function ChannelCard({
  id,
  displayName,
  channelType,
  phoneNumber,
  status,
  statusLabel,
  lastConnectedAt,
  incomingCount,
  outgoingCount,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: ChannelCardProps) {
  const isConnected = status === "CONNECTED";
  const isQrWaiting = status === "QR_PENDING";
  const isSimulator = channelType === "simulator";

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3.5", className)}>
      <CardHeader
        title={
          <Link to={`/channels/${id}`} className="hover:text-primary hover:underline truncate">
            {displayName}
          </Link>
        }
        subtitle={
          phoneNumber ? (
            <span className="font-mono text-xs">{phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`}</span>
          ) : (
            "No phone associated"
          )
        }
        icon={isSimulator ? FlaskConical : MessageSquare}
        iconTone={isSimulator ? "warning" : isConnected ? "success" : "neutral"}
        badge={
          <CardStatus
            tone={statusToneMap[status] ?? "neutral"}
            label={statusLabel ?? status.replace("_", " ")}
          />
        }
        actions={actions}
      />

      {/* Traffic Metrics if present */}
      {(incomingCount !== undefined || outgoingCount !== undefined) && (
        <div className="grid grid-cols-2 gap-3 py-1.5 border-y border-border/50 text-xs">
          <div>
            <span className="text-[10px] text-muted uppercase">Inbound</span>
            <p className="mt-0.5 font-semibold text-foreground font-mono">
              {incomingCount?.toLocaleString() ?? 0} msgs
            </p>
          </div>
          <div>
            <span className="text-[10px] text-muted uppercase">Outbound</span>
            <p className="mt-0.5 font-semibold text-foreground font-mono">
              {outgoingCount?.toLocaleString() ?? 0} msgs
            </p>
          </div>
        </div>
      )}

      {/* Action and last connected row */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <span className="text-[11px] text-muted truncate">
          {lastConnectedAt ? `Connected ${lastConnectedAt}` : "Never connected"}
        </span>

        <Button asChild variant="secondary" size="sm" className="h-7 text-xs gap-1">
          <Link to={`/channels/${id}`}>
            {isQrWaiting ? (
              <>
                <QrCode className="size-3 text-primary" /> Scan QR
              </>
            ) : (
              <>
                Manage <ChevronRight className="size-3" />
              </>
            )}
          </Link>
        </Button>
      </div>
    </div>
  );
}

