import { Construction } from "lucide-react";
import { MILESTONE_LABELS, type NavItem } from "@/app/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Honest placeholder for modules that are planned but not built yet — no fake data, no dead buttons. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const milestone = item.milestone;
  return (
    <>
      <PageHeader title={item.label} actions={milestone && <Badge tone="primary">{MILESTONE_LABELS[milestone.id] ?? milestone.id}</Badge>} />
      <Card>
        <EmptyState
          icon={Construction}
          title="This module is not available yet"
          description={
            <>
              {milestone?.summary}
              <br />
              It will appear here once it is built and tested.
            </>
          }
        />
      </Card>
    </>
  );
}
