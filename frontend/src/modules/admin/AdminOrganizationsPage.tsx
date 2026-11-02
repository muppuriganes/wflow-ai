import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounced } from "@/hooks/useDebounced";
import { adminApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import type { AdminOrgListItem } from "@/types/api";
import { formatDate, formatRelative } from "@/utils/format";

export function orgState(o: Pick<AdminOrgListItem, "status" | "approval_status">): { label: string; tone: BadgeTone } {
  if (o.approval_status === "pending") return { label: "Waiting for approval", tone: "warning" };
  if (o.approval_status === "rejected") return { label: "Rejected", tone: "danger" };
  if (o.status === "suspended") return { label: "Suspended", tone: "danger" };
  return { label: "Active", tone: "success" };
}

export function AdminOrganizationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 300);
  const list = useQuery({
    queryKey: ["admin", "organizations", q, status, page],
    queryFn: () => adminApi.listOrganizations({ search: q || undefined, status: status || undefined, page, page_size: 25 }),
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1;

  return (
    <>
      <PageHeader title="Organizations" description="Every business on the platform: status, plan, billing, numbers and activity." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 size-4 text-subtle" aria-hidden />
            <Input
              className="pl-7"
              placeholder="Search by name"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Search organizations"
            />
          </div>
          <NativeSelect
            className="w-48"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All organizations</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Waiting for approval</option>
            <option value="rejected">Rejected</option>
          </NativeSelect>
        </div>
        {list.isLoading ? (
          <LoadingRows rows={6} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={Building2} title="No organizations found" />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Organization</TH>
                  <TH>Status</TH>
                  <TH>Plan</TH>
                  <TH className="hidden md:table-cell">Billing</TH>
                  <TH className="hidden lg:table-cell">Team · Numbers · Workflows</TH>
                  <TH className="hidden lg:table-cell">Messages (30 days)</TH>
                  <TH className="hidden md:table-cell">Last activity</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((o) => {
                  const st = orgState(o);
                  return (
                    <TR key={o.id} className="hover:bg-surface-muted/50">
                      <TD>
                        <Link to={`/admin/organizations/${o.id}`} className="font-medium hover:underline">
                          {o.name}
                        </Link>
                        <p className="text-[11px] text-muted">Joined {formatDate(o.created_at)}</p>
                      </TD>
                      <TD>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </TD>
                      <TD>
                        {o.plan_name}
                        <p className="text-[11px] capitalize text-muted">{o.subscription_status.replace("_", " ")}</p>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <Badge tone={o.billing_required ? "primary" : "neutral"}>{o.billing_required ? "On" : "Off"}</Badge>
                      </TD>
                      <TD className="hidden tabular-nums text-muted lg:table-cell">
                        {o.members_count} · {o.channels_count} · {o.workflows_count}
                      </TD>
                      <TD className="hidden tabular-nums lg:table-cell">{o.messages_30d.toLocaleString()}</TD>
                      <TD className="hidden text-muted md:table-cell">{o.last_activity_at ? formatRelative(o.last_activity_at) : "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted">
                Page {page} of {pages}
                <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
