import { Check, Target } from "lucide-react";
import type { ReactNode } from "react";
import { RadialProgress } from "../analytics/charts";
import { CardHeader } from "../shared/CardHeader";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface LeadScoreFactor {
  label: string;
  weight: number;
  satisfied: boolean;
}

export interface LeadScoreCardProps {
  leadTitle: string;
  score: number; // 0 to 100
  factors?: LeadScoreFactor[];
  tier?: "High Intent" | "Warm" | "Cold" | "Qualified";
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function LeadScoreCard({
  leadTitle,
  score,
  factors = [
    { label: "Phone number verified", weight: 25, satisfied: true },
    { label: "Replied within 24h", weight: 35, satisfied: true },
    { label: "Budget confirmed", weight: 20, satisfied: score > 60 },
    { label: "Decision maker role", weight: 20, satisfied: score > 80 },
  ],
  tier = score >= 75 ? "High Intent" : score >= 50 ? "Warm" : "Cold",
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: LeadScoreCardProps) {
  const isHigh = score >= 75;

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <CardHeader
        title={leadTitle}
        subtitle="AI Lead Qualification & Scoring"
        icon={Target}
        iconTone={isHigh ? "primary" : "warning"}
        actions={actions}
      />

      <div className="flex items-center justify-between gap-4 py-1">
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted">Qualification Tier</span>
          <p className="text-base font-bold text-foreground">{tier}</p>
          <span className="text-xs text-muted">Probability of conversion</span>
        </div>

        <div className="shrink-0">
          <RadialProgress
            value={score}
            size={64}
            strokeWidth={6}
            color={isHigh ? "#7c3aed" : "#f59e0b"}
            label="Score"
          />
        </div>
      </div>

      {/* Factors breakdown */}
      <div className="space-y-1.5 pt-2 border-t border-border/50 text-xs">
        <span className="text-[10px] font-semibold uppercase text-muted">Signals</span>
        <div className="space-y-1">
          {factors.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className={cn("flex items-center gap-1.5", f.satisfied ? "text-foreground font-medium" : "text-muted")}>
                <span className={cn("size-3.5 rounded-full flex items-center justify-center shrink-0", f.satisfied ? "bg-success/15 text-success" : "bg-surface-muted text-subtle")}>
                  {f.satisfied && <Check className="size-2.5 stroke-[3]" />}
                </span>
                {f.label}
              </span>
              <span className="font-mono text-muted">+{f.weight}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
