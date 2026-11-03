import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AnalyticsCard } from "./AnalyticsCard";
import { FunnelChart, type FunnelStage } from "./charts";
import type { CardAppearance, CardDensity } from "../shared/tokens";

export interface FunnelCardProps {
  title: string;
  subtitle?: string;
  stages: FunnelStage[];
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function FunnelCard({
  title,
  subtitle,
  stages,
  icon,
  badge,
  actions,
  appearance = "outlined",
  density = "comfortable",
  loading = false,
  empty = false,
  error = null,
  onRetry,
  className,
}: FunnelCardProps) {
  return (
    <AnalyticsCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      badge={badge}
      actions={actions}
      appearance={appearance}
      density={density}
      loading={loading}
      empty={empty || stages.length === 0}
      emptyTitle="No pipeline funnel data"
      emptyDescription="Funnel stages will render once leads or conversion steps are recorded."
      error={error}
      onRetry={onRetry}
      className={className}
    >
      <FunnelChart stages={stages} />
    </AnalyticsCard>
  );
}

