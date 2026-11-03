import { Mail, Phone, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cardVariants, type CardAppearance, type CardDensity } from "../shared/tokens";
import { cn } from "@/utils/cn";

export interface CustomerCardProps {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  tags?: Array<{ id: string; name: string }>;
  openLeadsCount?: number;
  lastActive?: string;
  actions?: ReactNode;
  appearance?: CardAppearance;
  density?: CardDensity;
  className?: string;
}

export function CustomerCard({
  id,
  name,
  phone,
  email,
  company,
  tags = [],
  openLeadsCount = 0,
  lastActive,
  actions,
  appearance = "outlined",
  density = "comfortable",
  className,
}: CustomerCardProps) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  return (
    <div className={cn(cardVariants({ appearance, density }), "gap-3", className)}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <Link
              to={`/contacts/${id}`}
              className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate block"
            >
              {name}
            </Link>
            {company && <p className="text-xs text-muted truncate">{company}</p>}
          </div>
        </div>

        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {/* Details */}
      <div className="space-y-1.5 text-xs text-muted">
        {phone && (
          <p className="flex items-center gap-2 truncate font-mono text-[11px]">
            <Phone className="size-3 text-muted shrink-0" />
            <span>+{phone.replace(/^\+/, "")}</span>
          </p>
        )}
        {email && (
          <p className="flex items-center gap-2 truncate text-[11px]">
            <Mail className="size-3 text-muted shrink-0" />
            <span className="truncate">{email}</span>
          </p>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted"
            >
              <Tag className="size-2.5 text-subtle" />
              {t.name}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] text-muted">+{tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] text-muted">
        <span>{openLeadsCount} open deal(s)</span>
        {lastActive && <span>Active: {lastActive}</span>}
      </div>
    </div>
  );
}
