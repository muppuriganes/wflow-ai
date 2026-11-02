import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, KeyRound, LogOut, Search, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounced } from "@/hooks/useDebounced";
import { platformApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import { useAuth } from "@/stores/auth";
import { formatDate, formatDateTime, formatRelative } from "@/utils/format";

export function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 300);
  const users = useQuery({ queryKey: ["admin", "users", q, page], queryFn: () => platformApi.users(q, page) });
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.page_size)) : 1;

  return (
    <>
      <PageHeader title="Users & logins" description="Everyone with an account, across all organizations." />
      <Card>
        <div className="border-b p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-2 size-4 text-subtle" aria-hidden />
            <Input
              className="pl-7"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Search users"
            />
          </div>
        </div>
        {users.isLoading ? (
          <LoadingRows rows={6} />
        ) : users.error ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        ) : !users.data?.items.length ? (
          <EmptyState icon={Users} title="No users found" />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Organizations</TH>
                  <TH className="hidden md:table-cell">Last sign-in</TH>
                  <TH className="hidden lg:table-cell">Joined</TH>
                </TR>
              </THead>
              <TBody>
                {users.data.items.map((u) => (
                  <TR key={u.id} className="hover:bg-surface-muted/50">
                    <TD>
                      <Link to={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.full_name}
                      </Link>
                      {u.is_superadmin && (
                        <Badge tone="primary" className="ml-2">
                          Super Admin
                        </Badge>
                      )}
                      <p className="text-[11px] text-muted">{u.email}</p>
                    </TD>
                    <TD>
                      <StatusDot tone={u.is_active ? "success" : "danger"} label={u.is_active ? "Active" : "Disabled"} />
                      {!u.email_verified && <p className="text-[11px] text-warning">Email not verified</p>}
                    </TD>
                    <TD className="hidden tabular-nums md:table-cell">{u.organizations}</TD>
                    <TD className="hidden text-muted md:table-cell">{u.last_login_at ? formatRelative(u.last_login_at) : "Never"}</TD>
                    <TD className="hidden text-muted lg:table-cell">{formatDate(u.created_at)}</TD>
                  </TR>
                ))}
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

type Action = "disable" | "enable" | "signout" | "reset" | "grant" | "revoke";

export function AdminUserPage() {
  const { userId } = useParams();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const detail = useQuery({ queryKey: ["admin", "user", userId], queryFn: () => platformApi.user(userId!) });
  const act = useMutation({
    mutationFn: async (a: Action) => {
      const id = userId!;
      if (a === "disable" || a === "enable") return platformApi.setUserActive(id, a === "enable");
      if (a === "grant" || a === "revoke") return platformApi.setSuperadmin(id, a === "grant");
      if (a === "signout") return platformApi.signOutUser(id);
      return platformApi.sendPasswordReset(id);
    },
    onSuccess: (_res, a) => {
      const msg: Record<Action, string> = {
        disable: "Account disabled and signed out everywhere",
        enable: "Account enabled",
        signout: "Signed out of every device",
        reset: "Password reset email sent",
        grant: "Super Admin access granted",
        revoke: "Super Admin access removed",
      };
      toast.success(msg[a]);
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (detail.isLoading) return <LoadingRows rows={6} />;
  if (detail.error || !detail.data) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  const u = detail.data;
  const self = me?.id === u.id;
  const confirmText: Record<Action, { title: string; body: string; label: string; danger?: boolean }> = {
    disable: { title: `Disable ${u.full_name}?`, body: "They are signed out everywhere and can't sign in until enabled again.", label: "Disable", danger: true },
    enable: { title: `Enable ${u.full_name}?`, body: "They can sign in again.", label: "Enable" },
    signout: { title: "Sign out everywhere?", body: "Every device is signed out; they can sign in again.", label: "Sign out" },
    reset: { title: "Send a password reset email?", body: `A reset link goes to ${u.email}.`, label: "Send" },
    grant: { title: `Make ${u.full_name} a Super Admin?`, body: "They will see every organization and manage the platform.", label: "Grant", danger: true },
    revoke: { title: "Remove Super Admin access?", body: "They keep their normal organization access.", label: "Remove" },
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin/users" aria-label="Back to users">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-64 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{u.full_name}</h1>
            <StatusDot tone={u.is_active ? "success" : "danger"} label={u.is_active ? "Active" : "Disabled"} />
            {u.is_superadmin && <Badge tone="primary">Super Admin</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {u.email} · {u.email_verified ? "email verified" : "email not verified"} · joined {formatDate(u.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirm("reset")}>
            <KeyRound /> Send password reset
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirm("signout")}>
            <LogOut /> Sign out everywhere ({u.active_sessions})
          </Button>
          {!self &&
            (u.is_active ? (
              <Button variant="danger-outline" size="sm" onClick={() => setConfirm("disable")}>
                <UserX /> Disable
              </Button>
            ) : (
              <Button size="sm" onClick={() => setConfirm("enable")}>
                <UserCheck /> Enable
              </Button>
            ))}
          {!self && (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(u.is_superadmin ? "revoke" : "grant")}>
              <ShieldCheck /> {u.is_superadmin ? "Remove Super Admin" : "Make Super Admin"}
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organizations" />
          {!u.memberships.length ? (
            <p className="px-4 py-6 text-xs text-muted">Not a member of any organization.</p>
          ) : (
            <ul className="divide-y">
              {u.memberships.map((m) => (
                <li key={m.organization_id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <Link to={`/admin/organizations/${m.organization_id}`} className="font-medium hover:underline">
                    {m.organization_name}
                  </Link>
                  <span className="ml-auto text-xs text-muted">{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Sign-in history" description={u.last_login_at ? `Last sign-in ${formatRelative(u.last_login_at)}` : "Never signed in"} />
          <CardBody>
            {!u.login_events.length ? (
              <p className="text-xs text-muted">No sign-in events recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {u.login_events.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-2">
                    <span className={e.action === "auth.login_failed" ? "text-danger" : ""}>{e.action.replace("auth.", "").replace(/_/g, " ")}</span>
                    {e.reason && <span className="text-muted">({e.reason.replace(/_/g, " ")})</span>}
                    <span className="text-muted">{e.ip ?? ""}</span>
                    <span className="ml-auto text-muted" title={formatDateTime(e.at)}>
                      {formatRelative(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirmText[confirm].title}
          description={confirmText[confirm].body}
          confirmLabel={confirmText[confirm].label}
          danger={confirmText[confirm].danger}
          loading={act.isPending}
          onConfirm={() => act.mutate(confirm)}
        />
      )}
    </>
  );
}
